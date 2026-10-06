"""The Echoview-style services: echograms, lines and regions, calibration,
the dataflow around a product, tables, product options in pipelines.

These run the real aalibrary tools (aa-nc, aa-sv, aa-tiles, aa-annotate,
aa-ecs, aa-integrate) on a small synthetic EK60 file, in the stand-in bucket
the tools use in tests (AA_GCS_FAKE_ROOT). Skipped when the installed
aalibrary does not have them yet.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import zlib
from pathlib import Path

import numpy as np
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

pytest.importorskip("aalibrary.console.aa_tiles")
pytest.importorskip("aalibrary.console.aa_annotate")

from aa_si_workbench.api import (  # noqa: E402
    annotations,
    catalogue,
    echogram,
    gcp,
    jobs,
    pipelines,
    toolcalls,
)
from aa_si_workbench.api.main import create_app  # noqa: E402

BUCKET = "ggn-nmfs-aa-prod-1-data"
FOLDER = f"gs://{BUCKET}/derived_products/jane.doe/SYNTH/S2601/A1/"
FIXTURE = Path(__file__).parent / "fixtures" / "aalibrary_tools.json"


def _tool(env: dict, cwd: Path, name: str, *args: str) -> str:
    module = "aalibrary.console.aa_" + name.replace("-", "_")
    done = subprocess.run(
        [sys.executable, "-m", module, *map(str, args)],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,
        timeout=600,
    )
    assert done.returncode == 0, done.stderr[-2000:]
    return done.stdout.strip().splitlines()[-1]


@pytest.fixture(scope="module")
def survey(tmp_path_factory):
    """An EchoData and its Sv (with depth and position) in a stand-in bucket."""
    from aalibrary.utils.ek60_synth import write_ek60_raw

    root = tmp_path_factory.mktemp("echoview")
    env = dict(os.environ)
    env.update(
        {"AA_GCS_FAKE_ROOT": str(root / "gcs"), "AA_CACHE_DIR": str(root / "cache")}
    )
    env.pop("AA_NAMING", None)
    raw = write_ek60_raw(root / "D20160703-T060000.raw", n_pings=80)
    ed = _tool(env, root, "nc", raw, "--sonar_model", "EK60", "--dest", FOLDER)
    sv = _tool(env, root, "sv", ed, "--dest", FOLDER)
    depth = _tool(env, root, "depth", sv, "--dest", FOLDER)
    located = _tool(env, root, "location", depth, "--echodata", ed, "--dest", FOLDER)
    return {"root": root, "ed": ed, "sv": sv, "located": located, "env": env}


@pytest.fixture(autouse=True)
def bucket(survey, tmp_path, monkeypatch):
    monkeypatch.setenv("AA_GCS_FAKE_ROOT", survey["env"]["AA_GCS_FAKE_ROOT"])
    monkeypatch.setenv("AA_CACHE_DIR", survey["env"]["AA_CACHE_DIR"])
    monkeypatch.setenv("AASI_PRINCIPAL", "jane.doe@noaa.gov")
    monkeypatch.setenv("AASI_RUN_ROOT", str(tmp_path / "runs"))
    monkeypatch.delenv("AA_NAMING", raising=False)
    from aalibrary.console._core import uris

    from aa_si_workbench.api import derived

    monkeypatch.setattr(uris, "_BACKEND", None)
    derived._reset_for_tests(None)
    catalogue._reset_for_tests(json.loads(FIXTURE.read_text()))
    pipelines._reset_for_tests()
    echogram._reset_for_tests()
    annotations._reset_for_tests()
    toolcalls._reset_for_tests()
    jobs._reset_for_tests()
    gcp.choose("ggn-nmfs-aa-prod-1", BUCKET)
    yield
    catalogue._reset_for_tests()
    monkeypatch.setattr(uris, "_BACKEND", None)


def _until(fn, seconds=240):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = fn()
        if value is not None:
            return value
        time.sleep(0.2)
    raise AssertionError("timed out")


def test_new_tools_run_as_modules_until_their_commands_exist(monkeypatch, tmp_path):
    monkeypatch.setattr(jobs, "_bin_dir", lambda: tmp_path)
    monkeypatch.setattr(jobs.shutil, "which", lambda name: None)
    command = jobs.tool_command("aa-tiles")
    assert command[-2:] == ["-m", "aalibrary.console.aa_tiles"]
    with pytest.raises(HTTPException):
        jobs.tool_command("aa-no-such-tool")


def test_echogram_tiles_made_reused_and_served(survey):
    client = TestClient(create_app())
    first = client.post("/api/echogram/open", json={"uri": survey["located"]}).json()
    assert first["state"] in ("making", "ready")

    def ready():
        status = client.get(
            "/api/echogram/status", params={"uri": survey["located"]}
        ).json()
        assert status["state"] != "failed", status
        return status if status["state"] == "ready" else None

    status = _until(ready)
    assert status["tiles"].startswith(FOLDER) and status["tiles"].endswith(".tiles")
    # Opened again: the pack in the bucket is found, nothing is run.
    again = client.post("/api/echogram/open", json={"uri": survey["located"]}).json()
    assert again["state"] == "ready" and not again["callId"]

    manifest = client.get(
        "/api/echogram/manifest", params={"uri": status["tiles"]}
    ).json()
    assert manifest["format"] == "aa-tiles/1" and len(manifest["channels"]) == 2
    # The tile directory stays on the server; a channel's index is its position,
    # which is what the browser asks for a tile by.
    assert [ch["index"] for ch in manifest["channels"]] == [0, 1]
    tile = client.get(
        "/api/echogram/tile",
        params={"uri": status["tiles"], "c": 0, "level": 0, "x": 0, "y": 0},
    )
    assert tile.status_code == 200
    raw = zlib.decompress(tile.content)
    assert len(raw) == manifest["tile"] ** 2 * 2
    axis = client.get(
        "/api/echogram/axis", params={"uri": status["tiles"], "name": "time"}
    )
    times = np.frombuffer(zlib.decompress(axis.content), "<f8")
    assert len(times) == manifest["x"]["count"]
    assert (
        client.get(
            "/api/echogram/tile",
            params={"uri": status["tiles"], "c": 0, "level": 0, "x": 999, "y": 0},
        ).status_code
        == 404
    )
    # A viewer holding an older manifest is told the pack changed, rather
    # than sent bytes from a different layout.
    old = client.get(
        "/api/echogram/tile",
        params={"uri": status["tiles"], "c": 0, "level": 0, "x": 0, "y": 0, "g": "1"},
    )
    assert old.status_code == 409
    same = client.get(
        "/api/echogram/tile",
        params={
            "uri": status["tiles"],
            "c": 0,
            "level": 0,
            "x": 0,
            "y": 0,
            "g": manifest["generation"],
        },
    )
    assert same.status_code == 200
    # A tool call forgotten (many have run since) does not block the product.
    echogram._making[survey["located"]] = "forgotten"
    after = client.get("/api/echogram/status", params={"uri": survey["located"]}).json()
    assert after["state"] == "ready" and survey["located"] not in echogram._making
    bad = client.get("/api/echogram/manifest", params={"uri": survey["sv"]})
    assert bad.status_code == 400
    ed = client.post("/api/echogram/open", json={"uri": survey["ed"]}).json()
    assert ed["state"] == "unsupported" and "Sv" in ed["detail"]


def test_annotations_saved_listed_and_read(survey):
    client = TestClient(create_app())
    times = []
    import xarray as xr
    from aalibrary.console._core import uris

    local = uris.localize(survey["located"]).path
    t = (
        xr.open_dataset(local)
        .ping_time.values.astype("datetime64[ns]")
        .astype(np.int64)
        / 1e6
    )
    times = [float(t[5]), float(t[40]), float(t[70])]
    line = {
        "type": "line",
        "name": "bottom",
        "points": [
            {"t": times[0], "depth": 100, "status": 3},
            {"t": times[2], "depth": 110, "status": 3},
        ],
    }
    saved = client.post(
        "/api/annotations/save", json={"reference": survey["located"], "shapes": line}
    )
    assert saved.status_code == 200, saved.text
    evl = saved.json()
    assert evl["uri"].endswith(".evl") and evl["kind"] == "lines" and evl["productHash"]
    regions = {
        "type": "regions",
        "name": "schools",
        "regions": [
            {
                "id": 1,
                "name": "A",
                "class": "Hake",
                "kind": "analysis",
                "points": [
                    {"t": times[0], "depth": 30},
                    {"t": times[1], "depth": 30},
                    {"t": times[1], "depth": 60},
                ],
            }
        ],
    }
    evr = client.post(
        "/api/annotations/save",
        json={"reference": survey["located"], "shapes": regions},
    ).json()
    listed = client.get("/api/annotations", params={"uri": survey["located"]}).json()
    labels = {(i["kind"], i["label"]) for i in listed["items"]}
    assert ("lines", "bottom") in labels and ("regions", "schools") in labels
    drawn = next(i for i in listed["items"] if i["kind"] == "lines")
    assert drawn["drawnOn"] == survey["located"]
    shapes = client.get("/api/annotations/shapes", params={"uri": evr["uri"]}).json()
    assert shapes["type"] == "regions" and shapes["regions"][0]["class"] == "Hake"
    refused = client.post(
        "/api/annotations/save",
        json={"reference": survey["located"], "shapes": {"type": "line", "points": []}},
    )
    assert refused.status_code == 400

    # A product option: the line goes into aa-integrate through a pipeline plan.
    spec = pipelines.PipelineSpec(
        name="Integrate",
        stages=[
            pipelines.StageSpec(
                tool="aa-integrate", params={"bottom": evl["uri"], "layer": 20}
            )
        ],
    )
    plan = pipelines.plan(pipelines.PlanRequest(pipeline=spec, input=survey["located"]))
    assert not plan.problems, plan.problems
    assert f"--bottom={evl['uri']}" in plan.stages[0].command
    assert any(a.startswith("--echodata=") for a in plan.stages[0].command)
    missing = pipelines.PipelineSpec(
        name="x",
        stages=[
            pipelines.StageSpec(
                tool="aa-integrate", params={"bottom": FOLDER + "nope.evl"}
            )
        ],
    )
    assert any(
        "not in the bucket" in p
        for p in pipelines.plan(
            pipelines.PlanRequest(pipeline=missing, input=survey["located"])
        ).problems
    )
    with pytest.raises(HTTPException):
        pipelines.validate_spec(
            pipelines.PipelineSpec(
                name="x",
                stages=[
                    pipelines.StageSpec(
                        tool="aa-integrate", params={"bottom": "/etc/passwd"}
                    )
                ],
            )
        )

    started = pipelines.start(
        pipelines.PlanRequest(pipeline=spec, input=survey["located"])
    )
    status = _until(
        lambda: (s := pipelines.run_status(started.id)).state != "running" and s or None
    )
    assert status.state == "succeeded", status.error
    csv_uri = status.stages[0].output
    table = client.get("/api/products/table", params={"uri": csv_uri}).json()
    assert "NASC" in table["columns"] and table["rows"]
    # Kept across a restart: the run is read back from the settings folder.
    pipelines._reset_for_tests()
    assert any(r["id"] == started.id for r in client.get("/api/pipelines/runs").json())

    # The dataflow: the Sv's inputs up the chain, the CSV below it.
    graph = client.get("/api/lineage", params={"uri": survey["located"]}).json()
    by_uri = {n["uri"]: n for n in graph["nodes"]}
    assert by_uri[survey["located"]]["relation"] == "self"
    assert by_uri[survey["sv"]]["relation"] == "up"
    assert by_uri[csv_uri]["relation"] == "down" and not by_uri[csv_uri]["stale"]
    # The bottom line saved again (edited): the CSV made with the old one is
    # out of date.
    time.sleep(1.1)
    line["points"][1]["depth"] = 120
    client.post(
        "/api/annotations/save", json={"reference": survey["located"], "shapes": line}
    )
    graph = client.get("/api/lineage", params={"uri": survey["located"]}).json()
    by_uri = {n["uri"]: n for n in graph["nodes"]}
    assert by_uri[csv_uri]["stale"] and "bottom" in by_uri[csv_uri]["staleReason"]


def test_calibration_report_and_ecs(survey):
    client = TestClient(create_app())
    call = client.post(
        "/api/calibration/report", json={"uri": survey["located"]}
    ).json()

    def done(call_id):
        c = client.get(f"/api/toolcalls/{call_id}").json()
        return c if c["state"] != "running" else None

    report = _until(lambda: done(call["id"]))
    assert report["state"] == "succeeded", report["error"]
    channels = report["result"]["channels"]
    assert len(channels) == 2 and report["result"]["source"] == "file"
    values = {
        "channels": [
            {"frequency": channels[0]["frequency"], "values": {"gain_correction": 25.0}}
        ]
    }
    write = client.post(
        "/api/calibration/write",
        json={"uri": survey["ed"], "values": values, "label": "cal"},
    ).json()
    written = _until(lambda: done(write["id"]))
    assert written["state"] == "succeeded", written["error"]
    ecs = written["output"]
    assert ecs.startswith(FOLDER) and ecs.endswith(".ecs")
    files = client.get("/api/calibration/files", params={"uri": survey["ed"]}).json()
    assert any(f["uri"] == ecs for f in files["items"])
    with_ecs = client.post(
        "/api/calibration/report", json={"uri": survey["ed"], "ecs": ecs}
    ).json()
    used = _until(lambda: done(with_ecs["id"]))
    gain = next(
        v
        for v in used["result"]["channels"][0]["values"]
        if v["name"] == "gain_correction"
    )
    assert gain["used"] == pytest.approx(25.0) and gain["changed"]
    bad = client.post(
        "/api/calibration/write", json={"uri": survey["ed"], "values": {"channels": []}}
    )
    assert bad.status_code == 400


def test_kinds_families_tables_and_destinations(survey, monkeypatch):
    from aa_si_workbench.api import lineage, products

    # A region file is regions whichever tool wrote it; the kind a tool
    # publishes with the object wins.
    assert products.kind_of("aa-annotate", "X_schools_1a2b3c4d.evr") == "regions"
    assert products.kind_of("aa-annotate", "X_bottom_1a2b3c4d.evl") == "lines"
    assert products.kind_of("aa-detect-seafloor", "X_1a2b3c4d.nc", "mask") == "mask"

    # "bottom" drawn for one file is not a newer version of "bottom" for another.
    def rec(base, name, uri):
        return lineage._Record(
            uri, {"base": base, "product": {"kind": "lines"}, "extra": {"name": name}}
        )

    a1 = rec("A", "bottom", "gs://b/f/A_bottom_11111111.evl")
    a2 = rec("A", "bottom", "gs://b/f/A_bottom_22222222.evl")
    b1 = rec("B", "bottom", "gs://b/f/B_bottom_33333333.evl")
    assert lineage._family(a1) == lineage._family(a2) != lineage._family(b1)

    # Results: one frequency's rows, NASC per interval over all of them, and a
    # region-cell export summed by PRC_NASC.
    rows = [
        "Interval,Layer,Region_ID,Frequency,NASC,PRC_NASC",
        "1,1,1,38,1000,10",
        "1,2,1,38,500,5",
        "2,1,1,38,100,100",
        "1,1,1,120,7,7",
    ]
    monkeypatch.setattr(
        products, "_read_small", lambda b, k, limit=0: "\n".join(rows).encode()
    )
    t = products.table(f"gs://{BUCKET}/x/cells.csv", limit=1, frequency="38")
    assert t.frequencies == ["38", "120"] and t.frequency == "38"
    assert t.total == 3 and len(t.rows) == 1 and t.truncated
    assert t.nascColumn == "PRC_NASC" and t.perInterval == [(1, 15.0), (2, 100.0)]
    assert products.table(f"gs://{BUCKET}/x/cells.csv").frequency == "38"

    # Files the Workbench writes go to the chosen bucket only.
    assert pipelines.check_own_dest(f"gs://{BUCKET}/a/") == f"gs://{BUCKET}/a/"
    with pytest.raises(HTTPException) as err:
        pipelines.check_own_dest("gs://someone-elses-bucket/a/")
    assert err.value.status_code == 400
