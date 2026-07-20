"""Local filesystem browsing for the workstation.

The Workbench runs *on* the machine holding the data, so the file panel is a
direct view of that filesystem rather than a catalogue. This module answers two
questions: "where should I start looking" (roots) and "what is in this
directory" (list).

Scope and safety
----------------
Listing is read-only — there is no create, move, or delete here, and adding one
should be a deliberate decision rather than an accident of symmetry.

Access is bounded by ``AASI_FS_ROOT`` (default ``$HOME``). Every requested path
is resolved and then checked against that boundary, so ``..`` traversal and
symlinks pointing outside cannot escape it. Set ``AASI_FS_ROOT=/`` to browse the
whole machine — reasonable on a single-user workstation, and the same trust
model the terminal already assumes.

Like the environment updater, this refuses to serve when the API is bound to a
non-loopback address unless explicitly overridden, because a directory listing
of someone's home directory is not something to publish by accident.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/fs")

# Extensions the acoustics workflow cares about, mapped to a coarse kind the UI
# can badge and filter on. Everything else is reported as a plain file.
ASSET_KINDS: dict[str, str] = {
    ".raw": "raw",
    ".nc": "netcdf",
    ".netcdf": "netcdf",
    ".zarr": "zarr",
    ".csv": "table",
    ".evr": "region",
    ".json": "text",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
}


def _fs_root() -> Path:
    """The boundary every request is confined to."""
    return Path(os.getenv("AASI_FS_ROOT", str(Path.home()))).expanduser().resolve()


def _is_loopback(host: str) -> bool:
    return host in {"127.0.0.1", "::1", "localhost", ""}


def _guard() -> None:
    host = os.getenv("AASI_BIND_HOST", "127.0.0.1")
    allow = os.getenv("AASI_ALLOW_REMOTE_FS", "").lower() in {"1", "true", "yes"}
    if not _is_loopback(host) and not allow:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Filesystem browsing is disabled because the server is bound to "
                f"{host}. Set AASI_ALLOW_REMOTE_FS=true only on a trusted host."
            ),
        )


def _resolve(raw: str) -> Path:
    """Resolve a requested path and confine it to the configured root."""
    root = _fs_root()
    candidate = Path(raw).expanduser() if raw else root
    if not candidate.is_absolute():
        candidate = root / candidate
    try:
        resolved = candidate.resolve()
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"Bad path: {exc}") from exc

    if resolved != root and root not in resolved.parents:
        raise HTTPException(
            status_code=403,
            detail=f"Outside the browsable root ({root}).",
        )
    return resolved


def _iso(ts: float) -> str:
    return (
        datetime.fromtimestamp(ts, UTC).isoformat(timespec="seconds").replace(
            "+00:00", "Z"
        )
    )


class FsEntry(BaseModel):
    name: str
    path: str
    isDir: bool = Field(default=False)
    kind: str = ""
    sizeBytes: int = 0
    modifiedAt: str = ""
    childCount: int = -1  # -1 = not counted (unreadable or not a directory)


class FsListing(BaseModel):
    path: str
    parent: str
    root: str
    entries: list[FsEntry]
    truncated: bool = False


class FsRoot(BaseModel):
    label: str
    path: str
    description: str = ""


def _describe(entry: os.DirEntry[str]) -> FsEntry:
    path = Path(entry.path)
    try:
        stat = entry.stat(follow_symlinks=False)
        size, mtime = stat.st_size, stat.st_mtime
    except OSError:
        size, mtime = 0, 0.0

    is_dir = entry.is_dir(follow_symlinks=False)
    # A .zarr store is a directory, but the workflow treats it as one asset.
    suffix = path.suffix.lower()
    kind = "folder" if is_dir else ASSET_KINDS.get(suffix, "file")
    if is_dir and suffix == ".zarr":
        kind = "zarr"

    child_count = -1
    if is_dir and kind != "zarr":
        try:
            with os.scandir(entry.path) as it:
                child_count = sum(1 for _ in it)
        except OSError:
            child_count = -1

    return FsEntry(
        name=entry.name,
        path=str(path),
        isDir=is_dir and kind != "zarr",
        kind=kind,
        sizeBytes=size,
        modifiedAt=_iso(mtime) if mtime else "",
        childCount=child_count,
    )


@router.get("/roots", response_model=list[FsRoot])
def roots() -> list[FsRoot]:
    """Sensible starting points, skipping any that don't exist on this machine."""
    _guard()
    root = _fs_root()
    home = Path.home()

    candidates: list[tuple[str, Path, str]] = [
        ("Home", home, "Your home directory"),
        ("Working directory", Path.cwd(), "Where aa-workbench was started"),
    ]
    # Directories the AA-SI setup script creates, when present.
    for label, path, desc in [
        ("Downloads", home / "Downloads", "Default aa-fetch destination"),
        ("aa-docs", home / "aa-docs", "Knowledge directory used by aa-help"),
    ]:
        candidates.append((label, path, desc))

    # Anything aa-raw dropped in $HOME as <Ship>_<Survey>_<Sonar>_NCEI.
    try:
        for child in sorted(home.iterdir()):
            if child.is_dir() and child.name.endswith("_NCEI"):
                candidates.append((child.name, child, "Downloaded survey data"))
    except OSError:
        pass

    seen: set[str] = set()
    out: list[FsRoot] = []
    for label, path, desc in candidates:
        try:
            resolved = path.resolve()
        except OSError:
            continue
        key = str(resolved)
        if key in seen or not resolved.is_dir():
            continue
        if resolved != root and root not in resolved.parents:
            continue  # outside the browsable boundary
        seen.add(key)
        out.append(FsRoot(label=label, path=key, description=desc))
    return out


@router.get("/list", response_model=FsListing)
def list_directory(
    path: str = Query(default=""),
    showHidden: bool = Query(default=False),
    limit: int = Query(default=2000, ge=1, le=20000),
) -> FsListing:
    """List one directory. Directories first, then files, each alphabetical."""
    _guard()
    target = _resolve(path)

    if not target.exists():
        raise HTTPException(status_code=404, detail=f"No such directory: {target}")
    if not target.is_dir():
        raise HTTPException(status_code=400, detail=f"Not a directory: {target}")

    entries: list[FsEntry] = []
    truncated = False
    try:
        with os.scandir(target) as it:
            for entry in it:
                if not showHidden and entry.name.startswith("."):
                    continue
                if len(entries) >= limit:
                    truncated = True
                    break
                entries.append(_describe(entry))
    except PermissionError as exc:
        raise HTTPException(
            status_code=403, detail=f"Permission denied: {target}"
        ) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not read: {exc}") from exc

    entries.sort(key=lambda e: (not e.isDir, e.name.lower()))

    root = _fs_root()
    parent = "" if target == root else str(target.parent)
    return FsListing(
        path=str(target),
        parent=parent,
        root=str(root),
        entries=entries,
        truncated=truncated,
    )
