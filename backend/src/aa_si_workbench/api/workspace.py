"""The working space of a baseline run: where its files go, and whether they fit.

A run works through a folder on this machine: the raw files, the per-file
EchoData, and local copies of the combined EchoData and the Sv on their way
to the bucket. With console tools that stream (aalibrary with the memory fix:
aa-combine, aa-sv and aa-graph read and write a slice at a time), memory stays
about the same for any length of survey, and what limits a long range is the
free space under that folder. This module answers the questions the card asks
before a run:

* Where is the folder, and on what? A gcsfuse mount of a bucket is refused
  (HDF5 rewrites its files in place, which a bucket mount does by copying the
  whole file locally first, slowly, and a failure leaves partial objects).
  tmpfs is warned about (files there are RAM, which is what the folder is
  meant to spare; its size limit is checked like any disk's).
* How much space will the range need, at most, and is it free?
* How much memory will it need, given the tools that are installed?

The estimates are per byte of raw data and deliberately a little generous;
a run reports what it actually used, so they can be checked against reality.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path

#: Working space per byte of raw data, measured on EK60 files written in the
#: Simrad format (aalibrary's synthetic EK60 at survey length, converted and
#: combined by the console tools): each EchoData, per-file or combined, is
#: about twice the raw size, and Sv (Sv and echo_range, uncompressed float64)
#: about four and a half times.
ECHODATA_PER_RAW = 2.2
SV_PER_RAW = 4.5
#: Allowance on top: compression varies with the data.
MARGIN = 1.15

#: Memory per byte of raw data for console tools that read the whole range
#: (aalibrary before the memory fix): 12 EK60 files, 180 MB raw, took aa-combine
#: to 2.6 GB and aa-sv to 3.0 GB.
WHOLE_RANGE_MEMORY_PER_RAW = 16
#: For tools that stream: about this much, plus a little per input file
#: (0.3-0.7 GB measured for 6 to 48 files).
STREAMING_MEMORY_BASE = 1 << 30
STREAMING_MEMORY_PER_FILE = 8 << 20
#: Refuse a whole-range run that needs more than this share of the memory.
MEMORY_HEADROOM = 0.85

#: File systems that are not a local disk for this purpose.
BUCKET_MOUNTS = ("fuse.gcsfuse", "gcsfuse")
MEMORY_FILESYSTEMS = ("tmpfs", "ramfs")


# --------------------------------------------------------------------------- #
# Where a folder is
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Mount:
    point: str
    fstype: str
    source: str


def _unescape(field: str) -> str:
    """/proc mount fields escape space, tab, newline and backslash as octal."""
    out, i = [], 0
    while i < len(field):
        code = field[i + 1 : i + 4]
        if field[i] == "\\" and len(code) == 3 and code.isdigit():
            out.append(chr(int(code, 8)))
            i += 4
        else:
            out.append(field[i])
            i += 1
    return "".join(out)


def mounts(table: str | None = None) -> list[Mount]:
    """The mount table (/proc/self/mountinfo), or [] where there is none."""
    if table is None:
        try:
            table = Path("/proc/self/mountinfo").read_text()
        except OSError:
            return []
    found = []
    for line in table.splitlines():
        left, sep, right = line.partition(" - ")
        fields, tail = left.split(), right.split()
        if not sep or len(fields) < 5 or len(tail) < 2:
            continue
        found.append(
            Mount(point=_unescape(fields[4]), fstype=tail[0], source=_unescape(tail[1]))
        )
    return found


def _exists(path: Path) -> bool:
    try:
        return path.exists()
    except OSError:  # e.g. under a folder this user cannot enter
        return False


def nearest_existing(path: Path) -> Path:
    """The path itself if it exists, else its closest existing parent."""
    current = path
    while not _exists(current) and current != current.parent:
        current = current.parent
    return current


def is_dir(path: Path) -> bool:
    """Path.is_dir that answers False instead of raising."""
    try:
        return path.is_dir()
    except OSError:
        return False


def mount_of(path: Path, table: list[Mount] | None = None) -> Mount | None:
    """The mount a path is on: the longest mount point that contains it."""
    real = os.path.realpath(nearest_existing(path))
    best: Mount | None = None
    for mount in mounts() if table is None else table:
        point = mount.point.rstrip("/") or "/"
        inside = real == point or real.startswith(
            point if point == "/" else point + "/"
        )
        if inside and (
            best is None or len(point) >= len(best.point.rstrip("/") or "/")
        ):
            best = mount
    return best


def disk_space(path: Path) -> tuple[int, int]:
    """(free, total) bytes on the file system holding *path*."""
    try:
        usage = shutil.disk_usage(nearest_existing(path))
    except OSError:
        return 0, 0
    return int(usage.free), int(usage.total)


def folder_problem(path: Path, mount: Mount | None) -> str:
    """Why a run may not work in *path*, in words; '' when it may."""
    if mount is not None and (
        mount.fstype in BUCKET_MOUNTS or "gcsfuse" in mount.fstype
    ):
        return (
            f"{path} is on the gcsfuse mount of a bucket ({mount.point}). Working "
            "files are rewritten in place as they are made, which a bucket mount "
            "does only by copying each whole file to local disk first, slowly; "
            "and a failed run would leave partial files in the bucket. Choose a "
            "folder on this workstation's own disk, such as one under your home "
            "folder. The products still go to the bucket."
        )
    existing = nearest_existing(path)
    if not is_dir(existing):
        return f"{existing} is not a folder."
    if not os.access(existing, os.W_OK | os.X_OK):
        verb = "write in" if existing == path else f"create {path} under"
        return f"Cannot {verb} {existing}: no permission."
    return ""


def folder_warning(path: Path, mount: Mount | None) -> str:
    """Something worth knowing about *path* that does not stop a run."""
    if mount is None:
        return ""
    if mount.fstype in MEMORY_FILESYSTEMS:
        return (
            f"{path} is in memory ({mount.fstype}): files there take RAM, which is "
            "what the working folder is for sparing. A folder on disk, such as one "
            "under your home folder, leaves the memory to the tools."
        )
    if mount.fstype.startswith("fuse"):
        return (
            f"{path} is on a FUSE file system ({mount.fstype}); a local disk is faster."
        )
    return ""


# --------------------------------------------------------------------------- #
# How much
# --------------------------------------------------------------------------- #
def space_needed(raw_bytes: int, *, single: bool, sv: bool, freeing: bool) -> int:
    """The most working space a run holds at once, in bytes.

    Kept until the end, everything accumulates: raw, per-file EchoData, the
    combined EchoData (kept locally after its upload, which is where aa-sv
    reads it) and the Sv. Freed as it goes, each kind is deleted once no later
    stage reads it, so the peak is the largest pair that must coexist: raw
    and per-file EchoData while converting, per-file and combined while
    combining, combined and Sv while calibrating.
    """
    raw = float(max(0, raw_bytes))
    per_file = 0.0 if single else ECHODATA_PER_RAW * raw
    combined = ECHODATA_PER_RAW * raw
    sv_bytes = SV_PER_RAW * raw if sv else 0.0
    if freeing:
        peak = max(
            raw + (per_file or combined), per_file + combined, combined + sv_bytes
        )
    else:
        peak = raw + per_file + combined + sv_bytes
    return int(peak * MARGIN)


def memory_total() -> int:
    """This machine's memory, or the container's limit when that is lower."""
    total = 0
    try:
        total = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    except (ValueError, OSError, AttributeError):  # pragma: no cover - not POSIX
        total = 0
    for limit_file in (
        "/sys/fs/cgroup/memory.max",
        "/sys/fs/cgroup/memory/memory.limit_in_bytes",
    ):
        try:
            text = Path(limit_file).read_text().strip()
        except OSError:
            continue
        if text.isdigit() and 0 < int(text) < (total or 1 << 62):
            total = int(text)
    return int(total)


def memory_needed(raw_bytes: int, files: int, streaming: bool | None) -> int:
    """Peak memory of the heaviest stage, or 0 when it cannot be said."""
    if streaming is None:
        return 0
    if streaming:
        return STREAMING_MEMORY_BASE + STREAMING_MEMORY_PER_FILE * max(0, files)
    return WHOLE_RANGE_MEMORY_PER_RAW * max(0, raw_bytes)


# --------------------------------------------------------------------------- #
# Which tools
# --------------------------------------------------------------------------- #
#: The memory fix, recognised by what it added: aa-combine sets its read cache
#: for the whole run, aa-sv writes Sv in passes, aa-graph draws to the pixels.
_PROBE = (
    "import aalibrary.console.aa_combine as c, aalibrary.console.aa_sv as s, "
    "aalibrary.console.aa_graph as g\n"
    "print(int(hasattr(c, '_set_read_cache') and hasattr(s, '_write_streaming') "
    "and hasattr(g, '_for_display')))"
)
_PROBE_SECONDS = 300
_probe_lock = threading.Lock()
_probed: dict[str, tuple[float, bool | None]] = {}


def _interpreter(tool: str) -> str:
    """The Python a console script runs under, from its #! line; '' if unclear.

    pip writes ``#!/path/to/python``, ``#!/usr/bin/env python3``, or, for an
    environment whose path is long or has spaces, a ``#!/bin/sh`` line and
    then an ``exec`` of the environment's python by its full path.
    """
    try:
        with open(tool, "rb") as handle:
            head = handle.read(2048).decode("utf-8", "replace").splitlines()
    except OSError:
        return ""
    if not head or not head[0].startswith("#!"):
        return ""
    command = head[0][2:].strip().split()
    if command and Path(command[0]).name.startswith("python"):
        return command[0]
    if len(command) >= 2 and Path(command[0]).name == "env":
        return shutil.which(command[-1]) or ""
    for line in head[1:4]:
        match = re.search(r"exec' \"([^\"]+)\"", line)
        if match:
            return match.group(1)
    return ""


def tools_stream(tool: str) -> bool | None:
    """Whether the installed console tools stream; None when it cannot be told.

    Asked of the interpreter the tools themselves run under, since that is
    the aalibrary that will run; remembered for a few minutes, so an update
    is noticed without restarting the Workbench. When that interpreter cannot
    be told from the script, the answer is None: a guess would risk refusing a
    run on the strength of some other environment's aalibrary.
    """
    now = time.monotonic()
    with _probe_lock:
        cached = _probed.get(tool)
        if cached and now - cached[0] < _PROBE_SECONDS:
            return cached[1]
    interpreter = _interpreter(tool)
    if not interpreter:
        with _probe_lock:
            _probed[tool] = (now, None)
        return None
    try:
        done = subprocess.run(
            [interpreter, "-c", _PROBE],
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        lines = done.stdout.strip().splitlines()
        answer = lines[-1] if lines else ""
        result: bool | None = (
            {"1": True, "0": False}.get(answer) if done.returncode == 0 else None
        )
    except (OSError, subprocess.SubprocessError):
        result = None
    with _probe_lock:
        _probed[tool] = (now, result)
    return result


def _reset_for_tests() -> None:
    with _probe_lock:
        _probed.clear()


# --------------------------------------------------------------------------- #
# How much a run used
# --------------------------------------------------------------------------- #
def tree_bytes(path: Path) -> int:
    """Bytes in the files under *path* (0 if it is gone). Never raises."""
    total = 0
    stack = [path]
    while stack:
        current = stack.pop()
        try:
            with os.scandir(current) as entries:
                for entry in entries:
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            stack.append(Path(entry.path))
                        elif entry.is_file(follow_symlinks=False):
                            total += entry.stat(follow_symlinks=False).st_size
                    except OSError:
                        continue
        except OSError:
            continue
    return total


def human(n: float) -> str:
    """1536 -> '1.5 KB'; decimal units, as disk sizes are sold and shown."""
    value = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(value) < 1000 or unit == "TB":
            if unit == "B":
                return f"{int(value)} B"
            return f"{value:.1f} {unit}" if value < 100 else f"{value:.0f} {unit}"
        value /= 1000
    return f"{value:.0f} TB"  # pragma: no cover - loop always returns
