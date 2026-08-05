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
``AASI_DERIVED_BUCKET``   bucket name (default ``ggn-nmfs-aa-dev-1-data``)
``AASI_DERIVED_PREFIX``   optional prefix to treat as the root, e.g. ``derived/``
``AALIBRARY_GCP_PROJECT_ID``  project used for billing/quota (default
                          ``ggn-nmfs-aa-dev-1``); the same variable aalibrary uses

Credentials are Application Default Credentials — the same ones `aa-fetch` uses.
Nothing is stored by the Workbench.

Read-only. There is no upload or delete here; writing derived products is the
pipelines' job, and doing it from a browser panel would put a destructive action
one misclick away from a listing.
"""

from __future__ import annotations

import os
from typing import Any, Protocol

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter(prefix="/api/derived", tags=["derived"])

DEFAULT_BUCKET = "ggn-nmfs-aa-dev-1-data"
DEFAULT_PROJECT = "ggn-nmfs-aa-dev-1"

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
}


def bucket_name() -> str:
    return os.getenv("AASI_DERIVED_BUCKET", DEFAULT_BUCKET)


def project_id() -> str:
    return os.getenv("AALIBRARY_GCP_PROJECT_ID", DEFAULT_PROJECT)


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
_store_probe_cache: dict[str, bool] = {}


class GcsProvider:
    """Lists the bucket through google-cloud-storage using ADC."""

    def __init__(self) -> None:
        # Imported lazily so a workstation without the GCS extra can still run
        # every other part of the Workbench.
        from google.cloud import storage

        self._client = storage.Client(project=project_id())
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
        cached = _store_probe_cache.get(key)
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
        _store_probe_cache[key] = found
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
                )
            )

        return DerivedListing(
            bucket=bucket_name(),
            prefix=prefix,
            parent=_parent_of(prefix),
            entries=entries,
            truncated=len(blobs) >= limit,
        )


_provider: DerivedProvider | None = None


def get_provider() -> DerivedProvider:
    """Construct the provider once. Raises if GCS isn't usable here."""
    global _provider
    if _provider is None:
        _provider = GcsProvider()
    return _provider


def _reset_for_tests(provider: DerivedProvider | None = None) -> None:
    global _provider
    _provider = provider
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
            f"Bucket gs://{bucket_name()} was not found. Check "
            "AASI_DERIVED_BUCKET."
        )
    if "quota" in lowered or "billing" in lowered or "serviceusage" in lowered:
        return (
            "The credentials have no quota project. Run "
            "`gcloud auth application-default set-quota-project "
            f"{project_id()}` and reload."
        )
    return text


@router.get("", response_model=DerivedStatus)
def status() -> DerivedStatus:
    """Whether the bucket is reachable, and why not when it isn't.

    Deliberately never raises: the panel needs to render an explanation, and a
    502 would leave it with nothing useful to show.
    """
    bucket = bucket_name()
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
