"""scripts/clear_store_sidecars.py: the .aa.json files older tools left beside
Zarr stores, deleted only where the store holds its own record.

Stores made by aa-ed itself in the stand-in bucket (AA_GCS_FAKE_ROOT); one
sealed the pre-catch-up-16 way. No network, no GCP.
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import warnings
from pathlib import Path

import pytest

pytest.importorskip("echopype")
zarr = pytest.importorskip("zarr")
uris_mod = pytest.importorskip("aalibrary.console._core.uris")
if not hasattr(uris_mod, "drop_store_sidecar"):
    pytest.skip("aalibrary predates catch-up 19", allow_module_level=True)

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "clear_store_sidecars.py"
BUCKET = "bkt"
FOLDER = "derived_products/jane.doe/Henry_B_Bigelow/HB1603/EK60"


@pytest.fixture
def clear(tmp_path, monkeypatch):
    monkeypatch.setenv("AA_GCS_FAKE_ROOT", str(tmp_path / "gcs"))
    monkeypatch.setenv("AA_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.delenv("AA_GCS_MOUNTS", raising=False)
    warnings.simplefilter("ignore")
    from aalibrary.console._core import uris

    uris._BACKEND = None
    uris.install_fake_fsspec()
    spec = importlib.util.spec_from_file_location("clear_store_sidecars", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    yield module
    uris._BACKEND = None


def _aa_ed(tmp_path: Path, raw: Path, uri: str) -> None:
    env = dict(
        os.environ,
        AA_GCS_FAKE_ROOT=str(tmp_path / "gcs"),
        AA_CACHE_DIR=str(tmp_path / "cache"),
    )
    env.pop("AA_GCS_MOUNTS", None)
    done = subprocess.run(
        [
            sys.executable,
            "-m",
            "aalibrary.console.aa_ed",
            str(raw),
            "-o",
            uri,
            "--sonar_model",
            "EK60",
        ],
        env=env,
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,
        timeout=600,
    )
    assert done.returncode == 0, done.stderr[-2000:]


def _put(tmp_path: Path, key: str, data: dict) -> Path:
    from aalibrary.console._core import uris

    source = tmp_path / "upload.tmp"
    source.write_text(json.dumps(data))
    uris.backend().upload(source, BUCKET, key, {})
    return tmp_path / "gcs" / BUCKET / key


@pytest.fixture
def bucket(clear, tmp_path):
    from aalibrary.console._core import provenance
    from aalibrary.utils.ek60_synth import write_ek60_raw

    raws = []
    for i in range(2):
        raw = tmp_path / f"D20160703-T06{i}000.raw"
        write_ek60_raw(raw, n_pings=10, start=f"2016-07-03T06:{i}0:00", seed=i)
        raws.append(raw)
    same = f"gs://{BUCKET}/{FOLDER}/same.zarr"
    stale = f"gs://{BUCKET}/{FOLDER}/stale.zarr"
    _aa_ed(tmp_path, raws[0], same)
    _aa_ed(tmp_path, raws[1], stale)
    doc, status = provenance.inspect_store(same)
    assert status == "embedded"
    sides = {
        # the copy older tools wrote: the same record
        "same": _put(tmp_path, f"{FOLDER}/same.zarr.aa.json", doc),
        # left from the store that was there before this one
        "stale": _put(
            tmp_path,
            f"{FOLDER}/stale.zarr.aa.json",
            {"schema": provenance.SCHEMA, "product": {"hash": "0" * 64}},
        ),
        # beside a folder that isn't a store with a record of its own
        "foreign": _put(tmp_path, f"{FOLDER}/foreign.zarr.aa.json", {"base": "X"}),
        # its store is gone
        "alone": _put(tmp_path, f"{FOLDER}/gone.zarr.aa.json", {"base": "Y"}),
    }
    foreign = tmp_path / "gcs" / BUCKET / FOLDER / "foreign.zarr"
    group = zarr.open_group(str(foreign), mode="w")
    group.attrs["note"] = "written by someone else"
    # An aa store as it was before catch-up 16 (reseal_stores.py still wants it,
    # and checks it against the copy beside it).
    old = tmp_path / "gcs" / BUCKET / FOLDER / "old.zarr"
    shutil.copytree(tmp_path / "gcs" / BUCKET / FOLDER / "same.zarr", old)
    record = dict(doc, product=dict(doc["product"], hash="a" * 64, name="old.zarr"))
    group = zarr.open_group(str(old), mode="r+", use_consolidated=False)
    group.attrs["aa_provenance"] = record
    group.attrs["aa_product_hash"] = "a" * 64
    group.create_group("aa_seal").attrs["product_hash"] = "a" * 64
    del group["Provenance"].attrs[provenance.SEAL_ECHODATA_ATTR]
    zarr.consolidate_metadata(str(old))
    sides["old"] = _put(tmp_path, f"{FOLDER}/old.zarr.aa.json", record)
    return sides


def test_a_dry_run_deletes_nothing(clear, bucket, capsys):
    assert clear.main([f"gs://{BUCKET}/derived_products/"]) == 0
    out = capsys.readouterr().out
    assert all(side.exists() for side in bucket.values())
    assert (
        f"would   delete gs://{BUCKET}/{FOLDER}/same.zarr.aa.json (the same record)"
        in out
    )
    assert f"would   delete gs://{BUCKET}/{FOLDER}/stale.zarr.aa.json (stale)" in out
    assert "Nothing changed. Add --apply" in out


def test_apply_deletes_only_copies_of_a_record_the_store_holds(clear, bucket, capsys):
    assert clear.main([f"gs://{BUCKET}/derived_products/", "--apply"]) == 0
    out = capsys.readouterr().out
    assert not bucket["same"].exists() and not bucket["stale"].exists()
    assert (
        bucket["foreign"].exists()
        and bucket["alone"].exists()
        and bucket["old"].exists()
    )
    assert "old.zarr.aa.json: the store still needs reseal_stores.py" in out
    assert "foreign.zarr.aa.json: the store has no record of its own" in out
    assert "gone.zarr.aa.json: no store beside it" in out
    assert "2 deleted." in out
    # The stores themselves are untouched.
    from aalibrary.console._core import provenance

    assert (
        provenance.inspect_store(f"gs://{BUCKET}/{FOLDER}/same.zarr")[1] == "embedded"
    )


def test_one_store(clear, bucket, capsys):
    assert clear.main([f"gs://{BUCKET}/{FOLDER}/same.zarr", "--apply"]) == 0
    assert not bucket["same"].exists() and bucket["stale"].exists()
