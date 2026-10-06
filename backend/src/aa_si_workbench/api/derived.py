"""Derived assets — the GCS bucket holding products the pipelines produce.

Where NCEI is the read-only *source* archive, this is the *output* side: the
combined NetCDFs, Sv products, masks and figures that `aa-combine`, `aa-sv` and
friends write back to Google Cloud Storage.

Listing is done with the storage API's delimiter mode, which turns a flat object
namespace into something browsable: ``prefix=""``, ``delimiter="/"`` returns the
top-level "folders" plus any objects at the root, and each folder can then be
opened on demand. That matters because a survey season's worth of derived
products is far too large to enumerate eagerly.

Configuration
-------------
The bucket and project are the ones this user chose (gcp.py: the status bar's
project button, or ``aa-workbench project``). Without a choice,
``AASI_DERIVED_BUCKET`` / ``AASI_GCP_PROJECT`` decide; with neither, the panel
says to choose instead of guessing.

``AASI_DERIVED_PREFIX``   optional prefix to treat as the root, e.g. ``derived/``

Credentials are Application Default Credentials — the same ones `aa-fetch` uses.
Nothing is stored by the Workbench.

Read-only. There is no upload or delete here; writing derived products is the
pipelines' job, and doing it from a browser panel would put a destructive action
one misclick away from a listing.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, NamedTuple, Protocol

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter(prefix="/api/derived", tags=["derived"])


# Extensions worth badging in the UI; everything else lists as a plain object.
ASSET_KINDS: dict[str, str] = {
    ".nc": "netcdf",
    ".netcdf": "netcdf",
    ".zarr": "zarr",
    ".raw": "raw",
    ".csv": "table",
    ".json": "text",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".evr": "region",
    ".evl": "line",
    ".ecs": "calibration",
    ".tiles": "tiles",
}


def bucket_name() -> str:
    """The bucket this user chose (see gcp.py), or the deployment's; '' if none."""
    from .gcp import current

    return current().bucket


def project_id() -> str:
    from .gcp import current

    return current().project


def root_prefix() -> str:
    prefix = os.getenv("AASI_DERIVED_PREFIX", "")
    return f"{prefix.rstrip('/')}/" if prefix else ""


class DerivedEntry(BaseModel):
    """One row in the browser: a folder (common prefix) or a stored object."""

    name: str
    path: str  # full object name / prefix, relative to the bucket
    uri: str  # gs://bucket/path — what a pipeline actually consumes
    isDir: bool = False
    kind: str = "object"
    sizeBytes: int = 0
    updatedAt: str = ""
    contentType: str = ""
    # What the console tools recorded when they published it (no download:
    # these are the object's metadata). See products.py for what each means.
    #: The product hash: the science (aa-product-hash), hex.
    productHash: str = ""
    #: The recipe: the processing, without the data; the <hash8> in the name.
    recipe: str = ""
    #: The tool that wrote it.
    tool: str = ""
    #: What it is (echodata, sv, mvbs, ...) and its level (L1, L2A, ...).
    productKind: str = ""
    level: str = ""
    #: Google's MD5 of the bytes, hex.
    md5: str = ""
    #: The MD5 the tool published still matches; None when none was recorded.
    intact: bool | None = None
    #: GCS storage class (STANDARD, NEARLINE, COLDLINE, ARCHIVE): what its
    #: storage costs per GiB-month. '' for folders and stores.
    storageClass: str = ""


class StoredObject(NamedTuple):
    """One object, as the cost summary needs it."""

    key: str  # relative to the browsed root
    size: int
    storage_class: str


class BucketInfo(BaseModel):
    """Where the bucket is and its default class: what its storage costs."""

    bucket: str
    location: str = ""
    locationType: str = ""
    storageClass: str = ""
    #: The location could not be read (no permission, or the stand-in bucket):
    #: the figures use an assumed one.
    assumed: bool = False


def _hex(b64: str | None) -> str:
    if not b64:
        return ""
    try:
        return base64.b64decode(b64).hex()
    except (ValueError, TypeError):
        return ""


def _product_fields(name: str, md5_b64: str | None, metadata: dict | None) -> dict:
    """The entry fields the tools' metadata gives, for one object."""
    from .catalogue import LEVELS
    from .products import (
        META_HASH,
        META_KIND,
        META_MD5,
        META_RECIPE,
        META_TOOL,
        kind_of,
    )

    metadata = metadata or {}
    tool = str(metadata.get(META_TOOL, "") or "")
    known = tool or name.lower().endswith(
        (".raw", ".png", ".evl", ".evr", ".ecs", ".tiles")
    )
    kind = kind_of(tool, name, str(metadata.get(META_KIND, "") or "")) if known else ""
    recorded = metadata.get(META_MD5, "")
    return {
        "productHash": str(metadata.get(META_HASH, "") or ""),
        "recipe": str(metadata.get(META_RECIPE, "") or ""),
        "tool": tool,
        "productKind": kind,
        "level": LEVELS.get(kind, ""),
        "md5": _hex(md5_b64),
        "intact": (recorded == md5_b64) if recorded and md5_b64 else None,
    }


class DerivedListing(BaseModel):
    bucket: str
    prefix: str
    parent: str
    entries: list[DerivedEntry]
    truncated: bool = False


class DerivedStatus(BaseModel):
    bucket: str
    project: str
    prefix: str
    configured: bool
    available: bool
    detail: str = ""
    consoleUrl: str = ""


class DerivedProvider(Protocol):
    def list(self, prefix: str, limit: int) -> DerivedListing: ...

    def walk(self, prefix: str, max_objects: int) -> Iterator[StoredObject]: ...

    def bucket_info(self) -> BucketInfo: ...


def _kind_for(name: str) -> str:
    lowered = name.lower()
    for suffix, kind in ASSET_KINDS.items():
        if lowered.endswith(suffix):
            return kind
    return "object"


def _parent_of(prefix: str) -> str:
    """The prefix one level up, or "" at the root."""
    if not prefix:
        return ""
    trimmed = prefix.rstrip("/")
    return trimmed.rsplit("/", 1)[0] + "/" if "/" in trimmed else ""


# The metadata document at the root of a store, at both Zarr versions. Their
# presence is what distinguishes a store from a folder that merely contains
# one, and probing for them is two HEAD requests rather than a listing.
ZARR_ROOT_MARKERS = ("zarr.json", ".zgroup", ".zarray")

# Whether a prefix is a store is a property of the bucket, not of the client
# object that happened to ask, so the answer is cached here rather than on the
# provider. It also cannot change while the panel is open — a store does not
# stop being one — and the same folder is re-probed on every expand and refresh.
# Keyed by bucket too: a probe still running on the previous bucket when the
# project changes must not answer for the same prefix in the new one.
_store_probe_cache: dict[tuple[str, str], bool] = {}


class GcsProvider:
    """Lists the bucket through google-cloud-storage using ADC."""

    def __init__(self) -> None:
        # Imported lazily so a workstation without the GCS extra can still run
        # every other part of the Workbench.
        from google.cloud import storage

        self._client = storage.Client(project=project_id() or None)
        self._bucket = self._client.bucket(bucket_name())

    def _is_store(self, prefix: str) -> bool:
        """True when this prefix is the root of a Zarr store.

        Two HEADs at most, never a listing — the distinction matters because
        listing is precisely the operation that hangs on a store. A store named
        `*.zarr` is caught by the suffix before this is ever called; this exists
        for the ones that were not.
        """
        if not prefix:
            return False
        key = prefix if prefix.endswith("/") else f"{prefix}/"
        slot = (str(getattr(self._bucket, "name", "")), key)
        cached = _store_probe_cache.get(slot)
        if cached is not None:
            return cached

        found = False
        for marker in ZARR_ROOT_MARKERS:
            try:
                if self._bucket.blob(f"{key}{marker}").exists(self._client):
                    found = True
                    break
            except Exception:  # noqa: BLE001 - an unreachable probe is not a store
                break
        _store_probe_cache[slot] = found
        return found

    def list(self, prefix: str, limit: int) -> DerivedListing:
        root = root_prefix()
        full = f"{root}{prefix}"

        # A Zarr store is a directory of chunk objects, and the object store has
        # no idea it is anything other than a very deep folder. Listing one here
        # would enumerate every chunk — tens of thousands on a survey, millions
        # on a season — and the panel hangs on a listing nobody wanted. So a
        # prefix that *is* a store answers with the store itself, as a leaf.
        if self._is_store(full):
            relative = full[len(root) :] if root else full
            return DerivedListing(
                bucket=bucket_name(),
                prefix=prefix,
                parent=_parent_of(prefix),
                entries=[
                    DerivedEntry(
                        name=relative.rstrip("/").rsplit("/", 1)[-1],
                        path=relative.rstrip("/"),
                        uri=f"gs://{bucket_name()}/{full.rstrip('/')}",
                        isDir=False,
                        kind="zarr",
                    )
                ],
            )

        iterator = self._client.list_blobs(
            self._bucket, prefix=full, delimiter="/", max_results=limit
        )
        blobs: list[Any] = list(iterator)
        # `prefixes` is only populated once the iterator has been consumed.
        folders: set[str] = set(getattr(iterator, "prefixes", set()) or set())

        entries: list[DerivedEntry] = []
        for folder in sorted(folders):
            relative = folder[len(root) :] if root else folder
            name = relative.rstrip("/").rsplit("/", 1)[-1]
            # The store itself is the asset. Listed as a leaf it can be selected
            # and handed to `aa-store info` — the whole point of it appearing
            # here — instead of being a folder whose contents interest nobody.
            #
            # The suffix is checked first because it is free and correct almost
            # always; the probe is the fallback for a store that was named
            # without one. Cheap test first, one HEAD second, never a listing.
            store = name.lower().endswith(".zarr") or self._is_store(folder)
            entries.append(
                DerivedEntry(
                    name=name,
                    path=relative.rstrip("/") if store else relative,
                    uri=f"gs://{bucket_name()}/"
                    f"{folder.rstrip('/') if store else folder}",
                    isDir=not store,
                    kind="zarr" if store else "folder",
                )
            )

        for blob in blobs:
            # A "directory placeholder" object — the zero-byte marker the
            # console creates — is noise once folders are listed separately.
            if blob.name.endswith("/"):
                continue
            # `<product>.aa.json` is the provenance the console tools publish
            # beside each product so it can be read without downloading it.
            # It describes its neighbour; listed, it would double every row.
            if blob.name.endswith(".aa.json"):
                continue
            relative = blob.name[len(root) :] if root else blob.name
            entries.append(
                DerivedEntry(
                    name=relative.rsplit("/", 1)[-1],
                    path=relative,
                    uri=f"gs://{bucket_name()}/{blob.name}",
                    kind=_kind_for(blob.name),
                    sizeBytes=int(blob.size or 0),
                    updatedAt=blob.updated.isoformat().replace("+00:00", "Z")
                    if blob.updated
                    else "",
                    contentType=blob.content_type or "",
                    storageClass=str(getattr(blob, "storage_class", "") or "STANDARD"),
                    **_product_fields(
                        blob.name.rsplit("/", 1)[-1],
                        getattr(blob, "md5_hash", None),
                        getattr(blob, "metadata", None),
                    ),
                )
            )

        return DerivedListing(
            bucket=bucket_name(),
            prefix=prefix,
            parent=_parent_of(prefix),
            entries=entries,
            truncated=len(blobs) >= limit,
        )

    def walk(self, prefix: str, max_objects: int) -> Iterator[StoredObject]:
        """Every object under a prefix (stores' chunks included): name, size
        and class only, a thousand a page."""
        root = root_prefix()
        blobs = self._client.list_blobs(
            self._bucket,
            prefix=f"{root}{prefix}",
            max_results=max_objects,
            page_size=1000,
            fields="items(name,size,storageClass),nextPageToken",
        )
        for blob in blobs:
            name = blob.name[len(root) :] if root else blob.name
            yield StoredObject(
                name, int(blob.size or 0), str(blob.storage_class or "STANDARD")
            )

    def bucket_info(self) -> BucketInfo:
        try:
            bucket = self._client.get_bucket(bucket_name())
        except Exception:  # noqa: BLE001 - needs storage.buckets.get; often not granted
            return BucketInfo(bucket=bucket_name(), assumed=True)
        return BucketInfo(
            bucket=bucket_name(),
            location=str(bucket.location or ""),
            locationType=str(getattr(bucket, "location_type", "") or ""),
            storageClass=str(bucket.storage_class or ""),
        )


_provider: DerivedProvider | None = None
#: The (project, bucket) the provider was built for; None for an injected one.
_provider_for: tuple[str, str] | None = None


class FakeGcsProvider:
    """The stand-in bucket the console tools use in tests (AA_GCS_FAKE_ROOT):
    ``<root>/<bucket>/<key>``, metadata in ``<root>/.meta/<bucket>/<key>.json``.

    Listed with the same rules as the real one, so a rehearsal exercises the
    panel's own code. Never used unless that variable is set.
    """

    def __init__(self, root: str) -> None:
        self.root = Path(root)

    def list(self, prefix: str, limit: int) -> DerivedListing:
        bucket = bucket_name()
        base = self.root / bucket
        full = f"{root_prefix()}{prefix}"
        here = base / full
        entries: list[DerivedEntry] = []
        if here.is_dir():
            children = sorted(here.iterdir(), key=lambda p: (not p.is_dir(), p.name))
            for path in children[:limit]:
                key = path.relative_to(base).as_posix()
                relative = key[len(root_prefix()) :] if root_prefix() else key
                if path.name.startswith(".") or path.name.endswith(".aa.json"):
                    continue
                if path.is_dir() and not path.name.lower().endswith(".zarr"):
                    entries.append(
                        DerivedEntry(
                            name=path.name,
                            path=relative + "/",
                            uri=f"gs://{bucket}/{key}/",
                            isDir=True,
                            kind="folder",
                        )
                    )
                    continue
                if path.is_dir():
                    entries.append(
                        DerivedEntry(
                            name=path.name,
                            path=relative,
                            uri=f"gs://{bucket}/{key}",
                            kind="zarr",
                        )
                    )
                    continue
                meta_file = self.root / ".meta" / bucket / (key + ".json")
                try:
                    meta_doc = json.loads(meta_file.read_text())
                except (OSError, ValueError):
                    meta_doc = {}
                metadata = meta_doc.get("metadata", {}) or {}
                digest = hashlib.md5(path.read_bytes()).digest()  # noqa: S324 - GCS's own
                stat = path.stat()
                entries.append(
                    DerivedEntry(
                        name=path.name,
                        path=relative,
                        uri=f"gs://{bucket}/{key}",
                        kind=_kind_for(path.name),
                        sizeBytes=stat.st_size,
                        updatedAt=datetime.fromtimestamp(stat.st_mtime, UTC)
                        .isoformat(timespec="seconds")
                        .replace("+00:00", "Z"),
                        storageClass=str(meta_doc.get("storageClass") or "STANDARD"),
                        **_product_fields(
                            path.name, base64.b64encode(digest).decode(), metadata
                        ),
                    )
                )
        return DerivedListing(
            bucket=bucket,
            prefix=prefix,
            parent=_parent_of(prefix),
            entries=entries,
            truncated=False,
        )

    def walk(self, prefix: str, max_objects: int) -> Iterator[StoredObject]:
        bucket = bucket_name()
        base = self.root / bucket
        root = root_prefix()
        start = base / f"{root}{prefix}"
        count = 0
        for folder, dirs, files in os.walk(start):
            dirs.sort()
            for name in sorted(files):
                path = Path(folder) / name
                key = path.relative_to(base).as_posix()
                meta_file = self.root / ".meta" / bucket / (key + ".json")
                try:
                    cls = json.loads(meta_file.read_text()).get("storageClass") or ""
                except (OSError, ValueError):
                    cls = ""
                yield StoredObject(
                    key[len(root) :] if root else key,
                    path.stat().st_size,
                    str(cls or "STANDARD"),
                )
                count += 1
                if count >= max_objects:
                    return

    def bucket_info(self) -> BucketInfo:
        # The stand-in bucket has no location: say which one is assumed.
        location = os.getenv("AA_GCS_FAKE_LOCATION", "")
        return BucketInfo(
            bucket=bucket_name(),
            location=location,
            locationType="region" if location else "",
            storageClass="STANDARD",
            assumed=not location,
        )


def get_provider() -> DerivedProvider:
    """The provider for the bucket in force. Raises if GCS isn't usable here."""
    global _provider, _provider_for
    wanted = (project_id(), bucket_name())
    if _provider is None or (_provider_for is not None and _provider_for != wanted):
        fake = os.getenv("AA_GCS_FAKE_ROOT", "")
        _provider = FakeGcsProvider(fake) if fake else GcsProvider()
        _provider_for = wanted
        _store_probe_cache.clear()
    return _provider


def _forget_provider() -> None:
    """A new project or bucket was chosen: build the next provider afresh."""
    global _provider, _provider_for
    if _provider_for is not None:
        _provider, _provider_for = None, None
    _store_probe_cache.clear()


def _register() -> None:
    from .gcp import on_change

    on_change(_forget_provider)


_register()


def _reset_for_tests(provider: DerivedProvider | None = None) -> None:
    global _provider, _provider_for
    _provider, _provider_for = provider, None
    _store_probe_cache.clear()


def _explain(exc: Exception) -> str:
    """Turn the usual GCP failures into something a scientist can act on."""
    text = str(exc)
    if isinstance(exc, ImportError):
        return (
            "google-cloud-storage isn't installed in this environment. "
            "Install it with: pip install google-cloud-storage"
        )
    lowered = text.lower()
    missing_creds = "default credentials" in lowered or (
        "could not automatically determine" in lowered
    )
    if missing_creds:
        return (
            "No Google credentials found. Run "
            "`gcloud auth application-default login` once, then reload."
        )
    if "403" in text or "permission" in lowered or "forbidden" in lowered:
        return (
            f"Access to gs://{bucket_name()} was denied for this account. "
            "Ask for storage.objects.list on that bucket, or check you are "
            "logged in as the right user."
        )
    if "404" in text or "not found" in lowered:
        return (
            f"Bucket gs://{bucket_name()} was not found. Choose another project "
            "and bucket (click the project in the status bar)."
        )
    if "quota" in lowered or "billing" in lowered or "serviceusage" in lowered:
        return (
            "The credentials have no quota project. Run "
            "`gcloud auth application-default set-quota-project "
            f"{project_id() or '<project>'}` and reload."
        )
    return text


@router.get("", response_model=DerivedStatus)
def status() -> DerivedStatus:
    """Whether the bucket is reachable, and why not when it isn't.

    Deliberately never raises: the panel needs to render an explanation, and a
    502 would leave it with nothing useful to show.
    """
    bucket = bucket_name()
    if not bucket:
        return DerivedStatus(
            bucket="",
            project="",
            prefix=root_prefix(),
            configured=False,
            available=False,
            detail=(
                "No GCP project and bucket chosen yet. Choose one (the project in "
                "the status bar, or Tools ▸ GCP project and bucket) and this panel "
                "lists it."
            ),
        )
    console = (
        f"https://console.cloud.google.com/storage/browser/{bucket}"
        f"?project={project_id()}"
    )
    try:
        get_provider().list("", 1)
    except Exception as exc:  # noqa: BLE001 - the reason IS the payload here
        return DerivedStatus(
            bucket=bucket,
            project=project_id(),
            prefix=root_prefix(),
            configured=True,
            available=False,
            detail=_explain(exc),
            consoleUrl=console,
        )
    return DerivedStatus(
        bucket=bucket,
        project=project_id(),
        prefix=root_prefix(),
        configured=True,
        available=True,
        consoleUrl=console,
    )


@router.get("/list", response_model=DerivedListing)
def list_prefix(
    prefix: str = Query(default=""),
    limit: int = Query(default=1000, ge=1, le=5000),
) -> DerivedListing:
    """One level of the bucket: sub-folders first, then objects."""
    if prefix.startswith("/") or ".." in prefix:
        raise HTTPException(status_code=400, detail=f"Bad prefix: {prefix}")
    try:
        return get_provider().list(prefix, limit)
    except Exception as exc:  # noqa: BLE001 - surface backend errors to client
        raise HTTPException(status_code=502, detail=_explain(exc)) from exc
