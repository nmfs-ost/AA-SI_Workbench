"""The baseline runner, end to end, against stand-in console tools.

The stand-ins are small scripts that do what each tool does to the file
system and print what each tool prints, so the chaining (each stage consuming
the path the previous one printed), the fetch check, the scratch lifecycle and
the failure paths are exercised for real through the job runner.
"""

from __future__ import annotations

import stat
import sys
import textwrap
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aa_si_workbench.api import baseline, jobs
from aa_si_workbench.api.main import create_app

FILES = ["D20160703-T055210.raw", "D20160703-T061500.raw", "D20160703-T063800.raw"]

TOOLS = {
    "aa-request": """
        out = args[args.index("-o") + 1]
        Path(out).write_text("requests: []\\n")
        print(out)
    """,
    "aa-fetch": """
        root = Path(args[args.index("-o") + 1]); name = args[args.index("-n") + 1]
        folder = root / name; folder.mkdir(parents=True, exist_ok=True)
        for f in os.environ.get("FAKE_FILES", "").split(","):
            if f: (folder / f).write_bytes(b"raw")
        print(folder)
    """,
    "aa-ed": """
        target = Path(args[0])
        if target.is_file():                       # one file, -o straight to the bucket
            assert target.suffix == ".raw", target
            print(args[args.index("-o") + 1]); sys.exit(0)
        for raw in target.glob("*.raw"):
            raw.with_suffix(".nc").write_bytes(b"nc")
        print(target)
    """,
    "aa-combine": """
        if os.environ.get("FAKE_COMBINE_FAIL"):
            print("QC: transit gap between files", file=sys.stderr); sys.exit(4)
        print(args[args.index("-o") + 1])
    """,
    "aa-sv": """
        dest = args[args.index("--dest") + 1]
        base = args[0].rsplit("/", 1)[-1].rsplit(".", 1)[0]
        print(f"{dest}{base}_1a2b3c4d.nc")
    """,
    "aa-graph": """
        dest = args[args.index("--dest") + 1]
        print(dest + args[0].rsplit("/", 1)[-1].replace(".nc", ".png"))
    """,
    "aa-upload": """
        print(args[1] + Path(args[0]).name)
    """,
    "aa-metadata": """
        print('{"schema": "aa-provenance/1", "product": {"hash": "x"}}')
        print("  verify    hash verified", file=sys.stderr)
    """,
}


@pytest.fixture()
def tools(tmp_path, monkeypatch):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, body in TOOLS.items():
        script = bin_dir / name
        script.write_text(
            f"#!{sys.executable}\nimport os, sys\nfrom pathlib import Path\n"
            f"args = sys.argv[1:]\n{textwrap.dedent(body)}"
        )
        script.chmod(script.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setattr(jobs, "_bin_dir", lambda: bin_dir)
    monkeypatch.setenv("AASI_RUN_ROOT", str(tmp_path / "runs"))
    monkeypatch.setenv("AASI_BASELINE_BUCKET", "bkt")
    monkeypatch.setenv("AASI_PRINCIPAL", "jane.doe@noaa.gov")
    monkeypatch.setenv("FAKE_FILES", ",".join(FILES))
    monkeypatch.setattr(baseline, "POLL_SECONDS", 0.05)
    jobs._reset_for_tests()
    baseline._reset_for_tests()
    from aa_si_workbench.api import identity

    if hasattr(identity, "_cache_clear"):
        identity._cache_clear()
    return bin_dir


REQUEST = {
    "vessel": "Henry_B._Bigelow",
    "survey": "HB1603",
    "sonar": "EK60",
    "start": "2016-07-03T06:00:00Z",
    "end": "2016-07-03T06:45:00Z",
    "fetchFrom": "2016-07-03T05:52:10",
    "fetchTo": "2016-07-03T06:38:00",
    "expectedFiles": FILES,
}


def _wait(client: TestClient, run_id: str, timeout: float = 30) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = client.get(f"/api/baseline/runs/{run_id}").json()
        if run["state"] != "running":
            return run
        time.sleep(0.1)
    raise AssertionError("run did not finish")


def test_config_reports_tools_user_and_bucket(tools):
    client = TestClient(create_app())
    config = client.get("/api/baseline/config").json()
    assert config["ready"] and config["bucket"] == "bkt"
    assert config["user"] == "jane.doe"
    assert {t["name"] for t in config["tools"]} >= {"aa-combine", "aa-metadata"}


def test_config_names_an_old_aalibrary(tools):
    (tools / "aa-metadata").unlink()
    config = TestClient(create_app()).get("/api/baseline/config").json()
    assert not config["ready"]
    assert "provenance-aware" in config["problems"][0]


def test_preview_names_the_asset_and_every_command(tools):
    preview = (
        TestClient(create_app()).post("/api/baseline/preview", json=REQUEST).json()
    )
    base = "HB1603_EK60_20160703T060000-20160703T064500"
    assert preview["base"] == base
    assert preview["destination"] == (
        f"gs://bkt/derived_products/jane.doe/Henry_B._Bigelow/HB1603/{base}/"
    )
    tools_run = [s["tool"] for s in preview["stages"]]
    assert tools_run == [
        "aa-request",
        "aa-fetch",
        "aa-ed",
        "aa-combine",
        "aa-sv",
        "aa-graph",
        "aa-upload",
    ]
    combine = next(s for s in preview["stages"] if s["id"] == "combine")["command"]
    assert combine[combine.index("-o") + 1] == preview["destination"] + base + ".nc"
    request = preview["stages"][0]["command"]
    assert request[request.index("--from") + 1] == "2016-07-03T05:52:10"


def test_full_run_chains_outputs_and_cleans_scratch(tools):
    client = TestClient(create_app())
    run = client.post("/api/baseline/runs", json=REQUEST).json()
    run = _wait(client, run["id"])
    assert run["state"] == "succeeded", run["error"]
    assert [s["state"] for s in run["stages"]] == ["done"] * 7
    dest = run["destination"]
    kinds = {a["kind"]: a["uri"] for a in run["assets"]}
    assert kinds["echodata"] == f"{dest}{run['base']}.nc"
    assert kinds["sv"] == f"{dest}{run['base']}_1a2b3c4d.nc"
    assert kinds["echogram"] == f"{dest}{run['base']}_1a2b3c4d.png"
    assert kinds["request"] == f"{dest}{run['base']}.yaml"
    assert not Path(run["scratch"]).exists()  # scratch removed on success
    fetch = next(s for s in run["stages"] if s["id"] == "fetch")
    assert "as planned" in fetch["detail"]
    # Every stage was an ordinary job, visible in the queue.
    assert len(client.get("/api/jobs").json()["jobs"]) == 7


def test_products_can_be_left_out(tools):
    client = TestClient(create_app())
    run = client.post("/api/baseline/runs", json=REQUEST | {"sv": False}).json()
    run = _wait(client, run["id"])
    states = {s["id"]: s["state"] for s in run["stages"]}
    assert states["sv"] == states["echogram"] == "skipped"
    assert run["state"] == "succeeded"


def test_missing_files_stop_the_run_and_keep_scratch(tools, monkeypatch):
    monkeypatch.setenv("FAKE_FILES", FILES[0])
    client = TestClient(create_app())
    run = _wait(client, client.post("/api/baseline/runs", json=REQUEST).json()["id"])
    assert run["state"] == "failed"
    assert "1 of the 3 files" in run["error"] and FILES[1] in run["error"]
    states = {s["id"]: s["state"] for s in run["stages"]}
    assert states["fetch"] == "failed" and states["convert"] == "pending"
    assert Path(run["scratch"]).exists()  # kept as evidence


def test_a_qc_finding_stops_the_run_with_the_tools_words(tools, monkeypatch):
    monkeypatch.setenv("FAKE_COMBINE_FAIL", "1")
    client = TestClient(create_app())
    run = _wait(client, client.post("/api/baseline/runs", json=REQUEST).json()["id"])
    assert run["state"] == "failed"
    assert "Combine" in run["error"] and "transit gap" in run["error"]


def test_keep_local_keeps_scratch(tools):
    client = TestClient(create_app())
    run = _wait(
        client,
        client.post("/api/baseline/runs", json=REQUEST | {"keepLocal": True}).json()[
            "id"
        ],
    )
    assert run["state"] == "succeeded"
    assert (Path(run["scratch"]) / "raw" / FILES[0]).exists()


def test_bad_range_and_base_are_refused(tools):
    client = TestClient(create_app())
    bad = REQUEST | {"end": "2016-07-03T05:00:00"}
    assert client.post("/api/baseline/preview", json=bad).status_code == 400
    assert (
        client.post(
            "/api/baseline/preview", json=REQUEST | {"base": "../x"}
        ).status_code
        == 400
    )


def test_jobs_only_accept_aa_settings(tools):
    client = TestClient(create_app())
    response = client.post(
        "/api/jobs", json={"tool": "aa-sv", "args": [], "env": {"LD_PRELOAD": "x"}}
    )
    assert response.status_code == 400


def test_provenance_reads_aa_metadata(tools):
    got = (
        TestClient(create_app())
        .get("/api/baseline/provenance", params={"uri": "gs://bkt/x.nc"})
        .json()
    )
    assert got["found"] and got["verified"] is True


def test_one_file_is_converted_straight_to_the_asset(tools, monkeypatch):
    monkeypatch.setenv("FAKE_FILES", FILES[0])
    client = TestClient(create_app())
    one = REQUEST | {"expectedFiles": FILES[:1], "format": "zarr"}
    preview = client.post("/api/baseline/preview", json=one).json()
    assert "combine" not in [s["id"] for s in preview["stages"]]
    convert = next(s for s in preview["stages"] if s["id"] == "convert")["command"]
    assert convert[1].endswith(FILES[0])
    assert (
        convert[convert.index("-o") + 1]
        == preview["destination"] + preview["base"] + ".nc"
    )
    assert [a["kind"] for a in preview["assets"]][:2] == ["echodata", "sv"]
    run = _wait(client, client.post("/api/baseline/runs", json=one).json()["id"])
    assert run["state"] == "succeeded", run["error"]
    states = {s["id"]: s["state"] for s in run["stages"]}
    assert states["combine"] == "skipped" and states["sv"] == "done"
    kinds = {a["kind"]: a["uri"] for a in run["assets"]}
    assert kinds["echodata"].endswith(run["base"] + ".nc") and "report" not in kinds


def test_files_outside_the_range_are_set_aside(tools, monkeypatch):
    monkeypatch.setenv("FAKE_FILES", ",".join([*FILES, "D20160703-T070100.raw"]))
    client = TestClient(create_app())
    run = _wait(
        client,
        client.post("/api/baseline/runs", json=REQUEST | {"keepLocal": True}).json()[
            "id"
        ],
    )
    assert run["state"] == "succeeded", run["error"]
    scratch = Path(run["scratch"])
    assert (scratch / "outside-range" / "D20160703-T070100.raw").exists()
    assert sorted(p.name for p in (scratch / "raw").glob("*.raw")) == FILES
    assert any("set aside" in note for note in run["notes"])


def test_request_window_is_never_empty_or_a_whole_day():
    one = baseline.BaselineRequest(
        **(
            REQUEST
            | {"fetchFrom": "2016-07-03T06:00:00", "fetchTo": "2016-07-03T06:00:00"}
        )
    )
    assert baseline.request_window(one) == (
        "2016-07-03T06:00:00",
        "2016-07-03T06:00:01",
    )
    midnight = baseline.BaselineRequest(
        **(REQUEST | {"fetchTo": "2016-07-04T00:00:00"})
    )
    assert baseline.request_window(midnight)[1] == "2016-07-04T00:00:01"
    plain = baseline.BaselineRequest(**REQUEST)
    assert baseline.request_window(plain) == (
        "2016-07-03T05:52:10",
        "2016-07-03T06:38:00",
    )


def test_image_serves_a_bucket_png_and_nothing_else(tools, tmp_path, monkeypatch):
    pytest.importorskip("aalibrary.console._core.uris")
    from aalibrary.console._core import uris

    monkeypatch.setenv("AA_GCS_FAKE_ROOT", str(tmp_path / "gcs"))
    monkeypatch.setenv("AA_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setattr(uris, "_BACKEND", None)
    png = tmp_path / "e.png"
    png.write_bytes(b"\x89PNG\r\n\x1a\nfake")
    uris.backend().upload(png, "bkt", "d/e.png", None)
    client = TestClient(create_app())
    got = client.get("/api/baseline/image", params={"uri": "gs://bkt/d/e.png"})
    assert got.status_code == 200 and got.content.startswith(b"\x89PNG")
    assert got.headers["content-type"] == "image/png"
    assert (
        client.get("/api/baseline/image", params={"uri": "/etc/passwd"}).status_code
        == 400
    )
    assert (
        client.get(
            "/api/baseline/image", params={"uri": "gs://bkt/d/x.png"}
        ).status_code
        == 404
    )
    monkeypatch.setattr(uris, "_BACKEND", None)


def test_ek80_calibration_gets_its_modes_and_ek60_does_not(tools):
    client = TestClient(create_app())
    ek80 = client.post(
        "/api/baseline/preview", json=REQUEST | {"sonar": "EK80", "encodeMode": "power"}
    ).json()
    sv = next(s for s in ek80["stages"] if s["id"] == "sv")["command"]
    assert sv[-4:] == ["--waveform_mode", "CW", "--encode_mode", "power"]
    ek60 = client.post("/api/baseline/preview", json=REQUEST).json()
    sv = next(s for s in ek60["stages"] if s["id"] == "sv")["command"]
    assert "--waveform_mode" not in sv


def test_a_runner_failure_ends_the_run_instead_of_hanging_it(tools, monkeypatch):
    def boom(_request):
        raise RuntimeError("disk full")

    monkeypatch.setattr(jobs, "submit", boom)
    client = TestClient(create_app())
    run = _wait(client, client.post("/api/baseline/runs", json=REQUEST).json()["id"])
    assert run["state"] == "failed" and "disk full" in run["error"]


def test_requests_that_cannot_run_are_refused_up_front(tools):
    client = TestClient(create_app())
    for bad in (
        {"base": "two words"},
        {"base": "mine", "fetchFrom": "not-a-time"},
        {"prefix": "{nope}/"},
        {"bucket": "Bad_Bucket!"},
    ):
        assert (
            client.post("/api/baseline/runs", json=REQUEST | bad).status_code == 400
        ), bad
    assert client.get("/api/baseline/runs").json() == []


def test_a_nul_byte_cannot_wedge_the_job_queue(tools):
    client = TestClient(create_app())
    bad = client.post(
        "/api/jobs", json={"tool": "aa-sv", "args": [], "env": {"AA_X": "a\u0000b"}}
    )
    assert bad.status_code == 400
    assert (
        client.post(
            "/api/jobs", json={"tool": "aa-sv", "args": ["a\u0000"]}
        ).status_code
        == 400
    )
