"""Local filesystem browsing and editing for the workstation.

The Workbench runs *on* the machine holding the data, so the file panel is a
direct view of that filesystem rather than a catalogue. This module answers
four questions: "where should I start looking" (roots), "what is in this
directory" (list), "what does this file say" (read/raw), and "put this on disk"
(write/create).

Scope and safety
----------------
Listing and reading are unconditional. Writing is deliberate, not an accident
of symmetry: the panel gained an editor because a scientist editing a
three-line parameter file should not have to leave for a terminal, and the
notebook they are about to run has to be created somewhere. What is still
absent is equally deliberate — there is **no delete, move, or rename**.
Destructive operations one misclick away from a file listing are a poor trade,
and the terminal is right there for them.

``AASI_FS_READONLY=true`` removes the write half entirely (405 on every
mutating route) for deployments that want browsing without editing.

Access is bounded by ``AASI_FS_ROOT`` (default ``$HOME``). Every requested path
is resolved and then checked against that boundary, so ``..`` traversal and
symlinks pointing outside cannot escape it — on the way in *and* on the way
out. Set ``AASI_FS_ROOT=/`` to browse the whole machine — reasonable on a
single-user workstation, and the same trust model the terminal already assumes.

Like the environment updater, this refuses to serve when the API is bound to a
non-loopback address unless explicitly overridden, because a directory listing
of someone's home directory is not something to publish by accident.
"""

from __future__ import annotations

import json
import os
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
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
    ".tsv": "table",
    ".evr": "region",
    ".evl": "region",
    ".json": "text",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".gif": "image",
    ".webp": "image",
    ".svg": "image",
    # Authored source — the three the New menu can create, plus the config
    # formats that sit next to a pipeline run.
    ".py": "python",
    ".ipynb": "notebook",
    ".md": "markdown",
    ".txt": "text",
    ".log": "text",
    ".yml": "text",
    ".yaml": "text",
    ".toml": "text",
    ".ini": "text",
    ".cfg": "text",
    ".sh": "text",
}

#: Kinds whose bytes are text and can be opened in the editor.
TEXT_KINDS = frozenset({"python", "notebook", "markdown", "text", "table", "region"})

#: Refuse to load a "text" file larger than this into a browser tab. Well under
#: what the editor could technically hold — the point is that a 40 MB CSV opened
#: by a mis-click should fail fast with a reason rather than freeze the tab.
MAX_TEXT_BYTES = 2 * 1024 * 1024

#: Ceiling on an inline binary preview (images). Larger files get a reason.
MAX_RAW_BYTES = 32 * 1024 * 1024

#: What each "New" kind puts on disk. A notebook has to be a valid nbformat
#: document or Jupyter refuses to open it, so it is built rather than blank.
NEW_FILE_SUFFIX: dict[str, str] = {
    "text": ".txt",
    "python": ".py",
    "notebook": ".ipynb",
    "markdown": ".md",
    "folder": "",
}


def new_notebook_source() -> str:
    """A minimal, valid nbformat 4.5 notebook with one empty code cell.

    nbformat >= 4.5 requires a per-cell ``id``; omitting it makes Jupyter
    rewrite the file on first open, which shows up as a spurious diff.
    """
    document = {
        "cells": [
            {
                "cell_type": "code",
                "execution_count": None,
                "id": uuid.uuid4().hex[:8],
                "metadata": {},
                "outputs": [],
                "source": [],
            }
        ],
        "metadata": {
            "kernelspec": {
                "display_name": "Python 3",
                "language": "python",
                "name": "python3",
            },
            "language_info": {"name": "python"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    return json.dumps(document, indent=1) + "\n"


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


def _guard_write() -> None:
    """Everything ``_guard`` checks, plus the read-only opt-out."""
    _guard()
    if os.getenv("AASI_FS_READONLY", "").lower() in {"1", "true", "yes"}:
        raise HTTPException(
            status_code=405,
            detail="This Workbench is configured read-only (AASI_FS_READONLY).",
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


def _kind_for(path: Path, *, is_dir: bool) -> str:
    """The coarse kind for a path, honouring the .zarr-is-one-asset rule."""
    suffix = path.suffix.lower()
    if is_dir:
        return "zarr" if suffix == ".zarr" else "folder"
    return ASSET_KINDS.get(suffix, "file")


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


class FsDocument(BaseModel):
    """One file's contents, or an honest explanation of why they're absent."""

    path: str
    name: str
    kind: str
    sizeBytes: int = 0
    modifiedAt: str = ""
    text: str = ""
    #: True when the bytes aren't decodable text — the panel renders a preview
    #: or a "nothing to show" state rather than mojibake.
    binary: bool = False
    #: True when only the first MAX_TEXT_BYTES were returned. Saving is blocked
    #: client-side in that case, because writing back would truncate the file.
    truncated: bool = False
    #: Set when the file exists but can't be shown, phrased as something to act on.
    detail: str = ""
    readOnly: bool = False


class FsWriteRequest(BaseModel):
    path: str
    text: str


class FsCreateRequest(BaseModel):
    """Create one new file or folder inside ``parent``."""

    parent: str
    name: str
    kind: str = "text"


def _describe_path(path: Path) -> FsEntry:
    """FsEntry for a path we already hold (post-write), rather than a DirEntry."""
    try:
        stat = path.stat()
        size, mtime = stat.st_size, stat.st_mtime
    except OSError:
        size, mtime = 0, 0.0
    is_dir = path.is_dir()
    kind = _kind_for(path, is_dir=is_dir)
    return FsEntry(
        name=path.name,
        path=str(path),
        isDir=is_dir and kind != "zarr",
        kind=kind,
        sizeBytes=size,
        modifiedAt=_iso(mtime) if mtime else "",
        childCount=-1,
    )


def _describe(entry: os.DirEntry[str]) -> FsEntry:
    path = Path(entry.path)
    try:
        stat = entry.stat(follow_symlinks=False)
        size, mtime = stat.st_size, stat.st_mtime
    except OSError:
        size, mtime = 0, 0.0

    is_dir = entry.is_dir(follow_symlinks=False)
    # A .zarr store is a directory, but the workflow treats it as one asset.
    kind = _kind_for(path, is_dir=is_dir)

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


@router.get("/read", response_model=FsDocument)
def read_file(path: str = Query(...)) -> FsDocument:
    """Return one file as text.

    Like ``/api/derived``, this prefers a 200 carrying a reason over an error
    status: the editor has to render *something*, and "this is a 1.4 GB raw
    file" is more useful than a red toast. Genuine addressing mistakes (missing
    file, a directory, outside the root) still raise, because those are bugs in
    the caller rather than states the user can be in.
    """
    _guard()
    target = _resolve(path)

    if not target.exists():
        raise HTTPException(status_code=404, detail=f"No such file: {target}")
    if target.is_dir():
        raise HTTPException(status_code=400, detail=f"That is a directory: {target}")

    stat = target.stat()
    kind = _kind_for(target, is_dir=False)
    read_only = os.getenv("AASI_FS_READONLY", "").lower() in {"1", "true", "yes"}
    base = FsDocument(
        path=str(target),
        name=target.name,
        kind=kind,
        sizeBytes=stat.st_size,
        modifiedAt=_iso(stat.st_mtime),
        readOnly=read_only or not os.access(target, os.W_OK),
    )

    if kind in {"image", "raw", "netcdf", "zarr"}:
        base.binary = True
        base.detail = f"{kind} files aren't text — nothing to edit here."
        return base

    if stat.st_size > MAX_TEXT_BYTES:
        base.binary = False
        base.truncated = True
        base.detail = (
            f"Showing the first {MAX_TEXT_BYTES // (1024 * 1024)} MB of "
            f"{stat.st_size // (1024 * 1024)} MB. Saving is disabled so the rest "
            f"of the file can't be lost."
        )

    try:
        with target.open("rb") as handle:
            payload = handle.read(MAX_TEXT_BYTES)
    except PermissionError as exc:
        raise HTTPException(
            status_code=403, detail=f"Permission denied: {target}"
        ) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not read: {exc}") from exc

    # A NUL byte in the first block is the same heuristic `grep` and `git` use,
    # and it costs nothing next to the decode attempt that follows.
    if b"\x00" in payload:
        base.binary = True
        base.detail = "This looks like a binary file, so there's nothing to show."
        return base

    try:
        base.text = payload.decode("utf-8")
    except UnicodeDecodeError:
        base.binary = True
        base.detail = "This file isn't valid UTF-8, so it can't be shown as text."
    return base


@router.get("/raw")
def read_raw(path: str = Query(...)) -> FileResponse:
    """Stream a file's bytes — how the editor shows an image inline."""
    _guard()
    target = _resolve(path)

    if not target.exists():
        raise HTTPException(status_code=404, detail=f"No such file: {target}")
    if target.is_dir():
        raise HTTPException(status_code=400, detail=f"That is a directory: {target}")
    if target.stat().st_size > MAX_RAW_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Too large to preview "
                f"({target.stat().st_size // (1024 * 1024)} MB); the limit is "
                f"{MAX_RAW_BYTES // (1024 * 1024)} MB."
            ),
        )
    return FileResponse(target, filename=target.name)


@router.post("/write", response_model=FsEntry)
def write_file(request: FsWriteRequest) -> FsEntry:
    """Overwrite an existing file with new text.

    Writes via a temporary file in the same directory and an atomic
    ``os.replace``, so a failure part-way through leaves the original intact
    rather than a half-written file. Refuses to create — ``/create`` is the
    route that brings a path into existence, and keeping them separate means a
    typo'd path in a save can't quietly scatter files.
    """
    _guard_write()
    target = _resolve(request.path)

    if not target.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No such file: {target}. Create it first.",
        )
    if target.is_dir():
        raise HTTPException(status_code=400, detail=f"That is a directory: {target}")

    payload = request.text.encode("utf-8")
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=target.parent,
            prefix=f".{target.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
            staged = Path(handle.name)
    except PermissionError as exc:
        raise HTTPException(
            status_code=403, detail=f"Permission denied: {target}"
        ) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not save: {exc}") from exc

    try:
        # Carry the original mode across; NamedTemporaryFile creates 0600.
        os.chmod(staged, target.stat().st_mode & 0o7777)
        os.replace(staged, target)
    except OSError as exc:
        staged.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Could not save: {exc}") from exc

    return _describe_path(target)


@router.post("/create", response_model=FsEntry)
def create_entry(request: FsCreateRequest) -> FsEntry:
    """Create one new file or folder, refusing to overwrite anything."""
    _guard_write()
    if request.kind not in NEW_FILE_SUFFIX:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unknown kind '{request.kind}'. "
                f"Expected one of: {', '.join(sorted(NEW_FILE_SUFFIX))}."
            ),
        )

    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="A name is required.")
    # The name is a leaf, not a path: reject anything that would relocate the
    # file, rather than silently resolving it somewhere else.
    if name in {".", ".."} or "/" in name or "\\" in name or "\x00" in name:
        raise HTTPException(
            status_code=400,
            detail="Names can't contain slashes — pick the folder separately.",
        )

    suffix = NEW_FILE_SUFFIX[request.kind]
    if suffix and not name.lower().endswith(suffix):
        name = f"{name}{suffix}"

    parent = _resolve(request.parent)
    if not parent.is_dir():
        raise HTTPException(status_code=400, detail=f"Not a folder: {parent}")

    # Resolve again through the parent so a symlinked folder can't land the new
    # file outside the root.
    target = _resolve(str(parent / name))
    if target.exists():
        raise HTTPException(status_code=409, detail=f"{name} already exists here.")

    try:
        if request.kind == "folder":
            target.mkdir()
        else:
            source = new_notebook_source() if request.kind == "notebook" else ""
            # "x" fails if the path appeared between the check above and now.
            with target.open("x", encoding="utf-8") as handle:
                handle.write(source)
    except FileExistsError as exc:
        raise HTTPException(
            status_code=409, detail=f"{name} already exists here."
        ) from exc
    except PermissionError as exc:
        raise HTTPException(
            status_code=403, detail=f"Permission denied: {parent}"
        ) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not create: {exc}") from exc

    return _describe_path(target)
