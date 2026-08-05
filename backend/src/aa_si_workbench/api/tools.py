"""Tool self-description — the generated half of the tool catalogue.

``frontend/src/components/panels/pipelines/toolCatalog.ts`` hand-maintains a
flag schema for roughly twenty-five tools, in a different repository on a
different release cadence, carrying a ``verified`` boolean that is a human
assertion and goes stale without saying so. A tool that can describe itself
turns that file into a fallback.

This endpoint runs ``--describe`` against every installed ``aa-*`` console
script and returns whatever answers, so the Configuration panel can build its
form from the real command line. Three properties make that worth doing:

* **Flags, defaults and choices are read off the tool's own argparse parser**,
  so they cannot disagree with what the tool would actually accept.
* **A tool that does not answer is reported, not hidden.** ``supported: false``
  with the reason, so the panel can fall back to the hand-written entry and
  badge it honestly instead of silently rendering a guess.
* **The version comes back with the schema**, so a catalogue built here is
  attributable to the environment it was built from.

Discovery, not enumeration
--------------------------
The tool list comes from ``environment.list_tools()`` — the same console-script
scan ``/api/env`` already does — rather than a list kept here. A tool installed
tomorrow appears without an edit; a tool uninstalled disappears the same way.

Cost and caching
----------------
Each probe is a Python interpreter start (~200 ms) and there are twenty-odd
tools, so the result is cached in-process until ``refresh=true``. The panel
calls this on mount, not on keystroke.
"""

from __future__ import annotations

import json
import os
import subprocess
import threading
from pathlib import Path

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from .environment import list_tools

router = APIRouter(prefix="/api/tools", tags=["tools"])

# A tool that has not answered --describe in this long is not going to.
PROBE_TIMEOUT_SECONDS = 15

# Schemas this Workbench knows how to read. A tool emitting something newer is
# passed through anyway — the frontend ignores keys it does not know, which is
# the same rule handles follow — but the mismatch is reported so a version skew
# is visible rather than mysterious.
KNOWN_SCHEMAS = {"aa/describe/1", "aa/describe/2"}


class ToolDescription(BaseModel):
    name: str
    version: str = ""
    #: False when the tool has no --describe. The hand-written catalogue entry
    #: is the fallback, and the panel should badge it as unverified.
    supported: bool = False
    #: Why it is unsupported, or why the payload was rejected.
    detail: str = ""
    #: The tool's verbatim --describe payload.
    describe: dict | None = None
    #: Set when the payload's schema is not one this build recognises.
    schemaWarning: str = ""


class ToolCatalog(BaseModel):
    tools: list[ToolDescription] = Field(default_factory=list)
    #: How many answered, out of how many were found.
    described: int = 0
    total: int = 0
    generatedAt: str = ""


_cache: ToolCatalog | None = None
_lock = threading.Lock()


def _probe(name: str, path: str) -> ToolDescription:
    try:
        completed = subprocess.run(  # noqa: S603 - path comes from the console-script scan
            [path, "--describe"],
            # Same stdin guard as everywhere else: several of these tools read
            # stdin when given no positionals, and --describe is exactly the
            # flags-only invocation that deadlocks on an inherited pipe.
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=PROBE_TIMEOUT_SECONDS,
            cwd=str(Path.home()),
            env={**os.environ, "NO_COLOR": "1", "TERM": "dumb"},
        )
    except subprocess.TimeoutExpired:
        return ToolDescription(
            name=name,
            detail=f"--describe did not return within {PROBE_TIMEOUT_SECONDS}s.",
        )
    except OSError as exc:
        return ToolDescription(name=name, detail=f"Could not run {name}: {exc}")

    if completed.returncode != 0:
        # An unknown flag is exit 2 from argparse, which is the ordinary "this
        # tool predates --describe" answer rather than an error worth alarming
        # about. Say what happened and let the caller fall back.
        return ToolDescription(
            name=name,
            detail=(
                f"{name} does not answer --describe (exit {completed.returncode}). "
                "Using the hand-written catalogue entry."
            ),
        )

    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        return ToolDescription(
            name=name, detail=f"--describe did not return JSON: {exc}"
        )
    if not isinstance(payload, dict):
        return ToolDescription(name=name, detail="--describe did not return an object.")

    schema = str(payload.get("schema") or "")
    warning = ""
    if schema not in KNOWN_SCHEMAS:
        warning = (
            f"{name} reports schema {schema or '(none)'}, which this Workbench "
            f"does not know. Known: {', '.join(sorted(KNOWN_SCHEMAS))}."
        )

    return ToolDescription(
        name=name,
        version=str(payload.get("version") or ""),
        supported=True,
        describe=payload,
        schemaWarning=warning,
    )


def build_catalog() -> ToolCatalog:
    from datetime import UTC, datetime

    descriptions = [_probe(tool.name, tool.path) for tool in list_tools()]
    return ToolCatalog(
        tools=descriptions,
        described=sum(1 for item in descriptions if item.supported),
        total=len(descriptions),
        generatedAt=(
            datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
        ),
    )


def _reset_for_tests() -> None:
    global _cache
    with _lock:
        _cache = None


@router.get("/describe", response_model=ToolCatalog)
def describe_all(refresh: bool = Query(False)) -> ToolCatalog:
    """Every installed `aa-*` tool's own account of its flags."""
    global _cache
    with _lock:
        if _cache is None or refresh:
            _cache = build_catalog()
        return _cache
