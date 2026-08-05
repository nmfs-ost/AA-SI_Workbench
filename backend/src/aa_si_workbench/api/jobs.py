"""Job runner for the `aa-*` console tools — the engine behind Processing Queue.

Generalised from the single-flight `aa-setup` runner in ``environment.py``.
That one exists to rewrite this interpreter, so it is deliberately one-at-a-time
and merges the child's streams into a log. Neither property survives contact
with the tools:

* **stdout is a value, not a log.** Every `aa-*` tool prints the output path on
  stdout, or an ``aa/1`` handle line under ``--json``, and nothing else.
  ``environment.py`` passes ``stderr=subprocess.STDOUT``; doing that here would
  interleave loguru's output into the handle and destroy the one part of the run
  the next stage consumes. So the two streams are pumped separately and reported
  separately: ``stdout`` is the result, ``lines`` is the log.

* **stdin must be closed.** A tool invoked with flags alone and an inherited
  open pipe blocks on ``sys.stdin`` forever — a real deadlock hit last session,
  and exactly how a job runner invokes a command. Every child gets
  ``stdin=DEVNULL``. Without it the first flags-only combine hangs the queue.

* **A queue has more than one job.** Concurrency is bounded (``MAX_RUNNING``)
  rather than serialised, because `aa-store info` is a read-only listing that
  should never wait behind a combine.

Exit codes
----------
The tools use five, and the distinction between 3 and 4 is the entire reason
this module reads exit codes at all rather than testing ``== 0``::

    0  ok
    1  runtime error    — missing input, unreadable store, exception
    2  usage            — bad flags. argparse's own number.
    3  partial          — coherent and incomplete. **Resumable.**
    4  verify/QC failed — finished and wrong. Stop and look.

``3`` maps to a distinct state so the UI can offer **Resume** rather than a
generic failure, and ``4`` to another so a QC finding is not dressed up as a
crash. Anything else, or a signal, is ``failed``.

Progress
--------
Under ``--progress`` the tools write flat NDJSON to *stderr*::

    {"t":"…","stage":"aa-combine","event":"progress","done":9,"total":11,"unit":"files"}
    {"t":"…","stage":"aa-combine","event":"done","exit":0}

Those are parsed out of the stderr pump into ``progress`` and withheld from
``lines``, so the log stays readable and the progress bar has numbers. A line
that parses as JSON but is not one of these events is left in the log rather
than swallowed — silently eating a tool's output is worse than an ugly log.

Security
--------
The client never supplies a command. It names a **tool** and a list of
**arguments**; argv is built here as ``[resolved_tool, *args]`` and run with
``shell=False``. The program must resolve to an ``aa-``-prefixed console script
in this environment's bin directory or on PATH, so a request cannot name
``/bin/sh``. Arguments pass through unparsed because with ``shell=False`` they
reach ``execve`` as literal strings — there is no shell to inject into. The
values are the user's own paths and flags, which is the authority they already
have in the Terminal panel.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import threading
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/jobs", tags=["jobs"])

# Console-script prefix. The allow-list is structural rather than enumerated:
# anything installed as `aa-*` in this environment is a tool the Workbench may
# run — the same set /api/env already reports and the Terminal panel can reach.
TOOL_PREFIX = "aa-"

# How many children may run at once. Combines are IO- and memory-heavy, and two
# on one workstation is usually slower than one.
MAX_RUNNING = max(1, int(os.getenv("AASI_MAX_RUNNING_JOBS", "2")))

# Ring buffer per job. A season-long combine logs steadily for an hour.
_MAX_LINES = 4000
_DROP_CHUNK = 500

# Finished jobs retained for inspection before eviction.
_MAX_JOBS = 60

_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


# --------------------------------------------------------------------------- #
# Exit-code vocabulary
# --------------------------------------------------------------------------- #
# Named here rather than in the frontend because they are a fact about the
# tools, and a number re-derived in TypeScript from prose goes stale silently.
EXIT_STATES: dict[int, tuple[str, str]] = {
    0: ("succeeded", ""),
    1: ("failed", "Runtime error — missing input, unreadable store, or an exception."),
    2: ("usage", "Bad flags or misuse. Rejected before any work was done."),
    3: (
        "partial",
        "Coherent but incomplete. The write marker says the write did not "
        "finish, so this can be resumed.",
    ),
    4: (
        "qcFailed",
        "A QC pass found something, or a finished store verified wrong. "
        "Nothing to resume — read the findings first.",
    ),
}

#: States the UI may offer Resume for. Only 3.
RESUMABLE_STATES = frozenset({"partial"})

#: Terminal states — nothing further will change on these jobs.
FINAL_STATES = frozenset(
    {"succeeded", "failed", "usage", "partial", "qcFailed", "cancelled"}
)


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


# --------------------------------------------------------------------------- #
# Wire models
# --------------------------------------------------------------------------- #
class Progress(BaseModel):
    """The latest `--progress` event. Zeroed until the tool emits one."""

    stage: str = ""
    done: int = 0
    total: int = 0
    unit: str = ""
    updatedAt: str = ""


class JobStatus(BaseModel):
    id: str
    tool: str
    label: str
    command: list[str]
    cwd: str
    state: str
    exitCode: int | None = None
    #: Plain-language reading of the exit code. Empty on success.
    verdict: str = ""
    #: True only for exit 3. What the Resume button keys off.
    resumable: bool = False
    #: Set when this job was started by resuming another; carries that job's id.
    resumedFrom: str = ""
    queuedAt: str = ""
    startedAt: str = ""
    finishedAt: str = ""
    #: The child's stdout, verbatim and unmerged: a path, or an `aa/1` handle.
    stdout: list[str] = Field(default_factory=list)
    #: Parsed handle when stdout was a single `aa/1` JSON line, else null.
    handle: dict | None = None
    progress: Progress | None = None
    #: Failure of the runner itself, distinct from the tool's own exit code.
    error: str = ""
    #: stderr log from `cursor`, ANSI-stripped, progress events removed.
    lines: list[str] = Field(default_factory=list)
    cursor: int = 0
    nextCursor: int = 0
    truncated: bool = False


class JobList(BaseModel):
    jobs: list[JobStatus]
    running: int
    queued: int
    maxRunning: int


class JobRequest(BaseModel):
    #: Tool name, with or without the `aa-` prefix: "combine" or "aa-combine".
    tool: str
    #: argv[1:]. Never a shell string.
    args: list[str] = Field(default_factory=list)
    #: Shown in the queue instead of the raw command. Cosmetic only.
    label: str = ""
    #: Working directory. Must be an existing directory; defaults to $HOME.
    cwd: str = ""


# --------------------------------------------------------------------------- #
# Job state
# --------------------------------------------------------------------------- #
@dataclass
class _Job:
    id: str
    tool: str
    label: str
    command: list[str]
    cwd: str
    state: str = "queued"
    exit_code: int | None = None
    resumed_from: str = ""
    queued_at: str = field(default_factory=_now)
    started_at: str = ""
    finished_at: str = ""
    stdout: list[str] = field(default_factory=list)
    progress: dict | None = None
    error: str = ""
    lines: list[str] = field(default_factory=list)
    dropped: int = 0
    process: subprocess.Popen | None = None
    cancelled: bool = False


_jobs: OrderedDict[str, _Job] = OrderedDict()
_lock = threading.RLock()


# --------------------------------------------------------------------------- #
# Resolving a tool
# --------------------------------------------------------------------------- #
def _bin_dir() -> Path:
    """The bin/Scripts directory of the environment this server runs in."""
    return Path(sys.executable).parent


def resolve_tool(name: str) -> str:
    """Absolute path to an `aa-*` console script, or raise.

    Accepts "combine" or "aa-combine" — the frontend should not have to know
    which spelling this endpoint prefers. The prefix is *enforced*, not merely
    added, so a request naming `sh` or `../../bin/python` is refused rather
    than silently rewritten into something that exists.
    """
    stem = name.strip()
    if not stem:
        raise HTTPException(status_code=400, detail="No tool named.")
    if "/" in stem or "\\" in stem or stem.startswith("."):
        raise HTTPException(status_code=400, detail=f"Not a tool name: {name!r}")
    if not stem.startswith(TOOL_PREFIX):
        stem = f"{TOOL_PREFIX}{stem}"
    if not re.fullmatch(r"aa-[a-z0-9][a-z0-9._-]*", stem):
        raise HTTPException(status_code=400, detail=f"Not a tool name: {name!r}")

    local = _bin_dir() / stem
    if local.exists():
        return str(local)
    found = shutil.which(stem)
    if found:
        return found
    raise HTTPException(
        status_code=404,
        detail=(
            f"`{stem}` was not found in {_bin_dir()} or on PATH. Start the "
            "Workbench from the environment the aa-* tools are installed in."
        ),
    )


def _resolve_cwd(raw: str) -> str:
    if not raw:
        return str(Path.home())
    path = Path(raw).expanduser()
    if not path.is_dir():
        raise HTTPException(status_code=400, detail=f"Not a directory: {raw}")
    return str(path.resolve())


# --------------------------------------------------------------------------- #
# Output handling
# --------------------------------------------------------------------------- #
def _clean(chunk: str) -> str:
    """Strip ANSI colour and collapse carriage-return progress redraws."""
    text = chunk.rstrip("\n")
    if "\r" in text:
        parts = [part for part in text.split("\r") if part.strip()]
        text = parts[-1] if parts else ""
    return _ANSI.sub("", text)


def _append(job: _Job, text: str) -> None:
    with _lock:
        job.lines.append(text)
        if len(job.lines) > _MAX_LINES:
            del job.lines[:_DROP_CHUNK]
            job.dropped += _DROP_CHUNK


def _consume_progress(job: _Job, text: str) -> bool:
    """Take an NDJSON progress event off stderr. True if it was one.

    Only the two documented events are intercepted. Anything else that happens
    to be JSON stays in the log, because a tool's output is worth more in the
    wrong pane than nowhere.
    """
    stripped = text.strip()
    if not stripped.startswith("{") or '"event"' not in stripped:
        return False
    try:
        event = json.loads(stripped)
    except json.JSONDecodeError:
        return False
    if not isinstance(event, dict):
        return False
    name = event.get("event")
    if name == "progress":
        with _lock:
            job.progress = {
                "stage": str(event.get("stage") or job.tool),
                "done": int(event.get("done") or 0),
                "total": int(event.get("total") or 0),
                "unit": str(event.get("unit") or ""),
                "updatedAt": str(event.get("t") or _now()),
            }
        return True
    if name == "done":
        # The exit code arrives authoritatively from wait(); this event only
        # tells us the tool reached its own end, so top out the bar.
        with _lock:
            if job.progress and job.progress.get("total"):
                job.progress["done"] = job.progress["total"]
                job.progress["updatedAt"] = str(event.get("t") or _now())
        return True
    return False


def _pump_stdout(job: _Job, stream) -> None:
    """stdout is the *result*. Kept whole, never merged into the log."""
    try:
        for raw in stream:
            line = raw.rstrip("\n")
            if line.strip():
                with _lock:
                    job.stdout.append(line)
    except Exception:  # noqa: BLE001 - a dead stream must not kill the thread
        pass


def _pump_stderr(job: _Job, stream) -> None:
    try:
        for raw in stream:
            text = _clean(raw)
            if not text:
                continue
            if _consume_progress(job, text):
                continue
            _append(job, text)
    except Exception:  # noqa: BLE001
        pass


def _wait(
    job: _Job, process: subprocess.Popen, threads: list[threading.Thread]
) -> None:
    """Wait for the child, then record the verdict and start the next job."""
    try:
        code = process.wait()
        for thread in threads:
            thread.join(timeout=5)
    except Exception as exc:  # noqa: BLE001 - report, never crash the thread
        with _lock:
            job.state = "failed"
            job.error = f"{type(exc).__name__}: {exc}"
            job.finished_at = _now()
            job.process = None
        _drain_queue()
        return

    with _lock:
        job.exit_code = code
        job.finished_at = _now()
        job.process = None
        if job.cancelled:
            job.state = "cancelled"
        elif code in EXIT_STATES:
            job.state = EXIT_STATES[code][0]
        elif code < 0:
            # Killed by a signal. -15 is the SIGTERM the cancel path sends;
            # anything else here is the OOM killer or an outside `kill`.
            job.state = "failed"
            job.error = f"Terminated by signal {-code}."
        else:
            job.state = "failed"
            job.error = f"{job.tool} exited {code}."
        _append(job, f"--- {job.state} (exit {code}) at {job.finished_at} ---")

    _drain_queue()


# --------------------------------------------------------------------------- #
# Scheduling
# --------------------------------------------------------------------------- #
def _running_count() -> int:
    return sum(1 for job in _jobs.values() if job.state == "running")


def _evict() -> None:
    """Drop the oldest finished jobs once the table is too long."""
    if len(_jobs) <= _MAX_JOBS:
        return
    for job_id, job in list(_jobs.items()):
        if len(_jobs) <= _MAX_JOBS:
            break
        if job.state in FINAL_STATES:
            del _jobs[job_id]


def _spawn(job: _Job) -> None:
    """Start one queued job. Caller holds the lock."""
    env = {
        **os.environ,
        "PYTHONUNBUFFERED": "1",
        "NO_COLOR": "1",
        "TERM": "dumb",
    }
    try:
        process = subprocess.Popen(  # noqa: S603 - argv[0] is resolved server-side
            job.command,
            cwd=job.cwd,
            env=env,
            # THE deadlock guard. A tool with no positionals and an inherited
            # open pipe waits on stdin forever; DEVNULL gives it an immediate
            # EOF so input resolution falls through to --workdir or the CWD.
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            # Own process group, so cancelling reaches the tool's children too.
            start_new_session=os.name != "nt",
        )
    except OSError as exc:
        job.state = "failed"
        job.error = f"Could not start: {exc}"
        job.finished_at = _now()
        return

    job.state = "running"
    job.started_at = _now()
    job.process = process

    threads = [
        threading.Thread(
            target=_pump_stdout, args=(job, process.stdout), daemon=True,
            name=f"{job.tool}-out",
        ),
        threading.Thread(
            target=_pump_stderr, args=(job, process.stderr), daemon=True,
            name=f"{job.tool}-err",
        ),
    ]
    for thread in threads:
        thread.start()

    _append(job, f"$ {shlex.join(job.command)}")
    _append(job, f"--- started {job.started_at} (cwd {job.cwd}) ---")
    threading.Thread(
        target=_wait, args=(job, process, threads), daemon=True, name=f"{job.tool}-wait"
    ).start()


def _drain_queue() -> None:
    """Start queued jobs up to the concurrency limit, oldest first."""
    with _lock:
        for job in _jobs.values():
            if _running_count() >= MAX_RUNNING:
                return
            if job.state == "queued":
                _spawn(job)


# --------------------------------------------------------------------------- #
# Public operations
# --------------------------------------------------------------------------- #
def submit(request: JobRequest, resumed_from: str = "") -> _Job:
    program = resolve_tool(request.tool)
    cwd = _resolve_cwd(request.cwd)
    args = [str(item) for item in request.args]
    tool = Path(program).name

    job = _Job(
        id=uuid.uuid4().hex[:12],
        tool=tool,
        label=request.label.strip() or f"{tool} {' '.join(args)}".strip(),
        command=[program, *args],
        cwd=cwd,
        resumed_from=resumed_from,
    )
    with _lock:
        _jobs[job.id] = job
        _evict()
    _drain_queue()
    return job


def cancel(job_id: str) -> _Job:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail=f"No job {job_id}.")
        if job.state == "queued":
            job.state = "cancelled"
            job.finished_at = _now()
            return job
        process = job.process
        if job.state != "running" or process is None:
            raise HTTPException(status_code=409, detail="That job is not running.")
        job.cancelled = True
        _append(job, "--- cancelling… ---")

    # SIGTERM rather than SIGKILL, deliberately: aa-combine installs a SIGTERM
    # handler that stamps `aa_write` with complete=false before it dies, which
    # is what makes the interrupted store report exit 3 (resumable) rather than
    # looking indistinguishable from a sparse one. SIGKILL would lose that.
    try:
        if os.name != "nt" and hasattr(os, "killpg"):
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
        else:
            process.terminate()
    except (ProcessLookupError, PermissionError):
        process.terminate()
    return job


def resume(job_id: str) -> _Job:
    """Re-run a partial job.

    Honest about what this is: none of the tools has a ``--resume`` flag, so
    resuming means running the same argv again. That is useful anyway, because
    exit 3 means the *inputs and settings were fine* and the write was
    interrupted — the same command is the right command. It is offered only for
    exit 3 so it never becomes a retry button that papers over exit 2 (the
    command line is wrong and will be wrong again) or exit 4 (the data has a
    finding, and re-running hides it).
    """
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail=f"No job {job_id}.")
        if job.state not in RESUMABLE_STATES:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Job {job_id} is {job.state}, not partial. Only an "
                    "interrupted run (exit 3) can be resumed."
                ),
            )
        args = job.command[1:]
        request = JobRequest(
            tool=job.tool, args=args, label=f"{job.label} (resumed)", cwd=job.cwd
        )
    return submit(request, resumed_from=job_id)


def _status(job: _Job, since: int = 0) -> JobStatus:
    with _lock:
        start = max(since, job.dropped)
        offset = start - job.dropped
        visible = job.lines[offset:] if offset < len(job.lines) else []

        handle: dict | None = None
        # A handle is one JSON object on a line of its own. Several lines means
        # an NDJSON stream (aa-store over many stores) and there is no single
        # handle to report; the caller reads `stdout` for those.
        if len(job.stdout) == 1 and job.stdout[0].lstrip().startswith("{"):
            try:
                parsed = json.loads(job.stdout[0])
                if isinstance(parsed, dict):
                    handle = parsed
            except json.JSONDecodeError:
                handle = None

        verdict = ""
        if job.exit_code is not None and job.state != "cancelled":
            verdict = EXIT_STATES.get(job.exit_code, ("", ""))[1]

        return JobStatus(
            id=job.id,
            tool=job.tool,
            label=job.label,
            command=job.command,
            cwd=job.cwd,
            state=job.state,
            exitCode=job.exit_code,
            verdict=verdict,
            resumable=job.state in RESUMABLE_STATES,
            resumedFrom=job.resumed_from,
            queuedAt=job.queued_at,
            startedAt=job.started_at,
            finishedAt=job.finished_at,
            stdout=list(job.stdout),
            handle=handle,
            progress=Progress(**job.progress) if job.progress else None,
            error=job.error,
            lines=visible,
            cursor=start,
            nextCursor=job.dropped + len(job.lines),
            truncated=since < job.dropped,
        )


def _reset_for_tests() -> None:
    global _jobs
    with _lock:
        _jobs = OrderedDict()


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@router.get("", response_model=JobList)
def list_jobs() -> JobList:
    """Every job the runner knows about, newest last.

    Log lines are omitted here — the queue shows state and progress, and the
    detail view fetches lines for one job from a cursor. Sending every job's
    log on every poll is how a queue panel becomes the most expensive thing in
    the application.
    """
    with _lock:
        jobs = [
            _status(job, since=job.dropped + len(job.lines))
            for job in _jobs.values()
        ]
        return JobList(
            jobs=jobs,
            running=_running_count(),
            queued=sum(1 for job in _jobs.values() if job.state == "queued"),
            maxRunning=MAX_RUNNING,
        )


@router.post("", response_model=JobStatus)
def post_job(body: JobRequest) -> JobStatus:
    return _status(submit(body))


@router.get("/{job_id}", response_model=JobStatus)
def get_job(job_id: str, since: int = Query(0, ge=0)) -> JobStatus:
    with _lock:
        job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"No job {job_id}.")
    return _status(job, since)


@router.post("/{job_id}/cancel", response_model=JobStatus)
def post_cancel(job_id: str) -> JobStatus:
    return _status(cancel(job_id))


@router.post("/{job_id}/resume", response_model=JobStatus)
def post_resume(job_id: str) -> JobStatus:
    return _status(resume(job_id))
