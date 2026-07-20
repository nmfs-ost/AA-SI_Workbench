"""Environment inspection and the `aa-setup` update runner.

The Workbench orchestrates the `aa-*` console tools; it does not reimplement
them. So "update the Workbench" really means "refresh the Python environment
those tools live in" — the `venv313` virtualenv that AA-SI_GCPSetup's `init.sh`
creates and that this server is itself running inside. `aa-setup` is the
user-facing update mechanism for that environment, so this module runs it and
streams its output to the UI.

Design notes
------------
* **The client never supplies a command.** A request names an *action id* which
  is looked up in the server-side ``UPDATE_ACTIONS`` allow-list. The argv is
  built here, run with ``shell=False``, and nothing from the request body is
  interpolated into it.
* **Loopback only by default.** The updater rewrites the interpreter this
  process is running in, so it is refused when the server is bound to a
  non-loopback address unless ``AASI_ALLOW_REMOTE_UPDATE=true``. ``cli.py``
  publishes the bind host as ``AASI_BIND_HOST``.
* **Single-flight.** One update at a time, tracked in a module-level job whose
  output is buffered so the UI can poll from a cursor, close the dialog, and
  come back to a job that is still running.
* **Polling, not SSE.** Long-lived event streams are the first thing an
  intermediate proxy buffers (and this app is normally reached through the Cloud
  Workstation web preview). A cursor + ``GET`` is boring and survives that.

Wire models live in this module rather than ``schemas.py`` because they are
coupled to the runner below; ``schemas.py`` stays the NCEI catalog contract.
"""

from __future__ import annotations

import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime
from importlib.metadata import distributions
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from .. import __version__

# The virtualenv name AA-SI standardises on (Python 3.13). Reported to the UI so
# it can flag "you are not in the environment you think you are" without the
# frontend hard-coding NOAA convention.
EXPECTED_VENV_NAME = os.getenv("AASI_EXPECTED_VENV", "venv313")

# Console-script prefix for the AA-SI toolset.
TOOL_PREFIX = "aa-"

# Distributions worth showing a version for even when they ship no console
# script (the libraries a scientist actually cares about pinning).
_DEFAULT_WATCH = "aalibrary,echopype,xarray,numpy,aa-si-workbench"

# Output buffering: keep the tail of a long install, not all of it.
_MAX_LINES = 4000
_DROP_CHUNK = 1000

_ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


# --------------------------------------------------------------------------- #
# Wire models (camelCase to match the frontend types verbatim)
# --------------------------------------------------------------------------- #
class ToolInfo(BaseModel):
    name: str  # console script, e.g. "aa-find"
    path: str  # resolved location, "" if not on disk
    distribution: str  # providing package, "" if unknown
    version: str  # "" if unknown


class PackageInfo(BaseModel):
    name: str
    version: str  # "" when the distribution is not installed


class UpdateAction(BaseModel):
    id: str
    label: str
    description: str
    command: list[str]  # argv as configured
    resolvedPath: str  # argv[0] resolved against the venv/PATH, "" if missing
    available: bool


class EnvironmentInfo(BaseModel):
    workbenchVersion: str
    pythonVersion: str
    pythonExecutable: str
    prefix: str  # sys.prefix — the venv root when in a venv
    venvName: str  # basename of prefix, e.g. "venv313"
    isVirtualEnv: bool
    expectedVenvName: str
    matchesExpected: bool
    platform: str
    tools: list[ToolInfo]
    packages: list[PackageInfo]
    actions: list[UpdateAction]
    updateEnabled: bool
    updateDisabledReason: str


class UpdateRequest(BaseModel):
    action: str = "environment"


class UpdateJobStatus(BaseModel):
    state: str  # idle | running | succeeded | failed | cancelled
    action: str
    command: list[str]
    startedAt: str
    finishedAt: str
    exitCode: int | None
    error: str
    lines: list[str]  # slice starting at `cursor`
    cursor: int  # absolute index of lines[0]
    nextCursor: int  # pass back as ?since=
    truncated: bool  # older lines were dropped before `cursor`


# --------------------------------------------------------------------------- #
# Environment inspection
# --------------------------------------------------------------------------- #
def _bin_dir() -> Path:
    """The directory holding this environment's console scripts."""
    return Path(sys.prefix) / ("Scripts" if os.name == "nt" else "bin")


def _resolve(program: str) -> str:
    """Resolve a console script, preferring *this* environment over PATH."""
    candidate = _bin_dir() / program
    if candidate.is_file() and os.access(candidate, os.X_OK):
        return str(candidate)
    found = shutil.which(program)
    return found or ""


def _console_scripts() -> dict[str, tuple[str, str]]:
    """Map console-script name -> (distribution name, version)."""
    mapping: dict[str, tuple[str, str]] = {}
    for dist in distributions():
        try:
            name = dist.metadata["Name"] or ""
            version = dist.version or ""
            for entry in dist.entry_points:
                if entry.group == "console_scripts":
                    mapping[entry.name] = (name, version)
        except Exception:  # noqa: BLE001 - a broken dist must not blank the list
            continue
    return mapping


def _installed_versions() -> dict[str, str]:
    """Map normalized distribution name -> version."""
    versions: dict[str, str] = {}
    for dist in distributions():
        try:
            name = dist.metadata["Name"]
            if name:
                versions[name.lower().replace("_", "-")] = dist.version or ""
        except Exception:  # noqa: BLE001
            continue
    return versions


def list_tools() -> list[ToolInfo]:
    """Every `aa-*` console tool visible to this environment, with versions."""
    scripts = _console_scripts()
    names = {name for name in scripts if name.startswith(TOOL_PREFIX)}

    bin_dir = _bin_dir()
    if bin_dir.is_dir():
        for entry in bin_dir.iterdir():
            if entry.name.startswith(TOOL_PREFIX) and entry.is_file():
                names.add(entry.name)

    tools: list[ToolInfo] = []
    for name in sorted(names):
        distribution, version = scripts.get(name, ("", ""))
        tools.append(
            ToolInfo(
                name=name,
                path=_resolve(name),
                distribution=distribution,
                version=version,
            )
        )
    return tools


def list_packages() -> list[PackageInfo]:
    """Versions for the small watch-list of libraries the toolset depends on."""
    raw = os.getenv("AASI_ENV_WATCH_PACKAGES", _DEFAULT_WATCH)
    wanted = [item.strip() for item in raw.split(",") if item.strip()]
    versions = _installed_versions()
    return [
        PackageInfo(name=name, version=versions.get(name.lower().replace("_", "-"), ""))
        for name in wanted
    ]


def _configured_command() -> list[str]:
    """The update argv: `aa-setup` unless AASI_UPDATE_COMMAND overrides it."""
    override = os.getenv("AASI_UPDATE_COMMAND", "").strip()
    return shlex.split(override) if override else ["aa-setup"]


def _describe_action(action_id: str) -> UpdateAction:
    command = UPDATE_ACTIONS[action_id]["command"]()
    resolved = _resolve(command[0]) if command else ""
    return UpdateAction(
        id=action_id,
        label=UPDATE_ACTIONS[action_id]["label"],
        description=UPDATE_ACTIONS[action_id]["description"],
        command=command,
        resolvedPath=resolved,
        available=bool(resolved),
    )


# The allow-list. A request may only name a key here; the argv is built server
# side. Add an entry to expose another maintenance command to the UI.
UPDATE_ACTIONS: dict[str, dict] = {
    "environment": {
        "label": "Update Python environment",
        "description": (
            "Runs aa-setup, which reinstalls the AA-SI toolset and its "
            "dependencies into this virtual environment."
        ),
        "command": _configured_command,
    },
}


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _update_block_reason() -> str:
    """Why the updater is refused, or "" when it may run."""
    host = os.getenv("AASI_BIND_HOST", "").strip()
    loopback = {"", "127.0.0.1", "localhost", "::1"}
    if host not in loopback and not _truthy(os.getenv("AASI_ALLOW_REMOTE_UPDATE")):
        return (
            f"The server is bound to {host}, so anyone who can reach this port "
            "could trigger an environment rewrite. Serve on 127.0.0.1, or set "
            "AASI_ALLOW_REMOTE_UPDATE=true if the host is trusted."
        )
    return ""


def environment_info() -> EnvironmentInfo:
    prefix = Path(sys.prefix)
    in_venv = sys.prefix != sys.base_prefix
    reason = _update_block_reason()
    return EnvironmentInfo(
        workbenchVersion=__version__,
        pythonVersion=sys.version.split()[0],
        pythonExecutable=sys.executable,
        prefix=str(prefix),
        venvName=prefix.name,
        isVirtualEnv=in_venv,
        expectedVenvName=EXPECTED_VENV_NAME,
        matchesExpected=in_venv and prefix.name == EXPECTED_VENV_NAME,
        platform=f"{sys.platform} ({os.name})",
        tools=list_tools(),
        packages=list_packages(),
        actions=[_describe_action(key) for key in UPDATE_ACTIONS],
        updateEnabled=not reason,
        updateDisabledReason=reason,
    )


# --------------------------------------------------------------------------- #
# The update job (single-flight, buffered, cancellable)
# --------------------------------------------------------------------------- #
def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


@dataclass
class _Job:
    state: str = "idle"
    action: str = ""
    command: list[str] = field(default_factory=list)
    started_at: str = ""
    finished_at: str = ""
    exit_code: int | None = None
    error: str = ""
    lines: list[str] = field(default_factory=list)
    dropped: int = 0  # lines discarded off the front of the buffer
    process: subprocess.Popen | None = None
    cancelled: bool = False


_job = _Job()
_lock = threading.RLock()


def _clean(chunk: str) -> str:
    """Strip ANSI colour and collapse carriage-return progress redraws."""
    text = chunk.rstrip("\n")
    if "\r" in text:  # pip progress bars redraw one line many times
        parts = [part for part in text.split("\r") if part.strip()]
        text = parts[-1] if parts else ""
    return _ANSI.sub("", text)


def _append(text: str) -> None:
    with _lock:
        _job.lines.append(text)
        if len(_job.lines) > _MAX_LINES:
            del _job.lines[:_DROP_CHUNK]
            _job.dropped += _DROP_CHUNK


def _pump(process: subprocess.Popen) -> None:
    """Drain the child's merged stdout/stderr, then record the outcome."""
    try:
        assert process.stdout is not None
        for raw in process.stdout:
            _append(_clean(raw))
        code = process.wait()
    except Exception as exc:  # noqa: BLE001 - report, never crash the thread
        with _lock:
            _job.state = "failed"
            _job.error = f"{type(exc).__name__}: {exc}"
            _job.finished_at = _now()
            _job.process = None
        return

    with _lock:
        _job.exit_code = code
        _job.finished_at = _now()
        _job.process = None
        if _job.cancelled:
            _job.state = "cancelled"
        elif code == 0:
            _job.state = "succeeded"
        else:
            _job.state = "failed"
            program = _job.command[0] if _job.command else "command"
            _job.error = f"{program} exited {code}"
        _append(f"--- {_job.state} (exit {code}) at {_job.finished_at} ---")


def start_update(action_id: str) -> None:
    """Launch an allow-listed update. Raises HTTPException on refusal."""
    if action_id not in UPDATE_ACTIONS:
        raise HTTPException(
            status_code=400, detail=f"Unknown update action: {action_id}"
        )

    reason = _update_block_reason()
    if reason:
        raise HTTPException(status_code=403, detail=reason)

    action = _describe_action(action_id)
    if not action.available:
        raise HTTPException(
            status_code=404,
            detail=(
                f"`{action.command[0]}` was not found in {_bin_dir()} or on PATH. "
                "Activate the AA-SI environment before starting the Workbench, or "
                "set AASI_UPDATE_COMMAND."
            ),
        )

    with _lock:
        if _job.state == "running":
            raise HTTPException(status_code=409, detail="An update is already running.")

        argv = [action.resolvedPath, *action.command[1:]]
        env = {
            **os.environ,
            "PYTHONUNBUFFERED": "1",
            "PIP_DISABLE_PIP_VERSION_CHECK": "1",
            "NO_COLOR": "1",
            "TERM": "dumb",
        }
        try:
            process = subprocess.Popen(  # noqa: S603 - argv is server-defined
                argv,
                cwd=str(Path.home()),
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                # Own process group so cancel can reach pip and its children.
                start_new_session=os.name != "nt",
            )
        except OSError as exc:
            raise HTTPException(
                status_code=500, detail=f"Could not start: {exc}"
            ) from exc

        _job.state = "running"
        _job.action = action_id
        _job.command = argv
        _job.started_at = _now()
        _job.finished_at = ""
        _job.exit_code = None
        _job.error = ""
        _job.lines = []
        _job.dropped = 0
        _job.cancelled = False
        _job.process = process

    _append(f"$ {shlex.join(argv)}")
    _append(f"--- started {_job.started_at} (cwd {Path.home()}) ---")
    threading.Thread(
        target=_pump, args=(process,), daemon=True, name="aa-update"
    ).start()


def cancel_update() -> None:
    with _lock:
        process = _job.process
        if _job.state != "running" or process is None:
            raise HTTPException(status_code=409, detail="No update is running.")
        _job.cancelled = True
        _append("--- cancelling… ---")

    try:
        if os.name != "nt" and hasattr(os, "killpg"):
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
        else:
            process.terminate()
    except (ProcessLookupError, PermissionError):
        process.terminate()


def job_status(since: int = 0) -> UpdateJobStatus:
    with _lock:
        start = max(since, _job.dropped)
        offset = start - _job.dropped
        visible = _job.lines[offset:] if offset < len(_job.lines) else []
        return UpdateJobStatus(
            state=_job.state,
            action=_job.action,
            command=_job.command,
            startedAt=_job.started_at,
            finishedAt=_job.finished_at,
            exitCode=_job.exit_code,
            error=_job.error,
            lines=visible,
            cursor=start,
            nextCursor=_job.dropped + len(_job.lines),
            truncated=since < _job.dropped,
        )


def _reset_for_tests() -> None:
    """Test hook: drop all job state."""
    global _job
    with _lock:
        _job = _Job()


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
router = APIRouter(prefix="/api/env", tags=["environment"])


@router.get("", response_model=EnvironmentInfo)
def get_environment() -> EnvironmentInfo:
    return environment_info()


@router.get("/update", response_model=UpdateJobStatus)
def get_update(since: int = Query(0, ge=0)) -> UpdateJobStatus:
    return job_status(since)


@router.post("/update", response_model=UpdateJobStatus)
def post_update(body: UpdateRequest | None = None) -> UpdateJobStatus:
    start_update((body or UpdateRequest()).action)
    return job_status(0)


@router.post("/update/cancel", response_model=UpdateJobStatus)
def post_cancel() -> UpdateJobStatus:
    cancel_update()
    return job_status(0)
