"""The Echogram panel's data: tile packs, made by aa-tiles, served a tile at a time.

Opening a product (an Sv, an MVBS, a mask) as an echogram needs its tile pack
(``<product>.tiles``, aalibrary/console/_tilepack.py): every channel, every
zoom level, the values themselves (the browser colours them). The pack is a
product in the bucket, beside the product it shows (or in the user's own
folder when that is someone else's), so a colleague opening the same product
finds it already made.

* :func:`open_echogram` finds the pack, or runs ``aa-tiles`` to make it (a job
  in the Processing Queue; a pack already there for this product is reused).
* The manifest (the pack's JSON header, without its tile index) tells the
  browser the levels, channels and axes. Tiles and axes are sent as stored:
  zlib-compressed bytes the browser inflates itself.

The pack is read from the tools' download cache (fetched once per generation
of the object), so serving a tile is a seek and a read, not a bucket request.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field

from . import products, toolcalls

router = APIRouter(prefix="/api/echogram", tags=["echogram"])

#: Kinds of product an echogram can show.
SHOWABLE = {"sv", "mvbs", "ts", "mask", "noise"}
#: How long a pack's local copy is served before the bucket is asked again
#: whether it changed.
FRESH_SECONDS = 120


class OpenRequest(BaseModel):
    uri: str
    #: Remake the pack even if one is there.
    force: bool = False


class EchogramStatus(BaseModel):
    uri: str
    name: str = ""
    kind: str = ""
    state: Literal["ready", "making", "failed", "unsupported"] = "making"
    #: The tile pack, gs://..., when known.
    tiles: str = ""
    detail: str = ""
    callId: str = ""
    jobId: str = ""
    log: list[str] = Field(default_factory=list)


_making: dict[str, str] = {}  # product uri -> tool call id
_lock = threading.RLock()
_open_lock = threading.Lock()  # held across "is one running?" and starting one


def _tiles_name(name: str) -> str:
    from aalibrary.console._core import naming

    return naming.stem_of(name) + ".tiles"


def _destination(uri: str) -> str:
    from .gcp import current
    from .pipelines import _user, destination_for

    dest, _ = destination_for(uri, current(), _user())
    return dest


def _pack_is_for(pack: products.ProductInfo, product: products.ProductInfo) -> bool:
    """The pack there was made from this product (its record names the
    product's hash as its input)."""
    if not pack.found:
        return False
    if not product.productHash:
        return True  # a product without a hash: the name is all there is
    wanted = "aa:" + product.productHash
    return any(i.id == wanted for i in pack.inputs)


def open_echogram(req: OpenRequest) -> EchogramStatus:
    info = products.info(req.uri)
    out = EchogramStatus(uri=info.uri, name=info.name, kind=info.kind)
    if not info.found:
        out.state = "failed"
        out.detail = info.detail or "Not in the bucket."
        return out
    if info.name.lower().endswith(".tiles"):
        out.state, out.tiles = "ready", info.uri
        return out
    if info.kind and info.kind not in SHOWABLE:
        out.state = "unsupported"
        from .catalogue import KIND_LABELS

        out.detail = (
            "An EchoData has no Sv to show yet: run the 'Sv and echogram' "
            "pipeline on it, "
            "then open the Sv."
            if info.kind == "echodata"
            else f"{KIND_LABELS.get(info.kind, info.kind)} products are not drawn as "
            "echograms. Open an Sv, MVBS, TS or mask."
        )
        return out
    dest = _destination(info.uri)
    if not dest:
        out.state = "failed"
        out.detail = (
            "Choose a GCP project and bucket first: the tiles are written there."
        )
        return out
    expected = dest + _tiles_name(info.name)
    beside = products.folder_of(info.uri) + _tiles_name(info.name)
    if not req.force:
        for candidate in dict.fromkeys([beside, expected]):
            pack = products.info(candidate)
            if _pack_is_for(pack, info):
                out.state, out.tiles = "ready", pack.uri
                return out
    # One aa-tiles per product: two viewers opening it at once share the job.
    with _open_lock:
        with _lock:
            running = _making.get(info.uri)
        call = _call(running) if running else None
        if call is not None and call.state == "running" and not req.force:
            out.callId, out.jobId = call.id, call.jobId
            out.tiles = expected
            return out
        args = [info.uri, f"--dest={dest}"]
        if info.echodata:
            args.append(f"--echodata={info.echodata}")
        if req.force:
            args.append("--force")
        call = toolcalls.start(
            "aa-tiles", args, label=f"Echogram · {info.name}", want_json=False
        )
        with _lock:
            _making[info.uri] = call.id
    out.callId, out.jobId, out.tiles = call.id, call.jobId, expected
    return out


def _call(call_id: str) -> toolcalls.Call | None:
    """The tool call, or None once it has been forgotten (finished calls are
    dropped when many have run): the product is then looked for afresh."""
    try:
        return toolcalls.status(call_id)
    except HTTPException:
        return None


def status(uri: str) -> EchogramStatus:
    info_uri = f"gs://{'/'.join(products.parse(uri))}"
    with _lock:
        call_id = _making.get(info_uri)
    call = _call(call_id) if call_id is not None else None
    if call is None:
        with _lock:
            _making.pop(info_uri, None)
        return open_echogram(OpenRequest(uri=info_uri))
    out = EchogramStatus(
        uri=info_uri,
        name=info_uri.rsplit("/", 1)[-1],
        callId=call.id,
        jobId=call.jobId,
        log=call.log,
    )
    if call.state == "running":
        out.state = "making"
    elif call.state == "succeeded" and call.output.startswith("gs://"):
        out.state, out.tiles = "ready", call.output
        with _lock:
            _making.pop(info_uri, None)
    else:
        out.state, out.detail = "failed", call.error or "aa-tiles failed."
        with _lock:
            _making.pop(info_uri, None)
    return out


# --------------------------------------------------------------------------- #
# Serving a pack
# --------------------------------------------------------------------------- #
class _Pack:
    def __init__(self, path: Path, generation: str, reader):
        self.path = path
        self.generation = generation
        self.reader = reader
        self.checked = time.monotonic()


_packs: dict[str, _Pack] = {}


def _check_uri(uri: str) -> str:
    bucket, key = products.parse(uri)
    if not key.lower().endswith(".tiles"):
        raise HTTPException(status_code=400, detail="Not a tile pack (.tiles).")
    return f"gs://{bucket}/{key}"


def pack(uri: str, *, refresh: bool = False) -> _Pack:
    """The pack's local copy and reader, fetched once per generation."""
    from aalibrary.console import _tilepack
    from aalibrary.console._core import uris

    uri = _check_uri(uri)
    with _lock:
        held = _packs.get(uri)
    if held and not refresh and time.monotonic() - held.checked < FRESH_SECONDS:
        return held
    try:
        local = uris.localize(uri)
    except FileNotFoundError:
        raise HTTPException(
            status_code=404, detail=f"{uri} is not in the bucket."
        ) from None
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502, detail=f"Could not read {uri}: {exc}"
        ) from exc
    generation = str((local.info.generation if local.info else "") or "")
    if held and held.generation == generation and held.path == local.path:
        held.checked = time.monotonic()
        return held
    try:
        reader = _tilepack.Reader(local.path)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"{uri}: {exc}") from exc
    fresh = _Pack(local.path, generation, reader)
    with _lock:
        _packs[uri] = fresh
    return fresh


def manifest(uri: str) -> dict:
    held = pack(uri, refresh=True)
    header = dict(held.reader.header)
    # In the pack, a channel's "index" is its tile directory; to the browser it
    # is the channel's position, which is what a tile is asked for by.
    header["channels"] = [
        {**{k: v for k, v in ch.items() if k != "index"}, "index": i}
        for i, ch in enumerate(header.get("channels", []))
    ]
    header["uri"] = _check_uri(uri)
    header["generation"] = held.generation
    return header


def _bytes(data: bytes) -> Response:
    if not data:
        return Response(status_code=204)
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={
            "Cache-Control": "private, max-age=86400",
            "Content-Encoding": "identity",
        },
    )


@router.post("/open", response_model=EchogramStatus)
def post_open(req: OpenRequest) -> EchogramStatus:
    return open_echogram(req)


@router.get("/status", response_model=EchogramStatus)
def get_status(uri: str = Query(..., min_length=6)) -> EchogramStatus:
    return status(uri)


@router.get("/manifest")
def get_manifest(uri: str = Query(..., min_length=6)) -> dict:
    return manifest(uri)


def _same_generation(held: _Pack, g: str) -> None:
    """A viewer asks by the manifest's generation; if the pack has been made
    again since, its tiles are elsewhere in the file: refuse rather than send
    the wrong bytes (which the browser would cache under the old URL)."""
    if g and held.generation and g != held.generation:
        raise HTTPException(
            status_code=409,
            detail="The tiles were made again since this echogram was opened; "
            "open it again.",
        )


@router.get("/tile")
def get_tile(
    uri: str = Query(..., min_length=6),
    c: int = Query(..., ge=0, le=64),
    level: int = Query(..., ge=0, le=30),
    x: int = Query(..., ge=0),
    y: int = Query(..., ge=0),
    g: str = Query("", max_length=40),
) -> Response:
    held = pack(uri)
    _same_generation(held, g)
    ref = held.reader.tile_ref(c, level, x, y)
    if ref is None:
        raise HTTPException(status_code=404, detail="No such tile.")
    return _bytes(held.reader.raw(ref))


@router.get("/axis")
def get_axis(
    uri: str = Query(..., min_length=6),
    name: Literal["time", "latitude", "longitude"] = Query(...),
    g: str = Query("", max_length=40),
) -> Response:
    held = pack(uri)
    _same_generation(held, g)
    ref = (held.reader.header.get("axes") or {}).get(name)
    if not ref:
        return Response(status_code=204)
    return _bytes(held.reader.raw(ref))


def _reset_for_tests() -> None:
    with _lock:
        _making.clear()
        _packs.clear()
