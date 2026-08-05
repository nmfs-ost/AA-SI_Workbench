"""Store inspection — `aa-store info` / `aa-store verify` behind an endpoint.

This is the read side of the tool surface, and it is deliberately *not* routed
through ``jobs.py``. A job is something you start, watch and come back to; this
is a question with an answer, asked by a panel that is re-rendering because the
user clicked a row. Two reasons it stays synchronous:

* **`aa-store` never opens a write handle.** It parses ``.zarray`` / ``zarr.json``
  and counts objects, which is what makes it safe to fire speculatively — at a
  store still being written, at one a SIGTERM interrupted, at something that may
  not be a store at all. Nothing here can damage anything, so nothing here needs
  a confirmation step or a queue entry.

* **The answer is one JSON line.** Under ``--json`` the tool prints one `aa/1`
  handle per store on stdout and everything else on stderr. There is no progress
  to stream and no partial result to poll for.

The payload is passed through **verbatim**. `aa-store info --json` emits a handle
with extra keys, and the invariant that makes that safe is that a strict handle
reader ignores what it does not recognise. Adding server-computed fields — even
the two ratios the panel actually renders — would break that: the thing on the
wire would no longer be a handle the next tool could read. The ratios are two
divisions and they belong where they are displayed.

Cost
----
The chunk census is a full object listing. On a local store that is cheap; on a
bucket holding millions of objects the listing *is* the cost, which is why
``census=false`` exists and maps to ``--no-census``. dims, chunks and codec still
come back — only the written/expected counts go missing, and `verify` says so
rather than guessing.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .jobs import resolve_tool

router = APIRouter(prefix="/api/store", tags=["store"])

# A census on a cold bucket can take a while; a hung request should still end.
TIMEOUT_SECONDS = int(os.getenv("AASI_STORE_TIMEOUT", "120"))


class StoreResult(BaseModel):
    """One store's description, plus how the tool judged it.

    ``summary`` is the tool's own `aa/1` payload, untouched. Everything else is
    about the invocation rather than the store.
    """

    uri: str
    #: 0 ok · 1 unreadable · 2 usage · 3 unfinished (resumable) · 4 verified wrong
    exitCode: int
    ok: bool
    #: The tool's stderr — the human-readable rendering, and any warning.
    log: list[str] = Field(default_factory=list)
    #: Verbatim `aa-store` output. Null when the store could not be read at all.
    summary: dict | None = None
    #: Populated when the tool could not produce a summary.
    error: str = ""


def _run(args: list[str]) -> tuple[int, str, str]:
    program = resolve_tool("aa-store")
    try:
        completed = subprocess.run(  # noqa: S603 - argv[0] resolved server-side
            [program, *args],
            # Same guard as the job runner: aa-store falls back to reading store
            # paths from stdin when given none, and an inherited open pipe would
            # block it forever. DEVNULL makes that read return immediately.
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
            cwd=str(Path.home()),
            env={
                **os.environ,
                "NO_COLOR": "1",
                "TERM": "dumb",
                "PYTHONUNBUFFERED": "1",
            },
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(
            status_code=504,
            detail=(
                f"aa-store did not finish within {TIMEOUT_SECONDS}s. If this is a "
                "remote store with a very large object count, retry with the "
                "census turned off."
            ),
        ) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=500, detail=f"Could not run aa-store: {exc}"
        ) from exc
    return completed.returncode, completed.stdout, completed.stderr


def _describe(
    subcommand: str, uri: str, census: bool, arrays: bool, strict: bool
) -> StoreResult:
    if not uri.strip():
        raise HTTPException(status_code=400, detail="No store given.")

    args = [subcommand, "--json"]
    if arrays:
        args.append("--arrays")
    if not census:
        args.append("--no-census")
    if strict and subcommand == "verify":
        args.append("--strict")
    args.append(uri)

    code, stdout, stderr = _run(args)
    log = [line for line in stderr.splitlines() if line.strip()]

    summary: dict | None = None
    # One line per store. A single uri means at most one line, but the tool is
    # an NDJSON emitter by design, so read it as one and take the first object.
    for line in stdout.splitlines():
        text = line.strip()
        if not text.startswith("{"):
            continue
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            summary = parsed
            break

    error = ""
    if summary is None:
        # Exit 1 with no summary is the ordinary "not a Zarr store" case, and
        # the tool has already said why on stderr. Prefer its sentence to ours.
        error = log[-1] if log else f"aa-store exited {code} with no output."

    return StoreResult(
        uri=uri,
        exitCode=code,
        ok=code == 0,
        log=log,
        summary=summary,
        error=error,
    )


@router.get("/info", response_model=StoreResult)
def info(
    uri: str = Query(..., description="Store path or gs:// / s3:// URI."),
    census: bool = Query(
        True, description="Count chunk objects. False maps to --no-census."
    ),
    arrays: bool = Query(False, description="Include the per-array breakdown."),
) -> StoreResult:
    """Describe a store. Read-only, so safe to call on selection."""
    return _describe("info", uri, census=census, arrays=arrays, strict=False)


@router.get("/verify", response_model=StoreResult)
def verify(
    uri: str = Query(...),
    census: bool = Query(True),
    arrays: bool = Query(False),
    strict: bool = Query(
        False,
        description=(
            "Treat missing chunks with no write marker as unfinished rather "
            "than assuming sparsity."
        ),
    ),
) -> StoreResult:
    """Judge a store: 0 complete · 3 unfinished and resumable · 4 finished wrong."""
    return _describe("verify", uri, census=census, arrays=arrays, strict=strict)
