"""Lines and regions on an echogram: found in the bucket, read, saved.

Echoview keeps lines (.evl) and regions (.evr) beside the data; so does the
Workbench. aa-annotate (aalibrary) writes and reads them: the Workbench sends
it the shapes drawn in the Echogram panel as JSON, and it publishes an
Echoview file with provenance (its hash is its content; the product it was
drawn on is recorded). The same tool turns a file, or a detected bottom
(aa-detect-seafloor's product), back into JSON shapes to draw.

What belongs to a product: the line and region files, and the detected
bottoms, in its folder (and in the user's own folder for it), whose names
start with the product's base name.
"""

from __future__ import annotations

import json
import threading
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from . import products, toolcalls

router = APIRouter(prefix="/api/annotations", tags=["annotations"])

KINDS = {"lines", "regions", "seafloor"}
#: Points read for display and editing: as many as a save may hold, so a line
#: is edited whole. A longer one comes back thinned and the panel will not
#: save edits to it (they would replace the full line with the thinned one).
MAX_POINTS = 200_000
MAX_REGIONS = 500


class Annotation(BaseModel):
    uri: str
    name: str
    kind: Literal["lines", "regions", "seafloor"]
    #: The name it was saved with ("bottom", "schools"), from its record.
    label: str = ""
    productHash: str = ""
    createdAt: str = ""
    createdBy: str = ""
    drawnOn: str = ""
    sizeBytes: int = 0
    #: Its own records say it is an edit of an earlier one of the same name.
    latest: bool = True


class AnnotationList(BaseModel):
    uri: str
    base: str = ""
    folders: list[str] = Field(default_factory=list)
    items: list[Annotation] = Field(default_factory=list)
    #: Where a new one is saved.
    destination: str = ""


def _destination(uri: str) -> str:
    from .echogram import _destination as dest

    return dest(uri)


def _label_of(name: str, base: str, kind: str) -> str:
    """'HB1603_bottom_1a2b3c4d.evl' -> 'bottom' (base and hash dropped)."""
    stem = name.rsplit(".", 1)[0]
    if base and stem.startswith(base + "_"):
        stem = stem[len(base) + 1 :]
    parts = stem.rsplit("_", 1)
    if (
        len(parts) == 2
        and len(parts[1]) == 8
        and all(c in "0123456789abcdef" for c in parts[1])
    ):
        stem = parts[0]
    return stem or ("bottom" if kind == "seafloor" else kind)


def list_for(uri: str) -> AnnotationList:
    info = products.info(uri)
    if not info.found:
        raise HTTPException(
            status_code=404, detail=info.detail or f"{uri} is not in the bucket."
        )
    dest = _destination(info.uri)
    folders = list(
        dict.fromkeys([products.folder_of(info.uri), *([dest] if dest else [])])
    )
    out = AnnotationList(
        uri=info.uri, base=info.base, folders=folders, destination=dest
    )
    seen: set[str] = set()
    for folder in folders:
        for entry in products.folder_entries(folder):
            name = entry.name
            lowered = name.lower()
            kind = (
                "lines"
                if lowered.endswith(".evl")
                else "regions"
                if lowered.endswith(".evr")
                else "seafloor"
                if entry.productKind == "seafloor"
                else ""
            )
            if not kind or entry.uri in seen:
                continue
            if info.base and not name.startswith(info.base):
                continue
            seen.add(entry.uri)
            out.items.append(
                Annotation(
                    uri=entry.uri,
                    name=name,
                    kind=kind,
                    label=_label_of(name, info.base, kind),
                    productHash=entry.productHash,
                    createdAt=entry.updatedAt,
                    sizeBytes=entry.sizeBytes,
                )
            )
    _add_records(out.items)
    # Newest first; an older file of the same name is an earlier version.
    out.items.sort(key=lambda a: a.createdAt, reverse=True)
    newest: set[tuple[str, str]] = set()
    for item in out.items:
        key = (item.kind, item.label)
        item.latest = key not in newest
        newest.add(key)
    return out


def one(uri: str) -> Annotation:
    """One line, regions or detected-bottom product, with what it was drawn on.

    A line or region file the Workbench saved records the product it was drawn
    on; a detected bottom was made from its Sv, so that is its input.
    """
    info = products.info(uri)
    if not info.found:
        raise HTTPException(
            status_code=404, detail=info.detail or f"{uri} is not in the bucket."
        )
    lowered = info.name.lower()
    kind = (
        "lines"
        if lowered.endswith(".evl")
        else "regions"
        if lowered.endswith(".evr")
        else "seafloor"
        if info.kind == "seafloor"
        else ""
    )
    if not kind:
        raise HTTPException(
            status_code=400, detail=f"{info.name} is not a line or region file."
        )
    item = Annotation(
        uri=info.uri,
        name=info.name,
        kind=kind,
        label=_label_of(info.name, info.base, kind),
        productHash=info.productHash,
        createdAt=info.createdAt,
        sizeBytes=info.sizeBytes,
        latest=True,
    )
    _add_records([item])
    if not item.drawnOn:
        item.drawnOn = _echogram_above(info)
    return item


#: Kinds an echogram can be drawn from.
DRAWABLE = {"sv", "mvbs", "mask", "ts", "noise"}


def _echogram_above(info: products.ProductInfo, depth: int = 4) -> str:
    """The nearest product up the record that draws as an echogram: a bottom
    line made from a detected seafloor was made from an Sv."""
    current = info
    for _ in range(depth):
        sources = [i.uri for i in current.inputs if i.uri.startswith("gs://")]
        if not sources:
            return ""
        parent = products.info(sources[0])
        if not parent.found:
            return ""
        if parent.kind in DRAWABLE:
            return parent.uri
        current = parent
    return ""


def _add_records(items: list[Annotation]) -> None:
    """Who made each one, when, and on what: from the records, in parallel."""
    from concurrent.futures import ThreadPoolExecutor

    def one(item: Annotation) -> None:
        try:
            doc = products.read_record(item.uri) or {}
        except HTTPException:
            return
        extra = doc.get("extra") or {}
        created = doc.get("created") or {}
        if extra.get("name"):
            item.label = str(extra["name"])
        item.drawnOn = str(extra.get("drawn_on") or "")
        item.createdAt = str(created.get("at") or item.createdAt)
        item.createdBy = str(created.get("user") or "")

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(one, items[:200]))


# --------------------------------------------------------------------------- #
# Reading and saving
# --------------------------------------------------------------------------- #
_shapes: dict[tuple[str, str], dict] = {}
_shape_lock = threading.Lock()


def shapes(uri: str) -> dict:
    """A line, regions or detected bottom as JSON shapes (aa-annotate --json)."""
    info = products.info(uri, history=False)
    if not info.found:
        raise HTTPException(
            status_code=404, detail=info.detail or f"{uri} is not in the bucket."
        )
    key = (info.uri, info.md5 or info.generation)
    with _shape_lock:
        held = _shapes.get(key)
    if held is not None:
        return held
    call = toolcalls.run(
        "aa-annotate",
        [info.uri, "--json", f"--max-points={MAX_POINTS}"],
        label=f"Read {info.name}",
        timeout=240,
    )
    if call.state != "succeeded" or not isinstance(call.result, dict):
        raise HTTPException(
            status_code=502 if call.state == "failed" else 504,
            detail=call.error
            or f"Reading {info.name} is taking long; it is in the queue.",
        )
    doc = call.result
    doc["uri"] = info.uri
    with _shape_lock:
        _shapes[key] = doc
        if len(_shapes) > 200:
            _shapes.pop(next(iter(_shapes)))
    return doc


class SaveRequest(BaseModel):
    #: The product the shapes were drawn on.
    reference: str
    #: {"type": "line", "name": ..., "points": [...]} or {"type": "regions", ...}
    shapes: dict[str, Any]
    #: Where it goes, gs://.../; '' for the reference's folder (or the user's).
    dest: str = ""


def _check_shapes(doc: dict) -> dict:
    kind = doc.get("type")
    if kind not in ("line", "regions"):
        raise HTTPException(
            status_code=400, detail='shapes.type must be "line" or "regions".'
        )
    if kind == "line":
        points = doc.get("points") or []
        if not 2 <= len(points) <= 200_000:
            raise HTTPException(
                status_code=400, detail="A line needs 2 to 200,000 points."
            )
    else:
        regions = doc.get("regions") or []
        if not 1 <= len(regions) <= MAX_REGIONS:
            raise HTTPException(status_code=400, detail=f"1 to {MAX_REGIONS} regions.")
        for region in regions:
            if not 3 <= len(region.get("points") or []) <= 20_000:
                raise HTTPException(
                    status_code=400, detail="A region needs 3 to 20,000 points."
                )
    name = str(doc.get("name") or "").strip()
    if len(name) > 60 or any(ord(ch) < 32 for ch in name):
        raise HTTPException(status_code=400, detail="A short one-line name.")
    return doc


def save(req: SaveRequest) -> products.ProductInfo:
    from .pipelines import check_own_dest

    reference = products.info(req.reference, history=False)
    if not reference.found:
        raise HTTPException(
            status_code=404, detail=f"{req.reference} is not in the bucket."
        )
    doc = _check_shapes(req.shapes)
    dest = check_own_dest(req.dest) or _destination(reference.uri)
    if not dest:
        raise HTTPException(
            status_code=409, detail="Choose a GCP project and bucket first."
        )
    scratch = toolcalls.scratch_dir("annotate")
    source = scratch / "shapes.json"
    source.write_text(json.dumps(doc))
    call = toolcalls.run(
        "aa-annotate",
        [str(source), f"--reference={reference.uri}", f"--dest={dest}"],
        label=f"Save {doc.get('name') or doc['type']} on {reference.name}",
        want_json=False,
        timeout=180,
        scratch=scratch,
    )
    if call.state != "succeeded" or not call.output.startswith("gs://"):
        raise HTTPException(status_code=502, detail=call.error or "aa-annotate failed.")
    return products.info(call.output)


@router.get("", response_model=AnnotationList)
def get_list(uri: str = Query(..., min_length=6)) -> AnnotationList:
    return list_for(uri)


@router.get("/one", response_model=Annotation)
def get_one(uri: str = Query(..., min_length=6)) -> Annotation:
    return one(uri)


@router.get("/shapes")
def get_shapes(uri: str = Query(..., min_length=6)) -> dict:
    return shapes(uri)


@router.post("/save", response_model=products.ProductInfo)
def post_save(req: SaveRequest) -> products.ProductInfo:
    return save(req)


def _reset_for_tests() -> None:
    with _shape_lock:
        _shapes.clear()
