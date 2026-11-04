"""scripts/reseal_stores.py: stores sealed before catch-up 16, brought up to date.

An EchoData and an Sv store written the way the console tools wrote them
before (an aa_seal group with the hash only, the record as a JSON object), in
the stand-in bucket (AA_GCS_FAKE_ROOT). No network, no GCP.
"""

from __future__ import annotations

import importlib.util
import json
import warnings
from pathlib import Path

import pytest

ep = pytest.importorskip("echopype")
zarr = pytest.importorskip("zarr")
pytest.importorskip("aalibrary.console._core.provenance")

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "reseal_stores.py"
BUCKET = "bkt"
FOLDER = "derived_products/jane.doe/Henry_B._Bigelow/HB1603"


@pytest.fixture
def reseal(tmp_path, monkeypatch):
    monkeypatch.setenv("AA_GCS_FAKE_ROOT", str(tmp_path / "gcs"))
    monkeypatch.setenv("AA_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.delenv("AA_GCS_MOUNTS", raising=False)
    warnings.simplefilter("ignore")
    from aalibrary.console._core import uris

    uris._BACKEND = None
    uris.install_fake_fsspec()
    spec = importlib.util.spec_from_file_location("reseal_stores", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    yield module
    uris._BACKEND = None


def _record(name: str, kind: str, product: str) -> dict:
    return {
        "schema": "aa-provenance/1",
        "base": "D20160703-T060000",
        "product": {
            "hash": product,
            "short": product[:8],
            "kind": kind,
            "role": "echodata" if kind == "echodata" else "transform",
            "name": name,
            "variant": None,
        },
        "inputs": [],
        "sources": [{"id": "md5:00:1", "name": "D20160703-T060000.raw"}],
        "pipeline": [{"tool": "aa-ed" if kind == "echodata" else "aa-sv"}],
    }


def _sealed_before(
    path: Path, record: dict, tmp_path: Path, sidecar: bool = True
) -> str:
    """Seal a written store the old way, and stamp its root object's hash
    as publishing did. Returns its URI."""
    from aalibrary.console._core import uris

    group = zarr.open_group(str(path), mode="r+")
    group.attrs["aa_provenance"] = record
    group.attrs["aa_product_hash"] = record["product"]["hash"]
    group.create_group("aa_seal").attrs["product_hash"] = record["product"]["hash"]
    zarr.consolidate_metadata(str(path))
    key = str(path.relative_to(tmp_path / "gcs" / BUCKET))
    meta = {
        uris.META_HASH: record["product"]["hash"],
        "aa-kind": record["product"]["kind"],
    }
    _upload(path / "zarr.json", f"{key}/zarr.json", meta, tmp_path)
    if sidecar:
        side = tmp_path / "side.json"
        side.write_text(json.dumps(record))
        _upload(side, f"{key}.aa.json", {}, tmp_path)
    return f"gs://{BUCKET}/{key}"


def _upload(path: Path, key: str, meta: dict, tmp_path: Path) -> None:
    """Put the stand-in object at key again (a new generation), with metadata."""
    import shutil

    from aalibrary.console._core import uris

    source = tmp_path / "upload.tmp"
    shutil.copyfile(path, source)
    uris.backend().upload(source, BUCKET, key, meta)


@pytest.fixture
def old(reseal, tmp_path):
    import xarray as xr
    from aalibrary.console._core import zarr_io
    from aalibrary.utils.ek60_synth import write_ek60_raw

    raw = tmp_path / "D20160703-T060000.raw"
    write_ek60_raw(raw, n_pings=20, start="2016-07-03T06:00:00", seed=1)
    ed = ep.open_raw(str(raw), sonar_model="EK60")
    folder = tmp_path / "gcs" / BUCKET / FOLDER / "EK60"
    zarr_io.write_echodata(ed, str(folder / "D20160703-T060000.zarr"))
    sv = ep.calibrate.compute_Sv(ed)
    sv.to_zarr(folder / "D20160703-T060000_401d977d.zarr")
    ed_uri = _sealed_before(
        folder / "D20160703-T060000.zarr",
        _record("D20160703-T060000.zarr", "echodata", "a" * 64),
        tmp_path,
    )
    sv_uri = _sealed_before(
        folder / "D20160703-T060000_401d977d.zarr",
        _record("D20160703-T060000_401d977d.zarr", "sv", "b" * 64),
        tmp_path,
    )
    # A copy of the EchoData whose record is not its own (another product's seal).
    copy = folder / "theirs.zarr"
    zarr_io.write_echodata(ed, str(copy))
    copy_uri = _sealed_before(
        copy, _record("theirs.zarr", "echodata", "c" * 64), tmp_path
    )
    group = zarr.open_group(str(copy), mode="r+")
    group["aa_seal"].attrs["product_hash"] = "d" * 64
    # A DataTree subset of the Sv saved under another name: the old seal and
    # the record ride along, so only the name gives it away.
    tree = xr.open_datatree(folder / "D20160703-T060000_401d977d.zarr", engine="zarr")
    subset = folder / "mine_subset.zarr"
    tree.isel(ping_time=slice(0, 5)).to_zarr(subset)
    # The same, saved under the original's name in another folder, with no
    # .aa.json beside it.
    elsewhere = (
        tmp_path
        / "gcs"
        / BUCKET
        / FOLDER
        / "copies"
        / "D20160703-T060000_401d977d.zarr"
    )
    tree.isel(ping_time=slice(0, 5)).to_zarr(elsewhere)
    return {
        "echodata": ed_uri,
        "sv": sv_uri,
        "copy": copy_uri,
        "folder": folder,
        "subset": f"gs://{BUCKET}/{FOLDER}/EK60/mine_subset.zarr",
        "elsewhere": f"gs://{BUCKET}/{FOLDER}/copies/D20160703-T060000_401d977d.zarr",
    }


def _local(tmp_path: Path, uri: str) -> Path:
    return tmp_path / "gcs" / uri[len("gs://") :]


def _snapshot(root: Path) -> dict:
    return {str(p): p.read_bytes() for p in root.rglob("*") if p.is_file()}


def test_a_dry_run_changes_nothing(reseal, old, tmp_path, capsys):
    before = _snapshot(tmp_path / "gcs")
    assert reseal.main([f"gs://{BUCKET}/derived_products/jane.doe/"]) == 0
    out = capsys.readouterr().out
    assert "2 to bring up to date" in out and "3 left alone" in out
    # The renamed subset and the other product's seal: refused by the seal itself
    # (an old seal on a store its record doesn't name); the copy under the same
    # name elsewhere: by the missing .aa.json beside it.
    assert out.count("its record is not its own (copied)") == 2
    assert "copies/D20160703-T060000_401d977d.zarr: no .aa.json record beside it" in out
    assert "Add --apply" in out
    assert _snapshot(tmp_path / "gcs") == before


def test_apply_brings_them_up_to_date_and_leaves_a_copy_alone(
    reseal, old, tmp_path, capsys
):
    from aalibrary.console._core import provenance, uris

    copy_before = _snapshot(_local(tmp_path, old["copy"]))
    copies_before = [
        _snapshot(_local(tmp_path, old[k])) for k in ("subset", "elsewhere")
    ]
    assert reseal.main([f"gs://{BUCKET}/derived_products/jane.doe/", "--apply"]) == 0
    out = capsys.readouterr().out
    assert "2 brought up to date, 0 failed" in out

    ed_path = _local(tmp_path, old["echodata"])
    group = zarr.open_group(str(ed_path), mode="r")
    assert "aa_seal" not in group and not (ed_path / "aa_seal" / "zarr.json").exists()
    seal = json.loads(group["Provenance"].attrs["aa_seal"])
    assert seal["product_hash"] == "a" * 64
    assert seal["shape"] == provenance.shape_print(provenance.group_shapes(group))
    echodata = ep.open_converted(str(ed_path))
    assert (
        "EchoData" in repr(echodata) and echodata._repr_html_()
    )  # no KeyError: 'aa_seal'

    sv_path = _local(tmp_path, old["sv"])
    assert (
        zarr.open_group(str(sv_path), mode="r")["aa_seal"]
        .attrs["shape"]
        .startswith("s1:")
    )
    for uri in (old["echodata"], old["sv"]):
        doc, status = provenance.inspect_store(uri)
        assert status == "embedded"
        root = json.loads((_local(tmp_path, uri) / "zarr.json").read_text())[
            "attributes"
        ]
        assert isinstance(root["aa_provenance"], str)
        # The root object's hash, which reuse looks for, is still there.
        assert (
            uris.stat(uri + "/zarr.json").metadata[uris.META_HASH]
            == doc["product"]["hash"]
        )
    assert _snapshot(_local(tmp_path, old["copy"])) == copy_before
    assert [
        _snapshot(_local(tmp_path, old[k])) for k in ("subset", "elsewhere")
    ] == copies_before

    assert reseal.main([f"gs://{BUCKET}/derived_products/jane.doe/", "--apply"]) == 0
    assert "0 to bring up to date, 2 already up to date" in capsys.readouterr().out


def test_an_object_changed_meanwhile_is_left_as_it_is(reseal, old, tmp_path):
    from aalibrary.console._core import uris

    objects = reseal.Objects()
    bucket, key = uris.parse_gcs(old["sv"])
    step = reseal.plan(objects, bucket, key, {"zarr.json", "aa_seal/zarr.json"})
    # Someone else rewrites the root between the look and the write.
    root = _local(tmp_path, old["sv"]) / "zarr.json"
    _upload(root, f"{key}/zarr.json", {uris.META_HASH: "b" * 64}, tmp_path)
    problem = reseal.apply(objects, bucket, key, step)
    assert problem and "changed while this ran" in problem


def test_one_store_s_error_does_not_stop_the_rest(
    reseal, old, tmp_path, monkeypatch, capsys
):
    real_put = reseal.Objects.put
    calls = {"n": 0}

    def flaky(self, bucket, key, data, current):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("503 Service Unavailable")
        return real_put(self, bucket, key, data, current)

    monkeypatch.setattr(reseal.Objects, "put", flaky)
    assert reseal.main([f"gs://{BUCKET}/derived_products/jane.doe/", "--apply"]) == 1
    out = capsys.readouterr().out
    assert "FAILED" in out and "1 brought up to date, 1 failed" in out
    monkeypatch.setattr(reseal.Objects, "put", real_put)
    assert reseal.main([f"gs://{BUCKET}/derived_products/jane.doe/", "--apply"]) == 0
    assert "1 brought up to date, 0 failed" in capsys.readouterr().out


def test_one_store_named_is_the_only_one_done(reseal, old, tmp_path, capsys):
    import shutil

    store = _local(tmp_path, old["sv"])
    shutil.copytree(store, store.with_name(store.name + "_v2.zarr"))
    assert reseal.main([old["sv"]]) == 0
    out = capsys.readouterr().out
    assert "1 store(s) found" in out and "_v2.zarr" not in out
