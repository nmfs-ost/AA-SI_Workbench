"""Where raw files come from: the data sources Prepare EchoData lists and fetches.

NCEI is one source among several. Every source answers the same four
questions (which vessels, which surveys of a vessel, which echosounders of a
survey, which raw files of an echosounder) and says how its files are fetched.
The Prepare card only ever talks to a source through those.

Built in
--------
``ncei``   NOAA NCEI's public water-column archive (ncei.py: the S3 bucket, or
           the project's BigQuery cache). Fetched by aa-fetch, as before.
``omao``   NOAA OMAO's archive. Listed like any archive below, and "not
           connected" until its location is set.

Archives
--------
An archive is a folder tree of .raw files::

    <root>/<vessel>/<survey>/<echosounder>/*.raw

``root`` is ``gs://bucket/prefix`` (listed with the credentials the console
tools use, fetched with aa-download) or a folder on this machine, such as a
mounted share (fetched with cp). ``layout`` changes the tree below the root:
segments that are names or one of ``{vessel}``, ``{survey}``, ``{sonar}``, in
that order, e.g. ``data/raw/{vessel}/{survey}/{sonar}``. A tree without
echosounder folders names its echosounder in ``sonar``.

Configuring
-----------
Sources live in ``<config dir>/sources.json`` (what the Sources dialog in
Prepare EchoData writes), on top of a deployment's own file named by
``AASI_SOURCES_FILE``. Same format; an entry with a built-in's id sets that
source's location::

    {"sources": [
      {"id": "omao", "root": "gs://omao-raw/fleet"},
      {"id": "shimada", "name": "Shimada share", "kind": "archive",
       "root": "/mnt/shimada/raw", "layout": "{vessel}/{survey}/{sonar}"}
    ]}

A new kind of source (an API, a database) is one provider class registered in
``KINDS``: its four listings, and ``locations`` (where each raw file is, as a
gs:// URI or a path) or the NCEI fetch. Nothing else changes.
"""

from __future__ import annotations

import json
import os
import re
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from . import ncei
from .gcp import config_dir
from .schemas import RawFile, SonarModel, Survey, Vessel

router = APIRouter(prefix="/api/sources", tags=["sources"])

DEFAULT_LAYOUT = "{vessel}/{survey}/{sonar}"
_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,31}")
_SEGMENT = re.compile(r"[A-Za-z0-9_.+-]+")
_BUCKET = re.compile(r"[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]")
_FIELDS = ("{vessel}", "{survey}", "{sonar}")


class DataSource(BaseModel):
    """A source as the card shows it."""

    id: str
    name: str
    #: ncei | archive (or a kind registered in KINDS)
    kind: str
    description: str = ""
    #: An archive's location: gs://bucket/prefix or a folder on this machine.
    root: str = ""
    layout: str = DEFAULT_LAYOUT
    #: The echosounder of an archive whose layout has no {sonar}.
    sonar: str = ""
    builtin: bool = False
    #: Configured and usable; detail says why not.
    ready: bool = False
    detail: str = ""
    #: How Prepare EchoData fetches its files: aa-fetch | aa-download | cp
    fetch: str = ""
    #: Where one echosounder's files are, with {vessel} {survey} {sonar}.
    where: str = ""


class SourceConfig(BaseModel):
    """A source as it is stored (and as the Sources dialog sends it)."""

    id: str
    name: str = ""
    kind: str = "archive"
    description: str = ""
    root: str = ""
    layout: str = ""
    sonar: str = ""


BUILTINS: tuple[DataSource, ...] = (
    DataSource(
        id="ncei",
        name="NCEI",
        kind="ncei",
        description="NOAA NCEI's public water-column archive (noaa-wcsd-pds).",
        builtin=True,
    ),
    DataSource(
        id="omao",
        name="OMAO",
        kind="archive",
        description="NOAA Office of Marine and Aviation Operations: the fleet's "
        "own archive of raw files.",
        builtin=True,
    ),
)


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
_lock = threading.RLock()


def _user_file() -> Path:
    return config_dir() / "sources.json"


def _read(path: Path) -> list[dict[str, Any]]:
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return []
    items = data.get("sources", []) if isinstance(data, dict) else []
    return [item for item in items if isinstance(item, dict)]


def _stored() -> list[dict[str, Any]]:
    """Entries from the deployment's file, then the user's (later wins)."""
    deployment = os.getenv("AASI_SOURCES_FILE", "").strip()
    entries = _read(Path(deployment).expanduser()) if deployment else []
    return entries + _read(_user_file())


def check_root(root: str) -> str:
    """gs://bucket/prefix (no trailing /) or an absolute folder; '' if unset."""
    root = root.strip()
    if not root:
        return ""
    if any(ch in root for ch in "\x00\n\r"):
        raise HTTPException(status_code=400, detail="Not a location.")
    if root.startswith("gs://"):
        bucket, _, key = root[len("gs://") :].partition("/")
        if not _BUCKET.fullmatch(bucket):
            raise HTTPException(
                status_code=400, detail=f"Not a bucket name: {bucket!r}"
            )
        parts = [p for p in key.split("/") if p]
        if any(p in (".", "..") for p in parts):
            raise HTTPException(status_code=400, detail="A location cannot use '..'.")
        return "gs://" + "/".join([bucket, *parts])
    if "://" in root:
        raise HTTPException(
            status_code=400,
            detail="A location is gs://bucket/folder or a folder on this machine.",
        )
    path = Path(root).expanduser()
    if not path.is_absolute():
        raise HTTPException(
            status_code=400, detail=f"A folder must be a full path (from /): {root!r}"
        )
    return os.path.normpath(path)


def check_layout(layout: str, sonar: str = "") -> str:
    """Segments that are names or {vessel} {survey} {sonar}, in that order."""
    layout = layout.strip().strip("/") or DEFAULT_LAYOUT
    segments = layout.split("/")
    fields = [s for s in segments if s in _FIELDS]
    for segment in segments:
        if segment not in _FIELDS and (
            not _SEGMENT.fullmatch(segment) or segment in (".", "..")
        ):
            raise HTTPException(
                status_code=400,
                detail=f"A layout's folders are names or {{vessel}}, {{survey}}, "
                f"{{sonar}}: not {segment!r}.",
            )
    if fields not in (list(_FIELDS), list(_FIELDS[:2])):
        raise HTTPException(
            status_code=400,
            detail="A layout has {vessel} then {survey}, then {sonar} if the "
            "archive has a folder per echosounder.",
        )
    if "{sonar}" not in fields and not _SEGMENT.fullmatch(sonar.strip()):
        raise HTTPException(
            status_code=400,
            detail="Without {sonar} folders, name the archive's echosounder (EK80 …).",
        )
    return layout


def _source_from(base: DataSource | None, entry: dict[str, Any]) -> DataSource | None:
    try:
        cfg = SourceConfig.model_validate(entry)
    except ValueError:
        return None
    if base is not None:
        return base.model_copy(
            update={
                "root": cfg.root or base.root,
                "layout": cfg.layout or base.layout,
                "sonar": cfg.sonar or base.sonar,
            }
        )
    if not _ID.fullmatch(cfg.id) or cfg.kind not in KINDS or cfg.kind == "ncei":
        return None
    return DataSource(
        id=cfg.id,
        name=" ".join(cfg.name.split())[:40] or cfg.id,
        kind=cfg.kind,
        description=cfg.description.strip()[:300],
        root=cfg.root,
        layout=cfg.layout or DEFAULT_LAYOUT,
        sonar=cfg.sonar,
    )


def _described(source: DataSource) -> DataSource:
    """With ready, detail, fetch and where filled in."""
    if source.kind == "ncei":
        provider = os.getenv("AASI_NCEI_SOURCE", "s3").lower()
        return source.model_copy(
            update={
                "ready": True,
                "fetch": "aa-fetch",
                "where": f"s3://{ncei.BUCKET}/data/raw/{{vessel}}/{{survey}}/{{sonar}}/",
                "detail": "Listed from the project's BigQuery cache."
                if provider == "cache"
                else "Listed from the public S3 bucket.",
            }
        )
    ready, detail = True, ""
    try:
        root = check_root(source.root)
        layout = check_layout(source.layout, source.sonar)
    except HTTPException as exc:
        root, layout, ready, detail = "", source.layout, False, str(exc.detail)
    if not root and ready:
        ready = False
        detail = (
            f"{source.name} is not connected yet: set where its raw files are kept "
            "(a gs:// folder, or a folder on this machine)."
        )
    return source.model_copy(
        update={
            "ready": ready,
            "detail": detail,
            "layout": layout,
            "fetch": ""
            if not root
            else "aa-download"
            if root.startswith("gs://")
            else "cp",
            "where": f"{root}/{layout}/" if root else "",
        }
    )


def all_sources() -> list[DataSource]:
    with _lock:
        stored = _stored()
    found: dict[str, DataSource] = {s.id: s for s in BUILTINS}
    order = [s.id for s in BUILTINS]
    for entry in stored:
        sid = str(entry.get("id", ""))
        # A built-in's entry sets its location (over the deployment's); an
        # added source's later entry replaces the earlier one.
        builtin = any(b.id == sid for b in BUILTINS)
        made = _source_from(found.get(sid) if builtin else None, entry)
        if made is None:
            continue
        if made.id not in found:
            order.append(made.id)
        found[made.id] = made
    return [_described(found[sid]) for sid in order]


def get(source_id: str) -> DataSource:
    for source in all_sources():
        if source.id == source_id:
            return source
    raise HTTPException(status_code=404, detail=f"No source {source_id!r}.")


def save(cfg: SourceConfig) -> DataSource:
    """Add a source, or set where one is (a built-in archive's location)."""
    builtin = next((s for s in BUILTINS if s.id == cfg.id), None)
    if builtin is not None and builtin.kind == "ncei":
        raise HTTPException(
            status_code=400,
            detail="NCEI is configured with AASI_NCEI_SOURCE (s3 or cache), not here.",
        )
    if builtin is None:
        if not _ID.fullmatch(cfg.id):
            raise HTTPException(
                status_code=400,
                detail="A source id is lower-case letters, digits and -, up to 32.",
            )
        if cfg.kind not in KINDS or cfg.kind == "ncei":
            raise HTTPException(
                status_code=400, detail=f"Not a kind of source: {cfg.kind!r}"
            )
        if not " ".join(cfg.name.split()):
            raise HTTPException(status_code=400, detail="Name the source.")
    root = check_root(cfg.root)
    if root and not root.startswith("gs://"):
        _local_guard()
    if not root:
        raise HTTPException(status_code=400, detail="Say where its raw files are.")
    layout = check_layout(cfg.layout, cfg.sonar)
    entry = {
        "id": cfg.id,
        "root": root,
        "layout": layout,
        "sonar": cfg.sonar.strip(),
    }
    if builtin is None:
        entry.update(
            name=" ".join(cfg.name.split())[:40],
            kind=cfg.kind,
            description=cfg.description.strip()[:300],
        )
    with _lock:
        entries = [e for e in _read(_user_file()) if e.get("id") != cfg.id]
        entries.append(entry)
        _write(entries)
    _providers.clear()
    return get(cfg.id)


def forget(source_id: str) -> None:
    """Remove an added source, or a built-in's location (back to unset)."""
    with _lock:
        entries = _read(_user_file())
        kept = [e for e in entries if e.get("id") != source_id]
        if len(kept) == len(entries):
            raise HTTPException(
                status_code=404,
                detail=f"{source_id!r} is not set in your sources"
                + (
                    " (it comes from the deployment's AASI_SOURCES_FILE)."
                    if os.getenv("AASI_SOURCES_FILE")
                    else "."
                ),
            )
        _write(kept)
    _providers.clear()


def _local_guard() -> None:
    """A folder on this machine, named over the network, is the Files panel's
    privilege, with its rule: only while the server listens on this machine
    alone, unless AASI_ALLOW_REMOTE_FS says the host is trusted. (A deployment
    names folders in AASI_SOURCES_FILE, which this does not apply to.)"""
    host = os.getenv("AASI_BIND_HOST", "127.0.0.1")
    allow = os.getenv("AASI_ALLOW_REMOTE_FS", "").lower() in {"1", "true", "yes"}
    if host not in {"127.0.0.1", "::1", "localhost", ""} and not allow:
        raise HTTPException(
            status_code=403,
            detail=(
                f"A folder on this machine cannot be set as a source while the "
                f"server is bound to {host}. Use a gs:// folder, or set "
                "AASI_ALLOW_REMOTE_FS=true only on a trusted host."
            ),
        )


def _write(entries: list[dict[str, Any]]) -> None:
    path = _user_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"sources": entries}, indent=2) + "\n")
    os.replace(tmp, path)


# --------------------------------------------------------------------------- #
# Providers
# --------------------------------------------------------------------------- #
class SourceProvider(Protocol):
    def list_vessels(self) -> list[Vessel]: ...
    def list_surveys(self, vessel_id: str) -> list[Survey]: ...
    def list_sonars(self, vessel_id: str, survey_id: str) -> list[SonarModel]: ...
    def list_raw_files(
        self, vessel_id: str, survey_id: str, sonar_id: str
    ) -> list[RawFile]: ...
    def locations(
        self, vessel_id: str, survey_id: str, sonar_id: str, names: list[str]
    ) -> list[str]: ...


class NceiSource:
    """NCEI, through ncei.py's provider (S3 or the BigQuery cache)."""

    def __init__(self, source: DataSource) -> None:
        self.source = source

    def list_vessels(self) -> list[Vessel]:
        return ncei.get_provider().list_vessels()

    def list_surveys(self, vessel_id: str) -> list[Survey]:
        return ncei.get_provider().list_surveys(vessel_id)

    def list_sonars(self, vessel_id: str, survey_id: str) -> list[SonarModel]:
        return ncei.get_provider().list_sonars(vessel_id, survey_id)

    def list_raw_files(
        self, vessel_id: str, survey_id: str, sonar_id: str
    ) -> list[RawFile]:
        return ncei.get_provider().list_raw_files(vessel_id, survey_id, sonar_id)

    def locations(
        self, vessel_id: str, survey_id: str, sonar_id: str, names: list[str]
    ) -> list[str]:
        # aa-fetch finds NCEI's files itself, from the request document.
        return []


class _Tree:
    """Folders and files below a location: gs:// (or the stand-in bucket the
    console tools use in tests, AA_GCS_FAKE_ROOT) or a folder on this machine."""

    def __init__(self, root: str) -> None:
        self.root = root
        self.gcs = root.startswith("gs://")
        self._client: Any = None

    def _local(self, parts: list[str]) -> Path:
        if self.gcs:
            fake = os.environ["AA_GCS_FAKE_ROOT"]
            return Path(fake, self.root[len("gs://") :], *parts)
        return Path(self.root, *parts)

    def _fake(self) -> bool:
        return self.gcs and bool(os.getenv("AA_GCS_FAKE_ROOT"))

    def _listing(self, parts: list[str]) -> tuple[list[str], list[tuple[str, int]]]:
        """(folder names, [(file name, size)]) directly under *parts*."""
        if not self.gcs or self._fake():
            here = self._local(parts)
            if not here.is_dir():
                return [], []
            folders, files = [], []
            for child in sorted(here.iterdir()):
                if child.name.startswith("."):
                    continue
                if child.is_dir():
                    folders.append(child.name)
                elif child.is_file():
                    files.append((child.name, child.stat().st_size))
            return folders, files
        from google.cloud import storage

        from .gcp import current

        if self._client is None:
            self._client = storage.Client(project=current().project or None)
        bucket, _, key = self.root[len("gs://") :].partition("/")
        # The bucket's own top level is listed with no prefix at all ("/"
        # would match nothing).
        prefix = "/".join(p for p in [key, *parts] if p)
        prefix = f"{prefix}/" if prefix else ""
        iterator = self._client.list_blobs(bucket, prefix=prefix, delimiter="/")
        files = [
            (blob.name[len(prefix) :], int(blob.size or 0))
            for blob in iterator
            if blob.name != prefix
        ]
        folders = sorted(
            p[len(prefix) :].rstrip("/") for p in (iterator.prefixes or set())
        )
        return folders, sorted(files)

    def folders(self, parts: list[str]) -> list[str]:
        return self._listing(parts)[0]

    def files(self, parts: list[str]) -> list[tuple[str, int]]:
        return self._listing(parts)[1]

    def location(self, parts: list[str]) -> str:
        if self.gcs:
            return "/".join([self.root, *parts])
        return str(Path(self.root, *parts))


def _segment(value: str, what: str) -> str:
    """One folder or file name, as asked for: never a path."""
    if (
        not value
        or "/" in value
        or "\\" in value
        or value in (".", "..")
        or "\x00" in value
    ):
        raise HTTPException(status_code=400, detail=f"Not a {what}: {value!r}")
    return value


class ArchiveSource:
    """A folder tree of raw files (see the module's docstring)."""

    def __init__(self, source: DataSource) -> None:
        if not source.ready:
            raise HTTPException(status_code=409, detail=source.detail)
        self.source = source
        self.layout = source.layout.split("/")
        self.tree = _Tree(source.root)

    def _parts(self, **values: str) -> list[str]:
        """The folders down to the last field given."""
        parts: list[str] = []
        for segment in self.layout:
            if segment in _FIELDS:
                name = segment[1:-1]
                if name not in values:
                    break
                parts.append(_segment(values[name], name))
            else:
                parts.append(segment)
        return parts

    def _below(self, field: str, **values: str) -> list[str]:
        """The folders where *field* sits, under the fields given."""
        parts: list[str] = []
        for segment in self.layout:
            if segment == field:
                return self.tree.folders(parts)
            if segment in _FIELDS:
                parts.append(_segment(values[segment[1:-1]], segment[1:-1]))
            else:
                parts.append(segment)
        return []

    def list_vessels(self) -> list[Vessel]:
        return [Vessel(id=n, name=n.replace("_", " ")) for n in self._below("{vessel}")]

    def list_surveys(self, vessel_id: str) -> list[Survey]:
        return [
            Survey(id=n, name=n, vesselId=vessel_id, year=ncei._year_from_survey(n))
            for n in self._below("{survey}", vessel=vessel_id)
        ]

    def list_sonars(self, vessel_id: str, survey_id: str) -> list[SonarModel]:
        if "{sonar}" not in self.layout:
            name = self.source.sonar.strip()
            return [SonarModel(id=name, name=name)]
        return [
            SonarModel(id=n, name=n)
            for n in self._below("{sonar}", vessel=vessel_id, survey=survey_id)
        ]

    def _folder(self, vessel_id: str, survey_id: str, sonar_id: str) -> list[str]:
        values = {"vessel": vessel_id, "survey": survey_id}
        if "{sonar}" in self.layout:
            values["sonar"] = sonar_id
        elif sonar_id != self.source.sonar.strip():
            raise HTTPException(
                status_code=400,
                detail=f"{self.source.name} holds {self.source.sonar} data only.",
            )
        parts = self._parts(**values)
        # Fixed folders after the last field (".../{sonar}/raw") belong too.
        return parts + self.layout[len(parts) :]

    def list_raw_files(
        self, vessel_id: str, survey_id: str, sonar_id: str
    ) -> list[RawFile]:
        folder = self._folder(vessel_id, survey_id, sonar_id)
        return [
            RawFile(
                name=name,
                sizeBytes=size,
                acquiredAt=ncei._acquired_at_from_name(name),
            )
            for name, size in self.tree.files(folder)
            if name.lower().endswith(".raw")
        ]

    def locations(
        self, vessel_id: str, survey_id: str, sonar_id: str, names: list[str]
    ) -> list[str]:
        folder = self._folder(vessel_id, survey_id, sonar_id)
        return [self.tree.location([*folder, _segment(n, "file name")]) for n in names]


#: Kinds of source: how each is listed and fetched. A new kind is one entry.
KINDS: dict[str, Callable[[DataSource], SourceProvider]] = {
    "ncei": NceiSource,
    "archive": ArchiveSource,
}

_providers: dict[str, SourceProvider] = {}


def provider(source_id: str) -> SourceProvider:
    found = _providers.get(source_id)
    if found is None:
        source = get(source_id)
        if not source.ready:
            raise HTTPException(status_code=409, detail=source.detail)
        found = KINDS[source.kind](source)
        _providers[source_id] = found
    return found


def _reset_for_tests() -> None:
    _providers.clear()


def _run(source_id: str, call: Callable[[SourceProvider], Any]) -> Any:
    handler = provider(source_id)
    try:
        return call(handler)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - say what the source answered
        name = get(source_id).name
        raise HTTPException(status_code=502, detail=f"{name}: {exc}") from exc


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@router.get("", response_model=list[DataSource])
def list_sources() -> list[DataSource]:
    return all_sources()


@router.put("/{source_id}", response_model=DataSource)
def put_source(source_id: str, cfg: SourceConfig) -> DataSource:
    if cfg.id != source_id:
        raise HTTPException(
            status_code=400, detail="The id in the path and body differ."
        )
    return save(cfg)


@router.delete("/{source_id}")
def delete_source(source_id: str) -> dict:
    forget(source_id)
    return {"ok": True}


@router.get("/{source_id}/vessels", response_model=list[Vessel])
def vessels(source_id: str) -> list[Vessel]:
    return _run(source_id, lambda p: p.list_vessels())


@router.get("/{source_id}/surveys", response_model=list[Survey])
def surveys(source_id: str, vessel: str = Query(..., min_length=1)) -> list[Survey]:
    return _run(source_id, lambda p: p.list_surveys(vessel))


@router.get("/{source_id}/sonars", response_model=list[SonarModel])
def sonars(
    source_id: str,
    vessel: str = Query(..., min_length=1),
    survey: str = Query(..., min_length=1),
) -> list[SonarModel]:
    return _run(source_id, lambda p: p.list_sonars(vessel, survey))


@router.get("/{source_id}/files", response_model=list[RawFile])
def files(
    source_id: str,
    vessel: str = Query(..., min_length=1),
    survey: str = Query(..., min_length=1),
    sonar: str = Query(..., min_length=1),
) -> list[RawFile]:
    return _run(source_id, lambda p: p.list_raw_files(vessel, survey, sonar))
