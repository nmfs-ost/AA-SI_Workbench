"""Storage cost estimates: the price table, a folder's totals, the team's own
price. Run on the stand-in bucket (AA_GCS_FAKE_ROOT): nothing reaches GCS."""

from __future__ import annotations

import json

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from aa_si_workbench.api import costs, derived, gcp
from aa_si_workbench.api.main import create_app

BUCKET = "ggn-nmfs-aa-dev-1-data"
GIB = 1024**3


@pytest.fixture
def bucket(tmp_path, monkeypatch):
    root = tmp_path / "gcs"
    monkeypatch.setenv("AA_GCS_FAKE_ROOT", str(root))
    monkeypatch.setenv("AASI_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.delenv("AA_GCS_FAKE_LOCATION", raising=False)
    monkeypatch.delenv("AASI_DERIVED_PREFIX", raising=False)
    derived._reset_for_tests(None)
    costs._reset_for_tests()
    gcp.choose("ggn-nmfs-aa-dev-1", BUCKET)
    base = root / BUCKET

    def put(key: str, size: int, storage_class: str = "") -> None:
        path = base / key
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as fh:
            fh.truncate(size)  # sparse: the size without the bytes
        if storage_class:
            meta = root / ".meta" / BUCKET / (key + ".json")
            meta.parent.mkdir(parents=True, exist_ok=True)
            meta.write_text(json.dumps({"storageClass": storage_class}))

    yield put
    derived._reset_for_tests(None)
    costs._reset_for_tests()


def test_list_prices_and_the_location_they_are_for(bucket, monkeypatch):
    p = costs.prices()
    # The stand-in bucket has no location: us-central1's prices, and it says so.
    assert p.assumed and p.table == "us-region" and "could not be read" in p.note
    assert p.perGiBMonth == {
        "STANDARD": 0.02,
        "NEARLINE": 0.01,
        "COLDLINE": 0.004,
        "ARCHIVE": 0.0012,
    }
    assert costs._table_for("US", "multi-region") == ("us", "")
    assert costs._table_for("NAM4", "dual-region") == ("nam4", "")
    table, note = costs._table_for("EUROPE-WEST4", "region")
    assert table == "us-region" and "not in the Workbench's table" in note
    us = {c: round(costs.HOURLY["us"][c] * 730, 5) for c in costs.CLASSES}
    assert us["STANDARD"] == 0.026 and us["COLDLINE"] == 0.00875
    assert costs.monthly(10 * GIB, "STANDARD", p) == pytest.approx(0.2)
    assert costs.monthly(10 * GIB, "ARCHIVE", p) == pytest.approx(0.012)


def test_a_folders_storage_by_class_folder_and_product(bucket):
    bucket("derived_products/jane/HB1603/HB1603_L1.nc", 3 * GIB)
    bucket("derived_products/jane/HB1603/HB1603_L1.nc.aa.json", 4096)
    bucket("derived_products/jane/HB1603/old_Sv.nc", 2 * GIB, "COLDLINE")
    bucket("derived_products/jane/HB1603/S.zarr/Sv/0.0", GIB // 2)
    bucket("derived_products/jane/HB1603/S.zarr/Sv/0.1", GIB // 2)
    bucket("derived_products/bob/x.csv", GIB)
    s = costs.summary("derived_products/")
    assert s.objects == 6 and s.bytes == 7 * GIB + 4096
    by_class = {c.name: c for c in s.byClass}
    assert by_class["COLDLINE"].bytes == 2 * GIB
    assert s.monthly == pytest.approx((5 * GIB + 4096) / GIB * 0.02 + 2 * 0.004)
    assert s.yearly == pytest.approx(s.monthly * 12)
    folders = {f.name: f for f in s.byFolder}
    assert set(folders) == {"jane/", "bob/"}
    assert folders["jane/"].path == "derived_products/jane/"
    largest = {p.name: p for p in s.largest}
    # A store is one product; a record counts with its product.
    assert largest["S.zarr"].bytes == GIB and largest["S.zarr"].objects == 2
    assert largest["HB1603_L1.nc"].bytes == 3 * GIB + 4096
    # Kept a while, and priced again with the team's own price.
    costs.set_custom(costs.CustomPrice(perGiBMonth=0.01, label="NOAA contract"))
    again = costs.summary("derived_products/")
    assert again.computedAt == s.computedAt
    assert again.monthly == pytest.approx(again.bytes / GIB * 0.01)
    assert again.prices.customLabel == "NOAA contract"
    assert again.prices.listPerGiBMonth["STANDARD"] == 0.02
    costs.set_custom(costs.CustomPrice(perGiBMonth=None))
    assert costs.prices().custom is None
    with pytest.raises(HTTPException):
        costs.summary("../etc/")
    with pytest.raises(HTTPException):
        costs.set_custom(costs.CustomPrice(perGiBMonth=-1))


def test_the_listing_carries_each_objects_class_and_the_api(bucket):
    bucket("derived_products/a/one.nc", 10, "NEARLINE")
    bucket("derived_products/a/two.nc", 10)
    listing = derived.get_provider().list("derived_products/a/", 100)
    assert {e.name: e.storageClass for e in listing.entries} == {
        "one.nc": "NEARLINE",
        "two.nc": "STANDARD",
    }
    client = TestClient(create_app())
    assert client.get("/api/costs/prices").json()["perGiBMonth"]["STANDARD"] == 0.02
    s = client.get("/api/costs/summary", params={"prefix": "derived_products"}).json()
    assert s["prefix"] == "derived_products/" and s["objects"] == 2
    put = client.put("/api/costs/price", json={"perGiBMonth": 0.015, "label": "Ours"})
    assert put.json()["perGiBMonth"]["ARCHIVE"] == 0.015
