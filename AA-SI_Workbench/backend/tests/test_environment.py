"""Tests for environment inspection and the update job runner.

The runner is exercised for real — it starts an actual child process — using a
harmless stand-in command (this interpreter printing a few lines) injected
through ``AASI_UPDATE_COMMAND``. Nothing here runs ``aa-setup``.
"""

from __future__ import annotations

import shlex
import sys
import time

import pytest
from fastapi import HTTPException

from aa_si_workbench.api import environment as env


@pytest.fixture(autouse=True)
def _clean_job(monkeypatch: pytest.MonkeyPatch):
    """Isolate each test: fresh job state, loopback bind, no stray overrides."""
    monkeypatch.delenv("AASI_UPDATE_COMMAND", raising=False)
    monkeypatch.delenv("AASI_ALLOW_REMOTE_UPDATE", raising=False)
    monkeypatch.setenv("AASI_BIND_HOST", "127.0.0.1")
    env._reset_for_tests()
    yield
    if env._job.process is not None:
        env._job.process.kill()
    env._reset_for_tests()


def _use_fake_command(monkeypatch: pytest.MonkeyPatch, python_code: str) -> None:
    monkeypatch.setenv(
        "AASI_UPDATE_COMMAND", shlex.join([sys.executable, "-c", python_code])
    )


def _wait_for_terminal(timeout: float = 20.0) -> env.UpdateJobStatus:
    deadline = time.time() + timeout
    while time.time() < deadline:
        status = env.job_status()
        if status.state not in {"running"}:
            return status
        time.sleep(0.05)
    raise AssertionError("update job did not finish in time")


# --------------------------------------------------------------------------- #
# Inspection
# --------------------------------------------------------------------------- #
def test_environment_info_describes_this_interpreter() -> None:
    info = env.environment_info()
    assert info.pythonExecutable == sys.executable
    assert info.prefix == sys.prefix
    assert info.pythonVersion.startswith(f"{sys.version_info.major}.")
    assert info.expectedVenvName == "venv313"
    # matchesExpected is only true inside a venv named venv313.
    assert info.matchesExpected == (info.isVirtualEnv and info.venvName == "venv313")


def test_actions_are_reported_with_availability(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _use_fake_command(monkeypatch, "pass")
    info = env.environment_info()
    action = next(a for a in info.actions if a.id == "environment")
    assert action.command[0] == sys.executable
    assert action.available is True
    assert action.resolvedPath  # resolved to a real file


def test_missing_command_is_reported_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AASI_UPDATE_COMMAND", "aa-setup-that-does-not-exist")
    action = env._describe_action("environment")
    assert action.available is False
    assert action.resolvedPath == ""
    with pytest.raises(HTTPException) as excinfo:
        env.start_update("environment")
    assert excinfo.value.status_code == 404


def test_tools_and_packages_are_serialisable() -> None:
    info = env.environment_info()
    assert all(tool.name.startswith("aa-") for tool in info.tools)
    names = [package.name for package in info.packages]
    assert "aalibrary" in names  # default watch list
    assert all(isinstance(package.version, str) for package in info.packages)


def test_watch_list_is_configurable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AASI_ENV_WATCH_PACKAGES", "pytest, definitely-not-installed")
    packages = {p.name: p.version for p in env.list_packages()}
    assert packages["pytest"]  # installed -> a version string
    assert packages["definitely-not-installed"] == ""  # absent -> empty, not an error


# --------------------------------------------------------------------------- #
# Output cleaning
# --------------------------------------------------------------------------- #
def test_clean_strips_ansi_and_collapses_progress_redraws() -> None:
    assert env._clean("\x1b[32mok\x1b[0m\n") == "ok"
    assert env._clean("10%\r50%\r100%\n") == "100%"
    assert env._clean("\r\n") == ""


# --------------------------------------------------------------------------- #
# The job runner
# --------------------------------------------------------------------------- #
def test_successful_run_streams_output_and_records_exit_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _use_fake_command(monkeypatch, "print('installing aalibrary'); print('done')")
    env.start_update("environment")
    status = _wait_for_terminal()

    assert status.state == "succeeded"
    assert status.exitCode == 0
    assert status.startedAt and status.finishedAt
    body = "\n".join(status.lines)
    assert "installing aalibrary" in body
    assert "done" in body
    assert body.startswith("$ ")  # the command echo leads the log


def test_failure_is_reported_with_the_exit_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _use_fake_command(
        monkeypatch, "import sys; sys.stderr.write('boom\\n'); sys.exit(3)"
    )
    env.start_update("environment")
    status = _wait_for_terminal()

    assert status.state == "failed"
    assert status.exitCode == 3
    assert "exited 3" in status.error
    assert "boom" in "\n".join(status.lines)  # stderr is merged into the log


def test_cursor_returns_only_new_lines(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _use_fake_command(monkeypatch, "print('a'); print('b')")
    env.start_update("environment")
    final = _wait_for_terminal()

    assert final.cursor == 0
    tail = env.job_status(since=final.nextCursor)
    assert tail.lines == []
    assert tail.nextCursor == final.nextCursor
    assert tail.truncated is False

    middle = env.job_status(since=2)
    assert middle.cursor == 2
    assert middle.lines == final.lines[2:]


def test_second_start_while_running_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _use_fake_command(monkeypatch, "import time; time.sleep(5)")
    env.start_update("environment")
    with pytest.raises(HTTPException) as excinfo:
        env.start_update("environment")
    assert excinfo.value.status_code == 409

    env.cancel_update()
    assert _wait_for_terminal().state == "cancelled"


def test_cancel_without_a_running_job_is_rejected() -> None:
    with pytest.raises(HTTPException) as excinfo:
        env.cancel_update()
    assert excinfo.value.status_code == 409


def test_cancel_terminates_the_child(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_fake_command(monkeypatch, "import time; print('working'); time.sleep(30)")
    env.start_update("environment")
    time.sleep(0.4)  # let it actually start
    env.cancel_update()
    status = _wait_for_terminal()
    assert status.state == "cancelled"


def test_unknown_action_is_rejected() -> None:
    with pytest.raises(HTTPException) as excinfo:
        env.start_update("rm-rf-everything")
    assert excinfo.value.status_code == 400


# --------------------------------------------------------------------------- #
# The loopback guard
# --------------------------------------------------------------------------- #
def test_non_loopback_bind_disables_the_updater(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _use_fake_command(monkeypatch, "pass")
    monkeypatch.setenv("AASI_BIND_HOST", "0.0.0.0")

    info = env.environment_info()
    assert info.updateEnabled is False
    assert "0.0.0.0" in info.updateDisabledReason

    with pytest.raises(HTTPException) as excinfo:
        env.start_update("environment")
    assert excinfo.value.status_code == 403


def test_non_loopback_bind_can_be_overridden(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _use_fake_command(monkeypatch, "print('ok')")
    monkeypatch.setenv("AASI_BIND_HOST", "0.0.0.0")
    monkeypatch.setenv("AASI_ALLOW_REMOTE_UPDATE", "true")

    assert env.environment_info().updateEnabled is True
    env.start_update("environment")
    assert _wait_for_terminal().state == "succeeded"
