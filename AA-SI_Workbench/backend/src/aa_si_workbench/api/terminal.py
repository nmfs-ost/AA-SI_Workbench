"""An interactive terminal, served over a WebSocket.

A real PTY — not a command runner. The browser gets a shell with the user's own
privileges, which is the point: the Workbench orchestrates `aa-*` console tools,
and sometimes you need the console itself.

Read this before extending
--------------------------
This is deliberately the opposite of ``environment.py``. There, the client sends
an *action id* and the server builds the argv from an allow-list, because the
updater is a narrow, named operation. Here there is no allow-list and none is
possible: an interactive shell is arbitrary code execution by definition. Do not
"harden" this by filtering keystrokes — that would give the appearance of a
boundary without the substance of one.

The real boundary is the network. Like the updater, this refuses to open when
the API is bound to a non-loopback address unless ``AASI_ALLOW_REMOTE_TERMINAL``
is set. A terminal reachable off-host is a remote shell, and the loopback check
is the only thing standing between "developer convenience" and that.

The venv control
----------------
The Workbench drives tools installed in a specific virtualenv (``venv313`` on a
workstation). A shell that starts outside it can't see ``aa-fetch`` and the
mismatch is invisible until a command fails, so sessions activate a discovered
environment by prepending its ``bin/`` to PATH and exporting ``VIRTUAL_ENV`` —
the same thing ``activate`` does, minus the prompt cosmetics.
"""

from __future__ import annotations

import asyncio
import contextlib
import fcntl
import os
import pty
import shutil
import signal
import struct
import termios
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

router = APIRouter(prefix="/api/terminal")

# Read size per pump iteration. 64 KiB comfortably absorbs a burst of pip output
# without splitting escape sequences often enough to matter.
_READ_BYTES = 65536


class VenvInfo(BaseModel):
    name: str
    path: str
    pythonVersion: str = ""
    isCurrent: bool = False
    hasAaTools: bool = False


class TerminalInfo(BaseModel):
    available: bool
    disabledReason: str = ""
    shell: str
    cwd: str
    venvs: list[VenvInfo]
    currentVenv: str = ""


def _is_loopback(host: str) -> bool:
    return host in {"127.0.0.1", "::1", "localhost", ""}


def _disabled_reason() -> str:
    """Empty string when the terminal may run; otherwise why it may not."""
    host = os.getenv("AASI_BIND_HOST", "127.0.0.1")
    allow = os.getenv("AASI_ALLOW_REMOTE_TERMINAL", "").lower() in {"1", "true", "yes"}
    if not _is_loopback(host) and not allow:
        return (
            f"The terminal is disabled because the server is bound to {host}. "
            "A terminal reachable from another machine is a remote shell. Set "
            "AASI_ALLOW_REMOTE_TERMINAL=true only on a host where every user "
            "who can reach this port is trusted."
        )
    if not hasattr(os, "forkpty"):
        return "This platform has no PTY support."
    return ""


def _shell() -> str:
    return os.getenv("AASI_TERMINAL_SHELL") or os.getenv("SHELL") or "/bin/bash"


def _python_version(venv: Path) -> str:
    """Read the version from pyvenv.cfg rather than executing the interpreter."""
    cfg = venv / "pyvenv.cfg"
    try:
        for line in cfg.read_text().splitlines():
            key, _, value = line.partition("=")
            if key.strip() == "version":
                return value.strip()
    except OSError:
        pass
    # Fall back to the versioned lib directory, e.g. lib/python3.13.
    try:
        for child in (venv / "lib").iterdir():
            if child.name.startswith("python"):
                return child.name.removeprefix("python")
    except OSError:
        pass
    return ""


def discover_venvs() -> list[VenvInfo]:
    """Virtualenvs worth offering, most likely first.

    Looks at the environment this server runs in, the conventional AA-SI
    location, and the usual per-project spellings. Anything without a
    ``bin/python`` is not a virtualenv and is skipped.
    """
    home = Path.home()
    current = Path(os.getenv("VIRTUAL_ENV") or "").expanduser()
    if not current:
        # The server's own prefix is a venv when base_prefix differs.
        import sys

        if sys.prefix != getattr(sys, "base_prefix", sys.prefix):
            current = Path(sys.prefix)

    candidates: list[Path] = []
    if current:
        candidates.append(current)
    candidates += [
        home / "venv313",
        home / ".venv",
        home / "venv",
        Path.cwd() / ".venv",
        Path.cwd() / "venv",
    ]

    extra = os.getenv("AASI_VENV_SEARCH", "")
    candidates += [Path(p).expanduser() for p in extra.split(os.pathsep) if p.strip()]

    # Any ~/venv* the user made by hand.
    with contextlib.suppress(OSError):
        candidates += sorted(
            c for c in home.glob("venv*") if c.is_dir() and c not in candidates
        )

    out: list[VenvInfo] = []
    seen: set[str] = set()
    for path in candidates:
        try:
            resolved = path.expanduser().resolve()
        except OSError:
            continue
        key = str(resolved)
        if key in seen or not (resolved / "bin" / "python").exists():
            continue
        seen.add(key)
        out.append(
            VenvInfo(
                name=resolved.name,
                path=key,
                pythonVersion=_python_version(resolved),
                isCurrent=bool(current) and resolved == current.resolve(),
                hasAaTools=(resolved / "bin" / "aa-fetch").exists()
                or (resolved / "bin" / "aa-setup").exists(),
            )
        )
    return out


def _session_env(venv_path: str) -> dict[str, str]:
    """The child's environment, with a virtualenv activated if one was chosen."""
    env = dict(os.environ)
    env.setdefault("TERM", "xterm-256color")
    env["AA_WORKBENCH_TERMINAL"] = "1"
    # A pager that waits for input has nothing to talk to on first paint and
    # looks like a hang; git and friends respect this.
    env.setdefault("PAGER", "cat")

    if not venv_path:
        return env

    venv = Path(venv_path).expanduser().resolve()
    bin_dir = venv / "bin"
    if not (bin_dir / "python").exists():
        return env

    # What `activate` actually does: prepend bin/, set VIRTUAL_ENV, and drop
    # PYTHONHOME (which would otherwise override the venv's own paths).
    env["VIRTUAL_ENV"] = str(venv)
    env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
    env.pop("PYTHONHOME", None)
    return env


def _set_winsize(fd: int, rows: int, cols: int) -> None:
    with contextlib.suppress(OSError):
        fcntl.ioctl(
            fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0)
        )


@router.get("", response_model=TerminalInfo)
def terminal_info() -> TerminalInfo:
    """Whether a terminal can run here, and which environments it could use."""
    reason = _disabled_reason()
    venvs = discover_venvs()
    return TerminalInfo(
        available=not reason,
        disabledReason=reason,
        shell=_shell(),
        cwd=str(Path.cwd()),
        venvs=venvs,
        currentVenv=next((v.path for v in venvs if v.isCurrent), ""),
    )


@router.get("/venvs", response_model=list[VenvInfo])
def venvs() -> list[VenvInfo]:
    return discover_venvs()


@router.websocket("/ws")
async def terminal_ws(websocket: WebSocket) -> None:
    """One PTY per connection; closing the socket kills the session.

    Protocol: binary frames are raw PTY bytes in both directions. Text frames
    are JSON control messages from the client — ``{"type":"resize",...}``. Using
    the frame type to separate control from data avoids escaping keystrokes that
    happen to look like JSON.
    """
    reason = _disabled_reason()
    if reason:
        await websocket.close(code=1008, reason=reason[:120])
        return

    await websocket.accept()

    params = websocket.query_params
    venv_path = params.get("venv", "")
    try:
        rows = max(1, min(300, int(params.get("rows", "24"))))
        cols = max(1, min(500, int(params.get("cols", "80"))))
    except ValueError:
        rows, cols = 24, 80

    cwd = Path.home()
    requested_cwd = params.get("cwd", "")
    if requested_cwd:
        with contextlib.suppress(OSError):
            candidate = Path(requested_cwd).expanduser().resolve()
            if candidate.is_dir():
                cwd = candidate

    shell = _shell()
    if not shutil.which(shell) and not Path(shell).exists():
        shell = "/bin/sh"

    env = _session_env(venv_path)

    pid, fd = pty.fork()
    if pid == 0:  # child — never returns
        try:
            os.chdir(cwd)
            # Login shell so the user's rc files run, matching what they'd get
            # from a normal terminal on this machine.
            os.execvpe(shell, [shell, "-l"], env)
        except Exception:  # noqa: BLE001 - the child must not raise into asyncio
            os._exit(1)

    _set_winsize(fd, rows, cols)
    os.set_blocking(fd, False)

    loop = asyncio.get_running_loop()
    reader: asyncio.Queue[bytes] = asyncio.Queue()

    def _on_readable() -> None:
        try:
            data = os.read(fd, _READ_BYTES)
        except (BlockingIOError, InterruptedError):
            return
        except OSError:
            data = b""  # child exited; EOF
        reader.put_nowait(data)

    loop.add_reader(fd, _on_readable)

    async def pump_out() -> None:
        """PTY -> browser."""
        while True:
            data = await reader.get()
            if not data:
                return
            await websocket.send_bytes(data)

    async def pump_in() -> None:
        """browser -> PTY, plus resize control messages."""
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                return
            if (payload := message.get("bytes")) is not None:
                os.write(fd, payload)
            elif (text := message.get("text")) is not None:
                # Control channel. Malformed messages are ignored rather than
                # killing a session the user is in the middle of using.
                import json

                with contextlib.suppress(ValueError, KeyError, TypeError):
                    msg = json.loads(text)
                    if msg.get("type") == "resize":
                        _set_winsize(fd, int(msg["rows"]), int(msg["cols"]))

    out_task = asyncio.create_task(pump_out())
    in_task = asyncio.create_task(pump_in())
    try:
        await asyncio.wait(
            {out_task, in_task}, return_when=asyncio.FIRST_COMPLETED
        )
    except WebSocketDisconnect:
        pass
    finally:
        for task in (out_task, in_task):
            task.cancel()
        with contextlib.suppress(Exception):
            loop.remove_reader(fd)
        with contextlib.suppress(OSError):
            os.kill(pid, signal.SIGHUP)
        with contextlib.suppress(OSError):
            os.waitpid(pid, os.WNOHANG)
        with contextlib.suppress(OSError):
            os.close(fd)
        with contextlib.suppress(RuntimeError):
            await websocket.close()
