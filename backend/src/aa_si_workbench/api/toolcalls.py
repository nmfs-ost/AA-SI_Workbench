"""Console tools whose answer the Workbench reads.

A pipeline stage is a job whose output is a product; some tool runs are
questions instead: what calibration will echopype use (``aa-ecs --json``),
what does this line file hold (``aa-annotate --json``), make the echogram
tiles for this product (``aa-tiles``). They run exactly like any other job
(the Processing Queue shows them, pinned to the chosen GCP project), and this
module waits for them and reads their stdout: one line of JSON, or the
product's path.

The tools keep their usual download cache (``AA_CACHE_DIR``, default
``~/.cache/aalibrary``): asking twice about the same product does not fetch
it twice, and the cache checks each object's generation, so a product
rewritten in the bucket is fetched again.
"""

from __future__ import annotations

import json
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import jobs

router = APIRouter(prefix="/api/toolcalls", tags=["toolcalls"])

POLL_SECONDS = 0.2
_MAX_CALLS = 120


class Call(BaseModel):
    id: str
    tool: str
    label: str = ""
    state: Literal["running", "succeeded", "failed"] = "running"
    #: The parsed JSON line (when the tool answers in JSON).
    result: Any = None
    #: The last line of stdout (a product's path, for a tool that makes one).
    output: str = ""
    error: str = ""
    jobId: str = ""
    log: list[str] = Field(default_factory=list)
    startedAt: float = 0.0


class _Call:
    def __init__(self, call: Call, job, scratch: Path | None, want_json: bool):
        self.call = call
        self.job = job
        self.scratch = scratch
        self.want_json = want_json
        self.done = threading.Event()


_calls: dict[str, _Call] = {}
_lock = threading.RLock()


def scratch_dir(prefix: str) -> Path:
    from .baseline import run_root

    path = run_root() / f"{prefix}-{uuid.uuid4().hex[:10]}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def start(
    tool: str,
    args: list[str],
    *,
    label: str = "",
    want_json: bool = True,
    scratch: Path | None = None,
) -> Call:
    """Submit the tool as a job and follow it in the background."""
    cwd = scratch or scratch_dir("call")
    try:
        job = jobs.submit(
            jobs.JobRequest(tool=tool, args=args, cwd=str(cwd), label=label)
        )
    except HTTPException:
        shutil.rmtree(cwd, ignore_errors=True)
        raise
    call = Call(
        id=uuid.uuid4().hex[:12],
        tool=tool,
        label=label or tool,
        jobId=job.id,
        startedAt=time.time(),
    )
    entry = _Call(call, job, cwd, want_json)
    with _lock:
        _calls[call.id] = entry
        _evict()
    threading.Thread(
        target=_follow, args=(entry,), daemon=True, name=f"call-{tool}"
    ).start()
    return call.model_copy()


def _follow(entry: _Call) -> None:
    try:
        while True:
            status = jobs.status_of_job(entry.job)
            if status.state in jobs.FINAL_STATES:
                break
            time.sleep(POLL_SECONDS)
        log = jobs.tail_of_job(entry.job, 40)
        lines = [line for line in status.stdout if line.strip()]
        with _lock:
            call = entry.call
            call.log = log[-12:]
            call.output = lines[-1].strip() if lines else ""
            if status.state != "succeeded":
                call.state = "failed"
                tail = [line for line in log if line.strip()][-4:]
                call.error = (
                    status.error
                    or status.verdict
                    or f"{entry.call.tool} {status.state}"
                )
                if tail:
                    call.error += "\n" + "\n".join(tail)
            elif entry.want_json:
                text = next(
                    (line for line in reversed(lines) if line.lstrip().startswith("{")),
                    "",
                )
                try:
                    call.result = json.loads(text)
                    call.state = "succeeded"
                except ValueError:
                    call.state = "failed"
                    call.error = f"{entry.call.tool} did not answer in JSON."
            else:
                call.state = "succeeded" if call.output else "failed"
                if not call.output:
                    call.error = f"{entry.call.tool} printed nothing."
    except Exception as exc:  # noqa: BLE001 - a call must always end
        with _lock:
            entry.call.state = "failed"
            entry.call.error = f"{type(exc).__name__}: {exc}"
    finally:
        if entry.scratch is not None:
            shutil.rmtree(entry.scratch, ignore_errors=True)
        entry.done.set()


def _evict() -> None:
    if len(_calls) <= _MAX_CALLS:
        return
    for key, entry in list(_calls.items()):
        if len(_calls) <= _MAX_CALLS:
            break
        if entry.done.is_set():
            del _calls[key]


def status(call_id: str) -> Call:
    with _lock:
        entry = _calls.get(call_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="No such tool call.")
        return entry.call.model_copy(deep=True)


def run(
    tool: str,
    args: list[str],
    *,
    label: str = "",
    want_json: bool = True,
    timeout: float = 180,
    scratch: Path | None = None,
) -> Call:
    """Start and wait. A call still running at the timeout keeps running
    (its job is in the queue); the caller gets it as it is."""
    call = start(tool, args, label=label, want_json=want_json, scratch=scratch)
    with _lock:
        entry = _calls[call.id]
    entry.done.wait(timeout)
    return status(call.id)


def _reset_for_tests() -> None:
    with _lock:
        _calls.clear()


@router.get("/{call_id}", response_model=Call)
def get_call(call_id: str) -> Call:
    return status(call_id)
