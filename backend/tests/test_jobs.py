"""Tests for the job runner and the Zarr-leaf listing fix.

The runner is exercised against a real child process rather than a mock. Three
of the four properties under test — that stdin is closed, that the streams stay
separate, that a signal is mapped correctly — only exist at the process
boundary, and a mocked ``Popen`` would assert that the code says what it says.
"""

from __future__ import annotations

import os
import stat
import sys
import time
from pathlib import Path

import pytest

from aa_si_workbench.api import derived, jobs

# --------------------------------------------------------------------------- #
# A stand-in aa-* tool
# --------------------------------------------------------------------------- #
TOOL_SOURCE = '''#!/usr/bin/env python3
import json, sys
args = sys.argv[1:]
code = 0
for i, a in enumerate(args):
    if a == "--exit":
        code = int(args[i + 1])
# If the runner left an open pipe on stdin this read never returns and the
# test times out — which is the point.
data = sys.stdin.read()
if "--progress" in args:
    for n in (1, 2):
        sys.stderr.write(json.dumps({"t": "T", "stage": "aa-probe", "event": "progress",
                                     "done": n, "total": 2, "unit": "files"}) + "\\n")
sys.stderr.write("INFO | working\\n")
sys.stderr.write('{"unrelated": "json"}\\n')
if "--json" in args:
    print(json.dumps({"schema": "aa/1", "kind": "l1", "uri": "file:///tmp/L1.zarr"}))
else:
    print("/tmp/L1.zarr")
sys.stderr.write("stdin_bytes=%d\\n" % len(data))
sys.exit(code)
'''


@pytest.fixture()
def probe_tool(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    tool = bin_dir / "aa-probe"
    tool.write_text(
        TOOL_SOURCE.replace("#!/usr/bin/env python3", f"#!{sys.executable}")
    )
    tool.chmod(tool.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    jobs._reset_for_tests()
    return tool


def _await(job: jobs._Job, timeout: float = 20.0) -> jobs.JobStatus:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status = jobs._status(job)
        if status.state in jobs.FINAL_STATES:
            return status
        time.sleep(0.05)
    raise AssertionError(f"job did not finish: {jobs._status(job).state}")


def _run(args: list[str]) -> jobs.JobStatus:
    return _await(jobs.submit(jobs.JobRequest(tool="probe", args=args)))


# --------------------------------------------------------------------------- #
# The stdin deadlock
# --------------------------------------------------------------------------- #
def test_stdin_is_closed_so_a_flags_only_command_cannot_hang(probe_tool: Path) -> None:
    """The failure this guards is a hang, so reaching the assert is the test.

    A tool given no positionals falls back to reading stdin. Invoked by a job
    runner with an inherited open pipe that nobody ever writes to, that read
    blocks forever — which is exactly how a flags-only command is invoked.
    """
    status = _run(["--json"])
    assert status.state == "succeeded"
    assert "stdin_bytes=0" in status.lines


# --------------------------------------------------------------------------- #
# stdout is a value, not a log
# --------------------------------------------------------------------------- #
def test_stdout_and_stderr_are_reported_separately(probe_tool: Path) -> None:
    status = _run(["--json"])
    # The handle is alone on stdout, with no loguru output interleaved into it.
    assert status.stdout == ['{"schema": "aa/1", "kind": "l1", "uri": "file:///tmp/L1.zarr"}']
    assert status.handle == {"schema": "aa/1", "kind": "l1", "uri": "file:///tmp/L1.zarr"}
    assert any("INFO | working" in line for line in status.lines)
    assert not any("aa/1" in line for line in status.lines)


def test_a_bare_path_on_stdout_is_not_parsed_as_a_handle(probe_tool: Path) -> None:
    status = _run([])
    assert status.stdout == ["/tmp/L1.zarr"]
    assert status.handle is None


# --------------------------------------------------------------------------- #
# Progress
# --------------------------------------------------------------------------- #
def test_progress_events_are_parsed_out_of_the_log(probe_tool: Path) -> None:
    status = _run(["--progress"])
    assert status.progress is not None
    assert (status.progress.done, status.progress.total) == (2, 2)
    assert status.progress.unit == "files"
    # The events themselves do not pollute the log…
    assert not any('"event"' in line for line in status.lines)
    # …but JSON that is not a progress event is kept. Silently eating a tool's
    # output is worse than an ugly log.
    assert any("unrelated" in line for line in status.lines)


# --------------------------------------------------------------------------- #
# Exit codes
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    ("code", "state", "resumable"),
    [
        (0, "succeeded", False),
        (1, "failed", False),
        (2, "usage", False),
        (3, "partial", True),
        (4, "qcFailed", False),
    ],
)
def test_each_exit_code_gets_its_own_state(
    probe_tool: Path, code: int, state: str, resumable: bool
) -> None:
    """Collapsing these into ok/failed is what makes a queue panel useless.

    3 is resumable and 4 is not, and that distinction is the reason the runner
    reads exit codes at all rather than testing ``== 0``.
    """
    status = _run(["--exit", str(code)])
    assert status.state == state
    assert status.resumable is resumable


def test_an_unknown_exit_code_is_a_failure_not_a_crash(probe_tool: Path) -> None:
    status = _run(["--exit", "42"])
    assert status.state == "failed"
    assert "42" in status.error


# --------------------------------------------------------------------------- #
# Resume
# --------------------------------------------------------------------------- #
def test_resume_reruns_the_same_argv(probe_tool: Path) -> None:
    first = _run(["--exit", "3", "--json"])
    resumed = jobs.resume(first.id)
    assert resumed.command[1:] == ["--exit", "3", "--json"]
    assert resumed.resumed_from == first.id


@pytest.mark.parametrize("code", [0, 1, 2, 4])
def test_resume_is_refused_for_anything_but_exit_three(
    probe_tool: Path, code: int
) -> None:
    """Exit 2 will be wrong again; exit 4 re-run is exit 4 hidden."""
    from fastapi import HTTPException

    status = _run(["--exit", str(code)])
    with pytest.raises(HTTPException) as excinfo:
        jobs.resume(status.id)
    assert excinfo.value.status_code == 409


# --------------------------------------------------------------------------- #
# Tool resolution
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("name", ["sh", "python", "bash"])
def test_only_aa_prefixed_tools_resolve(probe_tool: Path, name: str) -> None:
    from fastapi import HTTPException

    with pytest.raises(HTTPException):
        jobs.resolve_tool(name)


@pytest.mark.parametrize("name", ["../../bin/python", "./probe", ".hidden", "aa-;rm"])
def test_path_traversal_and_metacharacters_are_refused(
    probe_tool: Path, name: str
) -> None:
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as excinfo:
        jobs.resolve_tool(name)
    assert excinfo.value.status_code == 400


def test_the_prefix_is_optional_in_the_request(probe_tool: Path) -> None:
    assert jobs.resolve_tool("probe") == jobs.resolve_tool("aa-probe")


# --------------------------------------------------------------------------- #
# The Zarr-leaf listing fix
# --------------------------------------------------------------------------- #
class _Blob:
    def __init__(self, name: str, exists: bool) -> None:
        self.name = name
        self._exists = exists

    def exists(self, _client: object) -> bool:
        return self._exists


class _Bucket:
    """Only the marker probe is exercised here."""

    def __init__(self, markers: set[str]) -> None:
        self._markers = markers

    def blob(self, name: str) -> _Blob:
        return _Blob(name, name in self._markers)


class _Iterator(list):
    prefixes: set[str] = set()


class _Client:
    def __init__(self, folders: set[str]) -> None:
        self._folders = folders
        self.calls: list[dict] = []

    def list_blobs(self, _bucket: object, **kwargs: object) -> _Iterator:
        self.calls.append(dict(kwargs))
        iterator = _Iterator()
        iterator.prefixes = set(self._folders)
        return iterator


def _provider(folders: set[str], markers: set[str]) -> derived.GcsProvider:
    provider = object.__new__(derived.GcsProvider)
    provider._client = _Client(folders)
    provider._bucket = _Bucket(markers)
    derived._store_probe_cache.clear()
    return provider


def test_a_dot_zarr_prefix_lists_as_a_leaf_not_a_folder() -> None:
    """Descending into a store enumerates every chunk, and the panel hangs.

    This is wiring-plan item 2: it blocks anything that lists derived output,
    and it is also what makes a store selectable at all.
    """
    provider = _provider({"HB1603_L1.zarr/"}, set())
    listing = provider.list("", 1000)
    entry = listing.entries[0]
    assert entry.isDir is False
    assert entry.kind == "zarr"
    assert entry.name == "HB1603_L1.zarr"
    assert entry.uri.endswith("HB1603_L1.zarr")  # no trailing slash on a leaf


def test_a_store_without_the_suffix_is_found_by_probing_for_a_marker() -> None:
    provider = _provider({"survey_output/"}, {"survey_output/zarr.json"})
    entry = provider.list("", 1000).entries[0]
    assert entry.isDir is False
    assert entry.kind == "zarr"


def test_an_ordinary_folder_is_still_a_folder() -> None:
    provider = _provider({"raw/"}, set())
    entry = provider.list("", 1000).entries[0]
    assert entry.isDir is True
    assert entry.kind == "folder"


def test_the_marker_probe_is_cached_rather_than_repeated() -> None:
    provider = _provider({"survey_output/"}, {"survey_output/.zgroup"})
    provider.list("", 1000)
    hits_before = len(derived._store_probe_cache)
    provider.list("", 1000)
    assert len(derived._store_probe_cache) == hits_before


def test_listing_a_store_prefix_answers_with_the_store_itself() -> None:
    """Never a listing. The listing is precisely the expensive operation."""
    provider = _provider(set(), {"HB1603_L1.zarr/zarr.json"})
    listing = provider.list("HB1603_L1.zarr/", 1000)
    assert len(listing.entries) == 1
    assert listing.entries[0].kind == "zarr"
    # No list_blobs call was made at all.
    assert provider._client.calls == []
