"""What the bucket's storage costs: per object, per folder, per month and year.

Estimates of storage at rest, from Google's list prices (cloud.google.com/
storage/pricing, read on PRICES_AS_OF): a GiB stored for a month costs the
hourly rate for the bucket's location and the object's storage class, times
730 hours. Operations, retrieval, early deletion and network egress are billed
separately and are not in these figures.

A team with its own price (a commitment, a discount, storage bought up front)
sets it once (PUT /api/costs/price): every figure then uses it, and says so.

The folder summary lists every object under the folder (names, sizes and
classes only, a thousand per request) and is kept for a few minutes.
"""

from __future__ import annotations

import json
import threading
import time
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from . import derived

router = APIRouter(prefix="/api/costs", tags=["costs"])

SOURCE = "https://cloud.google.com/storage/pricing"
PRICES_AS_OF = "2026-10-06"
HOURS_PER_MONTH = 730
GIB = 1024**3
CLASSES = ("STANDARD", "NEARLINE", "COLDLINE", "ARCHIVE")

#: List prices, $ per GiB per hour, at rest (Google's page, PRICES_AS_OF).
HOURLY: dict[str, dict[str, float]] = {
    # us-central1 (Iowa), us-east1 (South Carolina), us-east4 (N. Virginia)
    "us-region": {
        "STANDARD": 0.000027397,
        "NEARLINE": 0.000013699,
        "COLDLINE": 0.000005479,
        "ARCHIVE": 0.000001644,
    },
    # US multi-region
    "us": {
        "STANDARD": 0.000035616,
        "NEARLINE": 0.000020548,
        "COLDLINE": 0.000011986,
        "ARCHIVE": 0.00000411,
    },
    # nam4 dual-region (Iowa and South Carolina)
    "nam4": {
        "STANDARD": 0.000030137,
        "NEARLINE": 0.000015068,
        "COLDLINE": 0.000006027,
        "ARCHIVE": 0.000001918,
    },
}
TABLE_LABEL = {
    "us-region": "US region (us-central1, us-east1, us-east4)",
    "us": "US multi-region",
    "nam4": "nam4 dual-region",
}
PRICED_REGIONS = {"US-CENTRAL1", "US-EAST1", "US-EAST4"}
#: Minimum days an object is billed for, by class.
MINIMUM_DAYS = {"STANDARD": 0, "NEARLINE": 30, "COLDLINE": 90, "ARCHIVE": 365}

MAX_OBJECTS = 500_000
SUMMARY_SECONDS = 600


class Prices(BaseModel):
    bucket: str = ""
    location: str = ""
    locationType: str = ""
    defaultClass: str = "STANDARD"
    #: The bucket's location could not be read; the price is for an assumed one.
    assumed: bool = False
    #: Which list-price table applies, and in words.
    table: str = "us-region"
    tableLabel: str = ""
    #: $ per GiB-month by storage class: what every figure uses.
    perGiBMonth: dict[str, float] = Field(default_factory=dict)
    #: Google's list price, for comparison when the team's own is set.
    listPerGiBMonth: dict[str, float] = Field(default_factory=dict)
    #: The team's own price ($ per GiB-month, every class), or None.
    custom: float | None = None
    customLabel: str = ""
    minimumDays: dict[str, int] = Field(default_factory=lambda: dict(MINIMUM_DAYS))
    source: str = SOURCE
    asOf: str = PRICES_AS_OF
    note: str = ""


class CustomPrice(BaseModel):
    #: $ per GiB-month for every class; None to go back to Google's list price.
    perGiBMonth: float | None = None
    label: str = ""


# --------------------------------------------------------------------------- #
# Prices
# --------------------------------------------------------------------------- #
def _price_file():
    from .gcp import config_dir

    return config_dir() / "storage-price.json"


def _custom() -> CustomPrice:
    try:
        doc = json.loads(_price_file().read_text())
        return CustomPrice(**doc)
    except (OSError, ValueError, TypeError):
        return CustomPrice()


def set_custom(price: CustomPrice) -> Prices:
    if price.perGiBMonth is not None and not 0 <= price.perGiBMonth <= 10:
        raise HTTPException(
            status_code=400, detail="A price per GiB-month between $0 and $10."
        )
    label = " ".join(price.label.split())[:60]
    path = _price_file()
    if price.perGiBMonth is None:
        path.unlink(missing_ok=True)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"perGiBMonth": price.perGiBMonth, "label": label}))
    _bucket_cache.clear()
    return prices()


def _table_for(location: str, location_type: str) -> tuple[str, str]:
    """The price table for a location, and a note when it is a stand-in."""
    loc, kind = location.upper(), location_type.lower()
    if kind == "multi-region" and loc == "US":
        return "us", ""
    if kind == "dual-region" and loc == "NAM4":
        return "nam4", ""
    if loc in PRICED_REGIONS:
        return "us-region", ""
    if not loc:
        return "us-region", (
            "The bucket's location could not be read, so us-central1's prices are used."
        )
    return "us-region", (
        f"Prices for {location} are not in the Workbench's table; us-central1's "
        "are used. Set your own price if they differ."
    )


_bucket_cache: dict[str, tuple[float, derived.BucketInfo]] = {}


def _bucket_info() -> derived.BucketInfo:
    name = derived.bucket_name()
    held = _bucket_cache.get(name)
    if held and time.monotonic() - held[0] < 3600:
        return held[1]
    try:
        info = derived.get_provider().bucket_info()
    except Exception:  # noqa: BLE001 - no bucket reachable: an assumed location
        info = derived.BucketInfo(bucket=name, assumed=True)
    _bucket_cache[name] = (time.monotonic(), info)
    return info


def prices() -> Prices:
    info = _bucket_info()
    table, note = _table_for(info.location, info.locationType)
    # Google quotes hourly rates to make its monthly ones (0.000027397 x 730 is
    # its $0.020): rounded back to those.
    listed = {c: round(HOURLY[table][c] * HOURS_PER_MONTH, 5) for c in CLASSES}
    custom = _custom()
    out = Prices(
        bucket=info.bucket,
        location=info.location,
        locationType=info.locationType,
        defaultClass=info.storageClass or "STANDARD",
        assumed=info.assumed,
        table=table,
        tableLabel=TABLE_LABEL[table],
        listPerGiBMonth=listed,
        note=note,
    )
    if custom.perGiBMonth is not None:
        out.custom = custom.perGiBMonth
        out.customLabel = custom.label or "Our price"
        out.perGiBMonth = {c: custom.perGiBMonth for c in CLASSES}
    else:
        out.perGiBMonth = listed
    return out


def monthly(size_bytes: int, storage_class: str, price: Prices) -> float:
    rate = price.perGiBMonth.get((storage_class or "STANDARD").upper())
    if rate is None:
        rate = price.perGiBMonth.get("STANDARD", 0.0)
    return size_bytes / GIB * rate


# --------------------------------------------------------------------------- #
# A folder's storage
# --------------------------------------------------------------------------- #
class Share(BaseModel):
    name: str
    path: str = ""
    objects: int = 0
    bytes: int = 0
    monthly: float = 0.0


class Summary(BaseModel):
    bucket: str
    prefix: str
    objects: int = 0
    bytes: int = 0
    monthly: float = 0.0
    yearly: float = 0.0
    #: By storage class, and by the folders directly inside this one (a file
    #: here is under its own name).
    byClass: list[Share] = Field(default_factory=list)
    byFolder: list[Share] = Field(default_factory=list)
    #: The largest products: a file with its .aa.json, a Zarr store whole.
    largest: list[Share] = Field(default_factory=list)
    prices: Prices
    truncated: bool = False
    computedAt: str = ""
    seconds: float = 0.0


def _product_of(key: str) -> str:
    """The product an object belongs to: a store's chunk to the store, a
    record (.aa.json) to its product."""
    parts = key.split("/")
    for i, part in enumerate(parts[:-1]):
        if part.lower().endswith(".zarr"):
            return "/".join(parts[: i + 1])
    return key[: -len(".aa.json")] if key.endswith(".aa.json") else key


class _Walk:
    """What a listing found, by class: priced again whenever the price changes."""

    def __init__(self, bucket: str, prefix: str):
        self.bucket, self.prefix = bucket, prefix
        self.objects = 0
        self.truncated = False
        self.at = time.time()
        self.seconds = 0.0
        # name -> class -> [objects, bytes]
        self.by_class: dict[str, dict[str, list[int]]] = {}
        self.by_folder: dict[str, dict[str, list[int]]] = {}
        self.by_product: dict[str, dict[str, list[int]]] = {}

    @staticmethod
    def add(table: dict, name: str, cls: str, size: int) -> None:
        slot = table.setdefault(name, {}).setdefault(cls, [0, 0])
        slot[0] += 1
        slot[1] += size


def _shares(table: dict, price: Prices, path_of) -> list[Share]:
    out = []
    for name, classes in table.items():
        share = Share(name=name, path=path_of(name))
        for cls, (objects, size) in classes.items():
            share.objects += objects
            share.bytes += size
            share.monthly += monthly(size, cls, price)
        out.append(share)
    return sorted(out, key=lambda s: -s.bytes)


def _priced(walk: _Walk, price: Prices, top: int) -> Summary:
    by_class = _shares(walk.by_class, price, lambda name: "")
    total = sum(s.monthly for s in by_class)
    largest = _shares(walk.by_product, price, lambda name: name)[:top]
    for share in largest:
        share.name = share.name.rsplit("/", 1)[-1]
    return Summary(
        bucket=walk.bucket,
        prefix=walk.prefix,
        objects=walk.objects,
        bytes=sum(s.bytes for s in by_class),
        monthly=total,
        yearly=total * 12,
        byClass=by_class,
        byFolder=_shares(walk.by_folder, price, lambda name: walk.prefix + name),
        largest=largest,
        prices=price,
        truncated=walk.truncated,
        computedAt=datetime.fromtimestamp(walk.at, UTC)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        seconds=walk.seconds,
    )


_walks: dict[tuple[str, str], _Walk] = {}
_walk_lock = threading.Lock()


def summary(prefix: str, *, refresh: bool = False, top: int = 15) -> Summary:
    if prefix.startswith("/") or ".." in prefix.split("/"):
        raise HTTPException(status_code=400, detail=f"Bad prefix: {prefix}")
    if prefix and not prefix.endswith("/"):
        prefix += "/"
    bucket = derived.bucket_name()
    if not bucket:
        raise HTTPException(
            status_code=409, detail="Choose a GCP project and bucket first."
        )
    price = prices()
    key = (bucket, prefix)
    with _walk_lock:
        held = _walks.get(key)
    if held and not refresh and time.time() - held.at < SUMMARY_SECONDS:
        return _priced(held, price, top)
    walk = _Walk(bucket, prefix)
    started = time.monotonic()
    try:
        for obj in derived.get_provider().walk(prefix, MAX_OBJECTS + 1):
            if walk.objects >= MAX_OBJECTS:
                walk.truncated = True
                break
            walk.objects += 1
            cls = (obj.storage_class or "STANDARD").upper()
            rest = obj.key[len(prefix) :] if obj.key.startswith(prefix) else obj.key
            head = rest.split("/", 1)[0] + ("/" if "/" in rest else "")
            _Walk.add(walk.by_class, cls, cls, obj.size)
            _Walk.add(walk.by_folder, head, cls, obj.size)
            _Walk.add(walk.by_product, _product_of(obj.key), cls, obj.size)
    except Exception as exc:  # noqa: BLE001 - say why, do not crash the panel
        raise HTTPException(status_code=502, detail=derived._explain(exc)) from exc
    walk.seconds = round(time.monotonic() - started, 2)
    with _walk_lock:
        _walks[key] = walk
        if len(_walks) > 50:
            _walks.pop(next(iter(_walks)))
    return _priced(walk, price, top)


@router.get("/prices", response_model=Prices)
def get_prices() -> Prices:
    return prices()


@router.put("/price", response_model=Prices)
def put_price(price: CustomPrice) -> Prices:
    return set_custom(price)


@router.get("/summary", response_model=Summary)
def get_summary(
    prefix: str = Query(""),
    refresh: bool = Query(False),
    top: int = Query(15, ge=1, le=100),
) -> Summary:
    return summary(prefix, refresh=refresh, top=top)


def _reset_for_tests() -> None:
    _bucket_cache.clear()
    with _walk_lock:
        _walks.clear()
