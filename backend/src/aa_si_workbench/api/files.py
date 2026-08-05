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
notebook they are about to run has to be created somewhere.

Organising — rename, move, trash — was absent for a long time on the grounds
that a destructive action one misclick from a listing is a poor trade. That
reasoning was right about *deletion* and wrong about the conclusion, because
the alternative on offer was ``rm`` at a terminal, which is worse in exactly
the way the argument was worried about. So the operations exist now, and the
trade is answered directly instead:

* **There is still no delete.** ``/trash`` *moves*; nothing here unlinks a file
  the user can see. The one ``unlink`` in this module removes a ``.trashinfo``
  sidecar this module wrote seconds earlier.
* **Trashing is reversible from inside the Workbench.** ``/trash`` returns the
  token ``/restore`` needs, so "Moved to Trash · Undo" is one request and does
  not depend on the user finding a desktop file manager.
* **The destination follows the XDG Trash spec**, so a desktop Files app sees
  the same trash and can restore from it independently of this API.
* **Rename is a leaf operation.** A name containing a separator is rejected
  rather than resolved, so renaming cannot relocate a file.
* Every one of them refuses to overwrite an existing path.

``AASI_FS_READONLY=true`` removes the write half entirely (405 on every
mutating route, organising included) for deployments that want browsing without
editing.

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
import shutil
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote, unquote

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

try:  # POSIX only; the owner column degrades to empty elsewhere.
    import pwd
except ImportError:  # pragma: no cover - Windows
    pwd = None  # type: ignore[assignment]

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

#: Notebooks get their own, larger ceiling, and are never truncated.
#:
#: Two facts pull in the same direction here. A notebook's size is mostly its
#: *outputs* — a base64 PNG inflates by a third, and a handful of echograms
#: clears 2 MB without the source being long at all — and those outputs are
#: precisely the content someone opens the file to look at. Truncating to the
#: text ceiling therefore discards the interesting part of exactly the files
#: where it matters most.
#:
#: The second fact is sharper: a truncated notebook is not a degraded notebook,
#: it is a syntax error. JSON cut mid-structure will not parse, so the editor
#: gets nothing at all — whereas a truncated .py or .csv is still perfectly
#: readable. That asymmetry is why `read_document` refuses an oversized
#: notebook outright instead of returning a prefix of one: a clear refusal is
#: strictly more useful than a payload that cannot be opened.
#:
#: 32 MB matches MAX_RAW_BYTES. Above that the browser is the constraint, not
#: this limit — the JSON is parsed and held in memory, then re-serialized on
#: save.
MAX_NOTEBOOK_BYTES = 32 * 1024 * 1024

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


def _leaf_name(raw: str) -> str:
    """Validate a user-supplied *name* — one path component, never a path.

    Shared by ``/create`` and ``/rename`` because they need exactly the same
    rule and it is the rule that stops a rename from becoming a move: a name
    containing a separator is rejected rather than resolved, so a typed
    ``../../ssh/authorized_keys`` cannot relocate anything. ``_resolve`` would
    catch the escape afterwards, but only for paths that leave the root — this
    catches the ones that stay inside it too.
    """
    name = raw.strip()
    if not name:
        raise HTTPException(status_code=400, detail="A name is required.")
    if name in {".", ".."} or "/" in name or "\\" in name or "\x00" in name:
        raise HTTPException(
            status_code=400,
            detail="Names can't contain slashes — pick the folder separately.",
        )
    return name


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


#: uid -> account name. A directory listing calls this once per row and the
#: answer cannot change while the process runs, so the NSS lookup — which may
#: touch LDAP on a managed workstation — happens once per distinct uid.
_owner_cache: dict[int, str] = {}


def _owner_for(uid: int) -> str:
    """The account name owning a file, or "" when it can't be resolved.

    **This is the owner, not the last writer.** POSIX does not record who
    modified a file — only ``st_uid``, which is whoever owns it now. On a
    single-user workstation the two coincide; on a shared one they do not, and
    a column headed "modified by" built on this would be confidently wrong. The
    field is therefore named for what it actually holds, and the UI labels it
    "owner" for the same reason.
    """
    if pwd is None:
        return ""
    cached = _owner_cache.get(uid)
    if cached is not None:
        return cached
    try:
        name = pwd.getpwuid(uid).pw_name
    except (KeyError, OSError):
        # A uid with no passwd entry — an NFS mount or a deleted account.
        name = str(uid)
    _owner_cache[uid] = name
    return name


def _trash_dir() -> Path:
    """The XDG trash directory for this user, honouring ``XDG_DATA_HOME``.

    Deliberately *not* confined to ``AASI_FS_ROOT``: the trash is where files
    go to stop being in the browsable tree, and a trash inside that tree would
    still be listed. It is also the same directory the desktop uses, which is
    what lets a file trashed here be restored from a Files app and vice versa.
    """
    base = os.getenv("XDG_DATA_HOME", "").strip()
    root = Path(base).expanduser() if base else Path.home() / ".local" / "share"
    return root / "Trash"


def _unique_trash_name(info_dir: Path, name: str) -> tuple[Path, str]:
    """Claim a free name in the trash, atomically.

    The spec requires the entry in ``files/`` and its sidecar in ``info/`` to
    share a name, so the sidecar is created with ``O_EXCL`` and *that* is what
    reserves the name. Checking whether a name is free and then using it is the
    race two Workbench windows would lose.
    """
    stem, dot, suffix = name.partition(".")
    for attempt in range(1, 1000):
        candidate = name if attempt == 1 else f"{stem}.{attempt}{dot}{suffix}"
        info_path = info_dir / f"{candidate}.trashinfo"
        try:
            handle = os.open(info_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            continue
        os.close(handle)
        return info_path, candidate
    raise HTTPException(
        status_code=500,
        detail="The trash already holds a thousand files by that name.",
    )


class FsEntry(BaseModel):
    name: str
    path: str
    isDir: bool = Field(default=False)
    kind: str = ""
    sizeBytes: int = 0
    modifiedAt: str = ""
    #: Account name owning the file. **Not** who last wrote it — see
    #: ``_owner_for``. Empty when the platform has no passwd database.
    owner: str = ""
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


class FsRenameRequest(BaseModel):
    """Give an existing entry a new leaf name, in the same folder."""

    path: str
    name: str


class FsMoveRequest(BaseModel):
    """Move an entry into ``destination``, keeping its name."""

    path: str
    destination: str


class FsTrashRequest(BaseModel):
    path: str


class FsRestoreRequest(BaseModel):
    """Undo one trash operation, by the token ``/trash`` handed back."""

    token: str


class FsTrashResult(BaseModel):
    """What was trashed, and everything ``/restore`` needs to undo it."""

    #: Where the entry used to be — what the UI says in "Moved X to Trash".
    path: str
    name: str
    #: Where it is now. Shown so the message is checkable rather than trusted.
    trashedTo: str
    #: Opaque handle for ``/restore``. The trash entry's name, which is not
    #: necessarily the file's — a collision appends a counter.
    token: str


def _describe_path(path: Path) -> FsEntry:
    """FsEntry for a path we already hold (post-write), rather than a DirEntry."""
    try:
        stat = path.stat()
        size, mtime, uid = stat.st_size, stat.st_mtime, stat.st_uid
    except OSError:
        size, mtime, uid = 0, 0.0, -1
    is_dir = path.is_dir()
    kind = _kind_for(path, is_dir=is_dir)
    return FsEntry(
        name=path.name,
        path=str(path),
        isDir=is_dir and kind != "zarr",
        kind=kind,
        sizeBytes=size,
        modifiedAt=_iso(mtime) if mtime else "",
        owner=_owner_for(uid) if uid >= 0 else "",
        childCount=-1,
    )


def _describe(entry: os.DirEntry[str]) -> FsEntry:
    path = Path(entry.path)
    try:
        stat = entry.stat(follow_symlinks=False)
        size, mtime, uid = stat.st_size, stat.st_mtime, stat.st_uid
    except OSError:
        size, mtime, uid = 0, 0.0, -1

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
        owner=_owner_for(uid) if uid >= 0 else "",
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

    # Notebooks are structured, so the ceiling and the over-limit behaviour
    # both differ from plain text. See MAX_NOTEBOOK_BYTES.
    is_notebook = kind == "notebook"
    limit = MAX_NOTEBOOK_BYTES if is_notebook else MAX_TEXT_BYTES

    if stat.st_size > limit:
        if is_notebook:
            # Refuse outright. A prefix of a JSON document is a syntax error,
            # not a partial view, so returning one would leave the editor with
            # nothing it can render and no way to say why.
            base.binary = True
            base.detail = (
                f"This notebook is {stat.st_size // (1024 * 1024)} MB, over the "
                f"{limit // (1024 * 1024)} MB limit. It isn't shown in part "
                "because a partly-read notebook can't be parsed at all. Most of "
                "the size is usually stored output — clearing it in Jupyter "
                "(Cell ▸ All Output ▸ Clear) will bring it back under."
            )
            return base
        base.binary = False
        base.truncated = True
        base.detail = (
            f"Showing the first {limit // (1024 * 1024)} MB of "
            f"{stat.st_size // (1024 * 1024)} MB. Saving is disabled so the rest "
            f"of the file can't be lost."
        )

    try:
        with target.open("rb") as handle:
            payload = handle.read(limit)
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

    name = _leaf_name(request.name)

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


@router.get("/stat", response_model=FsEntry)
def stat_entry(path: str = Query(...)) -> FsEntry:
    """Describe one path without listing or reading it.

    The terminal's link provider is the caller that needs this. It sees a path
    printed by a tool and has to choose between opening an editor and revealing
    a folder, and the only alternatives were to guess from the suffix — wrong
    for every extensionless directory these tools produce — or to call
    ``/list`` and treat an error as "it's a file", which enumerates a survey
    directory to answer a yes/no question.
    """
    _guard()
    target = _resolve(path)
    if not target.exists():
        raise HTTPException(status_code=404, detail=f"No such path: {target}")
    return _describe_path(target)


@router.post("/rename", response_model=FsEntry)
def rename_entry(request: FsRenameRequest) -> FsEntry:
    """Rename one entry in place. Refuses to overwrite, refuses to relocate."""
    _guard_write()
    target = _resolve(request.path)
    if not target.exists():
        raise HTTPException(status_code=404, detail=f"No such path: {target}")
    if target == _fs_root():
        raise HTTPException(
            status_code=400, detail="The browsable root can't be renamed."
        )

    name = _leaf_name(request.name)
    if name == target.name:
        return _describe_path(target)  # nothing to do; not an error

    # Resolve through the parent so a symlinked folder can't land the result
    # outside the root — the same reason /create resolves a second time.
    destination = _resolve(str(target.parent / name))
    if destination.exists():
        raise HTTPException(status_code=409, detail=f"{name} already exists here.")

    try:
        os.rename(target, destination)
    except PermissionError as exc:
        raise HTTPException(
            status_code=403, detail=f"Permission denied: {target}"
        ) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not rename: {exc}") from exc

    return _describe_path(destination)


@router.post("/move", response_model=FsEntry)
def move_entry(request: FsMoveRequest) -> FsEntry:
    """Move an entry into another folder, keeping its name."""
    _guard_write()
    source = _resolve(request.path)
    destination_dir = _resolve(request.destination)

    if not source.exists():
        raise HTTPException(status_code=404, detail=f"No such path: {source}")
    if source == _fs_root():
        raise HTTPException(
            status_code=400, detail="The browsable root can't be moved."
        )
    if not destination_dir.is_dir():
        raise HTTPException(status_code=400, detail=f"Not a folder: {destination_dir}")

    # Moving a directory into itself or into its own subtree detaches it from
    # the filesystem: `os.rename` returns EINVAL on some platforms and silently
    # produces an unreachable directory on others.
    if source == destination_dir or source in destination_dir.parents:
        raise HTTPException(
            status_code=400, detail="A folder can't be moved inside itself."
        )

    target = _resolve(str(destination_dir / source.name))
    if target == source:
        return _describe_path(source)  # already there
    if target.exists():
        raise HTTPException(
            status_code=409, detail=f"{source.name} already exists in that folder."
        )

    try:
        # shutil.move rather than os.rename: the destination may be on another
        # filesystem, which os.rename reports as EXDEV rather than handling.
        shutil.move(str(source), str(target))
    except PermissionError as exc:
        raise HTTPException(
            status_code=403, detail=f"Permission denied: {source}"
        ) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not move: {exc}") from exc

    return _describe_path(target)


@router.post("/trash", response_model=FsTrashResult)
def trash_entry(request: FsTrashRequest) -> FsTrashResult:
    """Move an entry to the desktop trash, following the XDG Trash spec.

    Nothing is unlinked. The entry moves to ``$XDG_DATA_HOME/Trash/files`` and
    a ``.trashinfo`` sidecar records where it came from, which is what lets
    both ``/restore`` and any desktop file manager put it back.

    The sidecar is written *first*, with ``O_EXCL``, because it is what claims
    the name. Writing the file first and the sidecar second leaves an orphan in
    ``files/`` if the second step fails — an entry the trash can display but
    cannot restore.
    """
    _guard_write()
    target = _resolve(request.path)
    if not target.exists():
        raise HTTPException(status_code=404, detail=f"No such path: {target}")
    if target == _fs_root():
        raise HTTPException(
            status_code=400, detail="The browsable root can't be trashed."
        )

    trash = _trash_dir()
    files_dir, info_dir = trash / "files", trash / "info"
    try:
        files_dir.mkdir(parents=True, exist_ok=True)
        info_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise HTTPException(
            status_code=500, detail=f"Could not open the trash ({trash}): {exc}"
        ) from exc

    info_path, entry_name = _unique_trash_name(info_dir, target.name)
    destination = files_dir / entry_name

    try:
        info_path.write_text(
            "[Trash Info]\n"
            # The spec wants the original path URL-encoded, so a name with a
            # space or a '#' survives the round trip through /restore.
            f"Path={quote(str(target))}\n"
            f"DeletionDate={datetime.now().strftime('%Y-%m-%dT%H:%M:%S')}\n",
            encoding="utf-8",
        )
        shutil.move(str(target), str(destination))
    except (OSError, PermissionError) as exc:
        # Roll the claim back so a failed trash doesn't leave a sidecar naming
        # a file that is still in place — which /restore would then refuse.
        info_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Could not trash: {exc}") from exc

    return FsTrashResult(
        path=str(target),
        name=target.name,
        trashedTo=str(destination),
        token=entry_name,
    )


@router.post("/restore", response_model=FsEntry)
def restore_entry(request: FsRestoreRequest) -> FsEntry:
    """Undo one ``/trash``, using the token it returned.

    This is what makes trashing a reversible action inside the Workbench rather
    than a reversible action somewhere else that the user has to go and find.
    """
    _guard_write()
    token = _leaf_name(request.token)

    trash = _trash_dir()
    info_path = trash / "info" / f"{token}.trashinfo"
    source = trash / "files" / token

    if not info_path.exists() or not source.exists():
        raise HTTPException(
            status_code=404,
            detail="That item is no longer in the trash — it may have been emptied.",
        )

    original = ""
    for line in info_path.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.startswith("Path="):
            original = unquote(line[len("Path=") :].strip())
            break
    if not original:
        raise HTTPException(
            status_code=422,
            detail="The trash record has no original location, so it can't be undone.",
        )

    # Back through the boundary check: the sidecar is a file on disk and could
    # name anywhere at all, so a restore is treated as untrusted input exactly
    # like a path arriving in a query string.
    destination = _resolve(original)
    if destination.exists():
        raise HTTPException(
            status_code=409,
            detail=f"{destination.name} exists again at that location.",
        )
    if not destination.parent.is_dir():
        raise HTTPException(
            status_code=409,
            detail=f"The folder it came from is gone ({destination.parent}).",
        )

    try:
        shutil.move(str(source), str(destination))
    except OSError as exc:
        raise HTTPException(
            status_code=500, detail=f"Could not restore: {exc}"
        ) from exc
    info_path.unlink(missing_ok=True)

    return _describe_path(destination)
