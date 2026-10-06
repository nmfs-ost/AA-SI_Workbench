"""One product in the bucket: what it is, where it came from, and its hashes.

A product the console tools publish carries its identity three ways, and the
Workbench shows all of them, because each answers a different question:

* **Product hash** (``aa-product-hash``): SHA-256 of what was computed: the
  tool, its scientific settings, the software, and the identity of every
  input. Two products with the same hash are the same science. Its first
  eight characters are what the tools print as ``aa:xxxxxxxx``.
* **Recipe** (``aa-recipe``): the same without the data: the processing. Its
  first eight characters are the ``_<hash8>`` in the file's name, so files
  made the same way from different data share it.
* **Content MD5**: Google's checksum of the bytes. The tools also record the
  MD5 they uploaded (``aa-content-md5``); when the two differ, the object was
  rewritten after the tool published it, and its provenance no longer
  describes it.

These come from the object's metadata (no download). The provenance record
(the small ``<product>.aa.json`` the tools publish beside each product) adds
the history: the steps, the inputs, when. A Zarr store keeps the same fields
in its root attributes.

Read through aalibrary's own object layer, so the Workbench reads the bucket
exactly as the tools do (including the stand-in bucket tests use).
"""

from __future__ import annotations

import base64
import json
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .catalogue import FEATURE_TOOL, LEVELS, TOOL_KIND

router = APIRouter(prefix="/api/products", tags=["products"])

#: Larger than this, a provenance record or a store's attributes is not read.
SMALL = 4 * 1024 * 1024
SIDECAR = ".aa.json"
#: How far back the EchoData a product was made from is looked for.
MAX_HOPS = 8

META_HASH = "aa-product-hash"
META_BASE = "aa-base"
META_TOOL = "aa-tool"
META_MD5 = "aa-content-md5"
META_RECIPE = "aa-recipe"
#: What the tool says the object is (newer aalibrary): a mask written beside a
#: seafloor line is a mask, whichever tool wrote it.
META_KIND = "aa-kind"


class Step(BaseModel):
    tool: str
    product: str = ""
    recipe: str = ""
    params: dict = Field(default_factory=dict)


class InputRef(BaseModel):
    name: str = ""
    uri: str = ""
    role: str = ""
    id: str = ""


class ProductInfo(BaseModel):
    uri: str
    name: str = ""
    found: bool = False
    #: A Zarr store (a prefix), not a single object.
    store: bool = False
    sizeBytes: int = 0
    #: Google's MD5 of the bytes, hex; '' for a store or a composite object.
    md5: str = ""
    crc32c: str = ""
    generation: str = ""
    productHash: str = ""
    recipe: str = ""
    tool: str = ""
    base: str = ""
    kind: str = ""
    level: str = ""
    #: The MD5 the tool published still matches the object: None when the
    #: tool recorded none (older products, stores).
    intact: bool | None = None
    #: Variables it carries that some tools need (depth, location, angles),
    #: read from its history; None when the history is not known.
    features: list[str] | None = None
    #: The EchoData it was made from, when its history says.
    echodata: str = ""
    steps: list[Step] = Field(default_factory=list)
    inputs: list[InputRef] = Field(default_factory=list)
    createdAt: str = ""
    createdBy: str = ""
    software: dict = Field(default_factory=dict)
    detail: str = ""


def _uris():
    from aalibrary.console._core import uris

    return uris


def _hex(b64: str | None) -> str:
    if not b64:
        return ""
    try:
        return base64.b64decode(b64).hex()
    except (ValueError, TypeError):
        return ""


def parse(uri: str) -> tuple[str, str]:
    """(bucket, key) of a gs:// URI; 400 for anything else."""
    from .gcp import BUCKET_RE

    if not uri.startswith("gs://"):
        raise HTTPException(status_code=400, detail=f"Not a gs:// URI: {uri!r}")
    rest = uri[len("gs://") :]
    bucket, _, key = rest.partition("/")
    if (
        not BUCKET_RE.fullmatch(bucket)
        or not key.strip("/")
        or ".." in key.split("/")
        or any(ord(ch) < 32 or ord(ch) == 127 for ch in uri)
    ):
        raise HTTPException(status_code=400, detail=f"Not a product URI: {uri!r}")
    return bucket, key.rstrip("/")


def first_line(exc: BaseException) -> str:
    text = str(exc).strip()
    return (text.splitlines()[0] if text else type(exc).__name__)[:200]


def _read_small(bucket: str, key: str, limit: int = SMALL) -> bytes | None:
    """The bytes of a small object, or None (missing, too big, unreadable)."""
    uris = _uris()
    try:
        info = uris.backend().stat(bucket, key)
    except Exception:  # noqa: BLE001 - unreadable is "not there" here
        return None
    if info is None or info.size > limit:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / "object"
        try:
            uris.backend().download(bucket, key, target)
            return target.read_bytes()
        except Exception:  # noqa: BLE001
            return None


def _read_json(bucket: str, key: str) -> dict | None:
    data = _read_small(bucket, key)
    if data is None:
        return None
    try:
        doc = json.loads(data)
    except ValueError:
        return None
    return doc if isinstance(doc, dict) else None


def _store_attributes(bucket: str, key: str) -> dict:
    """A Zarr store's root attributes (v3 zarr.json, else v2 .zattrs)."""
    v3 = _read_json(bucket, f"{key}/zarr.json")
    if v3 is not None:
        return dict(v3.get("attributes") or {})
    return dict(_read_json(bucket, f"{key}/.zattrs") or {})


#: What a file is from its extension alone, for files the tools did not
#: publish (an Echoview line or region file copied into the bucket).
EXTENSION_KIND = {
    ".raw": "raw",
    ".png": "echogram",
    ".html": "html",
    ".evl": "lines",
    ".evr": "regions",
    ".ecs": "calibration",
    ".tiles": "tiles",
}


#: File formats that say what they are, whichever tool wrote them (aa-annotate
#: writes both line and region files).
FORMAT_KIND = {
    ".evl": "lines",
    ".evr": "regions",
    ".ecs": "calibration",
    ".tiles": "tiles",
}


def kind_of(tool: str, name: str, recorded: str = "") -> str:
    if recorded:
        return recorded
    lowered = name.lower()
    for suffix, kind in FORMAT_KIND.items():
        if lowered.endswith(suffix):
            return kind
    if tool in TOOL_KIND:
        return TOOL_KIND[tool]
    for suffix, kind in EXTENSION_KIND.items():
        if lowered.endswith(suffix):
            return kind
    return ""


def features_of(steps: list[Step]) -> list[str]:
    tools = {step.tool for step in steps}
    return [feature for feature, tool in FEATURE_TOOL.items() if tool in tools]


def info(uri: str, *, history: bool = True) -> ProductInfo:
    """What the bucket says about one product. Never downloads the product."""
    bucket, key = parse(uri)
    uri = f"gs://{bucket}/{key}"
    name = key.rsplit("/", 1)[-1]
    out = ProductInfo(uri=uri, name=name)
    uris = _uris()
    try:
        stat = uris.backend().stat(bucket, key)
    except Exception as exc:  # noqa: BLE001
        out.detail = f"Could not read {uri}: {first_line(exc)}"
        return out

    metadata: dict = {}
    if stat is not None:
        out.found = True
        out.sizeBytes = int(stat.size or 0)
        out.md5 = _hex(stat.md5)
        out.crc32c = _hex(stat.crc32c)
        out.generation = str(stat.generation or "")
        metadata = dict(stat.metadata or {})
        recorded_md5 = metadata.get(META_MD5, "")
        if recorded_md5 and stat.md5:
            out.intact = recorded_md5 == stat.md5
    else:
        attributes = _store_attributes(bucket, key)
        if attributes:
            out.found = True
            out.store = True
            metadata = {
                META_HASH: attributes.get("aa_product_hash", ""),
                META_BASE: attributes.get("aa_base", ""),
                META_TOOL: attributes.get("aa_tool", ""),
                META_RECIPE: attributes.get("aa_recipe", ""),
            }
            out.kind = str(attributes.get("aa_product_kind", "") or "")
        else:
            out.detail = "Not in the bucket (or not readable with your credentials)."
            return out

    out.productHash = str(metadata.get(META_HASH, "") or "")
    out.recipe = str(metadata.get(META_RECIPE, "") or "")
    out.tool = str(metadata.get(META_TOOL, "") or "")
    out.base = str(metadata.get(META_BASE, "") or "")
    out.kind = out.kind or str(metadata.get(META_KIND, "") or "")

    if history:
        doc = _read_json(bucket, key + SIDECAR)
        if doc is not None:
            _add_history(out, doc)
    out.kind = kind_of(out.tool, name, out.kind)
    out.level = LEVELS.get(out.kind, "")
    if out.kind == "echodata":
        out.echodata = uri
    elif history and not out.echodata and out.inputs:
        out.echodata = find_echodata(out)
    return out


def _add_history(out: ProductInfo, doc: dict) -> None:
    product = doc.get("product") or {}
    out.productHash = out.productHash or str(product.get("hash", "") or "")
    out.recipe = out.recipe or str(product.get("recipe", "") or "")
    out.kind = out.kind or str(product.get("kind", "") or "")
    out.base = out.base or str(doc.get("base", "") or "")
    steps = []
    for step in doc.get("pipeline") or []:
        if not isinstance(step, dict):
            continue
        product_id = step.get("product")
        steps.append(
            Step(
                tool=str(step.get("tool", "")),
                product=product_id if isinstance(product_id, str) else "",
                recipe=str(step.get("recipe", "") or ""),
                params=dict(step.get("params") or {}),
            )
        )
    out.steps = steps
    out.tool = out.tool or (steps[-1].tool if steps else "")
    out.features = features_of(steps)
    out.inputs = [
        InputRef(
            name=str(item.get("name", "")),
            uri=str(item.get("uri", "")),
            role=str(item.get("role", "")),
            id=str(item.get("id", "")),
        )
        for item in doc.get("inputs") or []
        if isinstance(item, dict)
    ]
    created = doc.get("created") or {}
    out.createdAt = str(created.get("at", "") or "")
    out.createdBy = str(created.get("user", "") or "")
    software = doc.get("software")
    out.software = software if isinstance(software, dict) else {}


def find_echodata(start: ProductInfo) -> str:
    """The EchoData a product was made from: up its inputs, through their records."""
    current = start
    for _ in range(MAX_HOPS):
        source = next(
            (
                i
                for i in current.inputs
                if i.role == "source" and i.uri.startswith("gs://")
            ),
            None,
        )
        if source is None:
            return ""
        try:
            parent = info(source.uri, history=False)
        except HTTPException:
            return ""
        bucket, key = parse(source.uri)
        doc = _read_json(bucket, key + SIDECAR)
        if doc is not None:
            _add_history(parent, doc)
        parent.kind = kind_of(parent.tool, parent.name, parent.kind)
        if parent.kind == "echodata":
            return source.uri
        current = parent
    return ""


def folder_of(uri: str) -> str:
    """gs://bucket/a/b/x.nc -> gs://bucket/a/b/"""
    bucket, key = parse(uri)
    folder = key.rsplit("/", 1)[0] + "/" if "/" in key else ""
    return f"gs://{bucket}/{folder}"


def folder_entries(folder_uri: str, limit: int = 1000) -> list:
    """The objects in one folder of the chosen bucket, one level, as the
    Products panel lists them (with each object's hash, tool and kind); []
    for a folder in another bucket or one that cannot be listed."""
    from . import derived

    if not folder_uri.startswith("gs://"):
        return []
    bucket, _, key = folder_uri[len("gs://") :].partition("/")
    if bucket != derived.bucket_name():
        return []
    root = derived.root_prefix()
    if root and not key.startswith(root):
        return []
    relative = key[len(root) :] if root else key
    try:
        listing = derived.get_provider().list(relative, limit)
    except Exception:  # noqa: BLE001 - nothing listed is an answer here
        return []
    return [entry for entry in listing.entries if not entry.isDir]


def read_record(uri: str) -> dict | None:
    """A product's provenance record (its <product>.aa.json), or None."""
    bucket, key = parse(uri)
    return _read_json(bucket, key + SIDECAR)


class Table(BaseModel):
    uri: str
    columns: list[str] = Field(default_factory=list)
    #: The rows (of the chosen frequency, when the table has a Frequency column).
    rows: list[list[str]] = Field(default_factory=list)
    #: Rows of that frequency in the file (rows holds the first `limit`).
    total: int = 0
    truncated: bool = False
    #: Every frequency in the file, as written (kHz).
    frequencies: list[str] = Field(default_factory=list)
    frequency: str = ""
    #: NASC summed over the layers of each interval, over every row of that
    #: frequency: [interval, NASC]. Region-cell exports are summed by PRC_NASC
    #: (the region's share of the cell), so a region in one ping of a cell
    #: counts as that ping, as Echoview's PRC_ values do.
    perInterval: list[tuple[int, float]] = Field(default_factory=list)
    nascColumn: str = ""
    detail: str = ""


#: Integration exports are read whole (the panel summarises every row).
TABLE_BYTES = 64 * 1024 * 1024


def table(uri: str, limit: int = 2000, frequency: str = "") -> Table:
    """An integration export (CSV) for the Results panel: the rows of one
    frequency, and NASC per interval over all of them."""
    import csv
    import io

    bucket, key = parse(uri)
    out = Table(uri=f"gs://{bucket}/{key}")
    if not key.lower().endswith(".csv"):
        out.detail = "Not a CSV product."
        return out
    data = _read_small(bucket, key, TABLE_BYTES)
    if data is None:
        out.detail = "Not in the bucket, unreadable, or larger than 64 MB."
        return out
    reader = csv.reader(io.StringIO(data.decode("utf-8", "replace")))
    header = next(reader, None)
    if not header:
        return out
    out.columns = header
    col = {name: i for i, name in enumerate(header)}
    fi = col.get("Frequency")
    body = list(reader)
    if fi is not None:
        out.frequencies = list(dict.fromkeys(r[fi] for r in body if len(r) > fi))
        out.frequency = (
            frequency
            if frequency in out.frequencies
            else (out.frequencies[0] if out.frequencies else "")
        )
        body = [r for r in body if len(r) > fi and r[fi] == out.frequency]
    out.total = len(body)
    out.rows = body[:limit]
    out.truncated = len(body) > limit
    nasc = col.get("PRC_NASC", col.get("NASC"))
    ii = col.get("Interval")
    if nasc is not None and ii is not None:
        out.nascColumn = header[nasc]
        sums: dict[int, float] = {}
        for r in body:
            try:
                k = int(float(r[ii]))
                v = float(r[nasc])
            except (ValueError, IndexError):
                continue
            if v == v:  # NaN is no data, not zero
                sums[k] = sums.get(k, 0.0) + v
        out.perInterval = sorted(sums.items())
    return out


class Nearby(BaseModel):
    uri: str
    name: str
    kind: str = ""
    productHash: str = ""
    tool: str = ""
    updatedAt: str = ""


def nearby(uri: str, kinds: list[str], limit: int = 200) -> list[Nearby]:
    """Products of these kinds beside a product (its folder, and the folder its
    products go to): the choices for an option that takes a product, an ECS
    for aa-sv or a line file for aa-integrate, say. Newest first."""
    from .echogram import _destination

    wanted = {k for k in kinds if k}
    folders = [folder_of(uri)]
    try:
        dest = _destination(uri)
    except Exception:  # noqa: BLE001 - no bucket chosen: its own folder only
        dest = ""
    if dest and dest not in folders:
        folders.append(dest)
    out: list[Nearby] = []
    seen: set[str] = set()
    for folder in folders:
        for entry in folder_entries(folder):
            kind = entry.productKind or kind_of("", entry.name)
            if entry.uri in seen or (wanted and kind not in wanted):
                continue
            seen.add(entry.uri)
            out.append(
                Nearby(
                    uri=entry.uri,
                    name=entry.name,
                    kind=kind,
                    productHash=entry.productHash,
                    tool=entry.tool,
                    updatedAt=entry.updatedAt,
                )
            )
    out.sort(key=lambda n: n.updatedAt, reverse=True)
    return out[:limit]


@router.get("/nearby", response_model=list[Nearby])
def get_nearby(
    uri: str = Query(..., min_length=6), kinds: str = Query("", max_length=200)
) -> list[Nearby]:
    if not uri.startswith("gs://"):
        raise HTTPException(status_code=400, detail="A gs:// URI.")
    return nearby(uri, [k.strip() for k in kinds.split(",")])


@router.get("/info", response_model=ProductInfo)
def get_info(uri: str = Query(..., min_length=6)) -> ProductInfo:
    return info(uri)


@router.get("/table", response_model=Table)
def get_table(
    uri: str = Query(..., min_length=6),
    limit: int = Query(2000, ge=1, le=20000),
    frequency: str = Query("", max_length=20),
) -> Table:
    return table(uri, limit, frequency)
