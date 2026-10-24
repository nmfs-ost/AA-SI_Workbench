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
        if "--dest" in args:                       # several files, one at a time
            assert args[args.index("--format") + 1] == "zarr", args
            dest = args[args.index("--dest") + 1]
            for raw in args[:args.index("--dest")]:
                if os.environ.get("FAKE_ED_REUSE"):
                    store = dest + Path(raw).stem + ".zarr"
                    print(f"aa-ed: reusing {store}", file=sys.stderr)
                if os.environ.get("FAKE_ED_SHORT") and raw.endswith(FILES_LAST):
                    continue
                print(dest + Path(raw).stem + ".zarr", flush=True)
            sys.exit(0)
        target = Path(args[0])
        if target.is_file() or "-o" in args:       # one file, -o straight to the bucket
            assert target.suffix == ".raw", target
            print(args[args.index("-o") + 1]); sys.exit(0)
        for raw in target.glob("*.raw"):
            raw.with_suffix(".nc").write_bytes(b"nc")
        print(target)
    """,
    "aa-combine": """
        if os.environ.get("FAKE_COMBINE_FAIL"):
            print("QC: transit gap between files", file=sys.stderr); sys.exit(4)
        if "-o" not in args:                       # file by file: Sv joined
            inputs = args[:args.index("--dest")]
            assert inputs and all(s.startswith("gs://") and s.endswith("_1a2b3c4d.zarr")
                                  for s in inputs), inputs
            assert "--no-report" in args
            dest = args[args.index("--dest") + 1]
            print(dest + args[args.index("--base") + 1] + "_5e6f7a8b.zarr"); sys.exit(0)
        target = args[args.index("-o") + 1]
        if "--workdir" not in args:                # file by file: the stores themselves
            stores = args[:args.index("-o")]
            assert stores and all(s.startswith("gs://") and s.endswith(".zarr")
                                  for s in stores), stores
            assert target.endswith(".zarr"), target
            print(target); sys.exit(0)
        workdir = Path(args[args.index("--workdir") + 1])
        if os.environ.get("FAKE_CHECK_FREED"):
            assert not list(workdir.glob("*.raw")), "raw files outlived the conversion"
            assert list(workdir.glob("*.nc")), "per-file EchoData freed too early"
        # As the real tools do: what is uploaded stays in the tools' cache.
        cached = Path(os.environ["AA_CACHE_DIR"]) / "gcs" / target.split("/", 2)[2]
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_bytes(b"combined" * 1000)
        print(target)
    """,
    "aa-sv": """
        dest = args[args.index("--dest") + 1]
        fmt = args[args.index("--format") + 1] if "--format" in args else "nc"
        ext = "." + fmt
        inputs = [a for a in args[:args.index("--dest")]
                  if a.startswith(("gs://", "/"))]
        if len(inputs) > 1:                        # several files, one at a time
            assert ext == ".zarr" and "--progress" in args, args
            for store in inputs:
                stem = store.rsplit("/", 1)[-1].rsplit(".", 1)[0]
                if os.environ.get("FAKE_SV_SHORT") and stem + ".raw" == FILES_LAST:
                    continue
                print(f"{dest}{stem}_1a2b3c4d.zarr", flush=True)
            sys.exit(0)
        name = args[0].rsplit("/", 1)[-1]
        base = name.rsplit(".", 1)[0]
        if os.environ.get("FAKE_CHECK_FREED"):
            cache = Path(os.environ["AA_CACHE_DIR"])
            assert not list(Path("raw").glob("*.nc")), "per-file outlived the combine"
            assert list(cache.rglob(name)), "combined freed too early"
        print(f"{dest}{base}_1a2b3c4d{ext}")
    """,
    "aa-graph": """
        dest = args[args.index("--dest") + 1]
        if os.environ.get("FAKE_CHECK_FREED"):
            combined = args[0].rsplit("/", 1)[-1].replace("_1a2b3c4d", "")
            assert not list(Path(os.environ["AA_CACHE_DIR"]).rglob(combined)), \
                "the local combined copy outlived aa-sv"
        name = args[0].rsplit("/", 1)[-1]
        print(dest + name.replace(".nc", ".png").replace(".zarr", ".png"))
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
            f"args = sys.argv[1:]\nFILES_LAST = {FILES[-1]!r}\n{textwrap.dedent(body)}"
        )
        script.chmod(script.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setattr(jobs, "_bin_dir", lambda: bin_dir)
    monkeypatch.setenv("AASI_RUN_ROOT", str(tmp_path / "runs"))
    monkeypatch.setenv("AASI_BASELINE_BUCKET", "bkt")
    monkeypatch.setenv("AASI_PRINCIPAL", "jane.doe@noaa.gov")
    monkeypatch.setenv("FAKE_FILES", ",".join(FILES))
    monkeypatch.setattr(baseline, "POLL_SECONDS", 0.05)
    # The stand-ins are not aalibrary; say the tools stream (see test_workspace).
    monkeypatch.setattr(baseline.workspace, "tools_stream", lambda tool: True)
    monkeypatch.setattr(baseline.workspace, "tools_file_by_file", lambda tool: True)
    monkeypatch.setattr(baseline.workspace, "tools_swap", lambda tool: True)
    monkeypatch.setattr(baseline.workspace, "tools_sv_by_file", lambda tool: True)
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
    states = {s["id"]: s["state"] for s in run["stages"]}
    assert states.pop("filesv") == "skipped"  # only file by file
    assert list(states.values()) == ["done"] * 7
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
    def boom(_request, *_args, **_kwargs):
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


# --------------------------------------------------------------------------- #
# Working space
# --------------------------------------------------------------------------- #
def test_files_are_freed_as_soon_as_no_later_stage_reads_them(tools, monkeypatch):
    """The stand-ins fail if anything is freed late, or early."""
    monkeypatch.setenv("FAKE_CHECK_FREED", "1")
    client = TestClient(create_app())
    run = _wait(client, client.post("/api/baseline/runs", json=REQUEST).json()["id"])
    assert run["state"] == "succeeded", run["error"]
    assert run["work"]["freedBytes"] > 0 and run["work"]["peakBytes"] > 0
    assert any(note.startswith("Working space:") for note in run["notes"])


def test_keeping_the_files_turns_freeing_off(tools, monkeypatch):
    monkeypatch.setenv("FAKE_CHECK_FREED", "1")
    client = TestClient(create_app())
    request = REQUEST | {"keepLocal": True}
    preview = client.post("/api/baseline/preview", json=request).json()
    assert all(stage["frees"] == [] for stage in preview["stages"])
    run = _wait(client, client.post("/api/baseline/runs", json=request).json()["id"])
    assert run["state"] == "failed"  # the stand-in saw raw files at the combine
    assert "outlived the conversion" in run["error"]


def test_preview_names_what_is_freed_and_where_the_run_works(tools, tmp_path):
    client = TestClient(create_app())
    root = tmp_path / "big-disk"
    preview = client.post(
        "/api/baseline/preview", json=REQUEST | {"workRoot": str(root)}
    ).json()
    frees = {stage["id"]: stage["frees"] for stage in preview["stages"]}
    assert frees["convert"] == ["raw/*.raw"]
    assert frees["combine"] == ["raw/*.nc"]
    assert frees["sv"] == [f"cache/**/{preview['base']}.nc"]
    assert preview["workRoot"] == str(root)
    fetch = next(s for s in preview["stages"] if s["id"] == "fetch")
    assert fetch["command"][fetch["command"].index("-o") + 1].startswith(str(root))


def test_a_chosen_working_folder_is_used_and_made(tools, tmp_path):
    client = TestClient(create_app())
    root = tmp_path / "elsewhere" / "runs"
    request = REQUEST | {"workRoot": str(root), "keepLocal": True}
    run = _wait(client, client.post("/api/baseline/runs", json=request).json()["id"])
    assert run["state"] == "succeeded", run["error"]
    assert Path(run["scratch"]).parent == root
    assert run["work"]["root"] == str(root)


def test_a_relative_working_folder_is_refused(tools):
    client = TestClient(create_app())
    response = client.post(
        "/api/baseline/workspace", json=REQUEST | {"workRoot": "runs/here"}
    )
    assert response.status_code == 400 and "full path" in response.json()["detail"]


def test_a_range_that_cannot_fit_is_refused_before_it_starts(tools, monkeypatch):
    monkeypatch.setattr(baseline.workspace, "disk_space", lambda path: (10**9, 10**11))
    client = TestClient(create_app())
    big = REQUEST | {"expectedBytes": 500 * 10**6}  # needs ~3.9 GB freed as it goes
    report = client.post("/api/baseline/workspace", json=big).json()
    assert report["needBytes"] == report["needFreeingBytes"] > 10**9
    assert report["needKeepingBytes"] > report["needFreeingBytes"]
    assert "1.0 GB free" in report["problem"]
    response = client.post("/api/baseline/runs", json=big)
    assert response.status_code == 409 and "working space" in response.json()["detail"]
    assert client.get("/api/baseline/runs").json() == []


def test_turning_freeing_on_is_suggested_when_it_would_fit(tools, monkeypatch):
    monkeypatch.setattr(
        baseline.workspace, "disk_space", lambda path: (4 * 10**9, 10**11)
    )
    client = TestClient(create_app())
    request = REQUEST | {"expectedBytes": 400 * 10**6, "freeAsYouGo": False}
    report = client.post("/api/baseline/workspace", json=request).json()
    assert "turn it on" in report["problem"]
    report = client.post(
        "/api/baseline/workspace", json=request | {"freeAsYouGo": True}
    ).json()
    assert report["problem"] == ""


def test_a_bucket_mount_is_refused_as_working_folder(tools, monkeypatch, tmp_path):
    mount = baseline.workspace.Mount(str(tmp_path), "fuse.gcsfuse", "my-bucket")
    monkeypatch.setattr(baseline.workspace, "mount_of", lambda path: mount)
    client = TestClient(create_app())
    request = REQUEST | {"workRoot": str(tmp_path / "runs")}
    report = client.post("/api/baseline/workspace", json=request).json()
    assert "gcsfuse" in report["problem"] and report["filesystem"] == "fuse.gcsfuse"
    assert client.post("/api/baseline/runs", json=request).status_code == 409


def test_tools_that_hold_the_range_in_memory_are_named(tools, monkeypatch):
    monkeypatch.setattr(baseline.workspace, "tools_stream", lambda tool: False)
    monkeypatch.setattr(baseline.workspace, "memory_total", lambda: 32 * 10**9)
    monkeypatch.setattr(baseline.workspace, "disk_space", lambda path: (10**12, 10**12))
    client = TestClient(create_app())
    small = client.post(
        "/api/baseline/workspace", json=REQUEST | {"expectedBytes": 10**8}
    ).json()
    assert small["problem"] == "" and "whole range in memory" in small["warnings"][0]
    large = client.post(
        "/api/baseline/workspace", json=REQUEST | {"expectedBytes": 3 * 10**9}
    ).json()
    assert "Update aalibrary" in large["problem"]
    assert large["memoryNeedBytes"] == 16 * 3 * 10**9


def test_unusable_folder_paths_are_a_400_not_a_crash(tools):
    client = TestClient(create_app())
    for root in ("~no-such-user-here/runs", "runs/here"):
        response = client.post(
            "/api/baseline/workspace", json=REQUEST | {"workRoot": root}
        )
        assert response.status_code == 400, root


def test_runs_going_in_the_same_place_count_against_the_free_space(
    tools, monkeypatch, tmp_path
):
    monkeypatch.setattr(
        baseline.workspace, "disk_space", lambda path: (6 * 10**9, 10**11)
    )
    client = TestClient(create_app())
    request = REQUEST | {"expectedBytes": 500 * 10**6}  # about 3.9 GB each
    assert client.post("/api/baseline/workspace", json=request).json()["problem"] == ""
    # A run already going in the same folder, with most of its estimate to come.
    ctx = baseline.Context(
        req=baseline.BaselineRequest(**request),
        base="x",
        dest="gs://b/",
        scratch=tmp_path,
    )
    other = baseline._Run(id="other", ctx=ctx, stages=[])
    other.work = baseline.WorkUsage(root=str(tmp_path / "runs"), needBytes=3 * 10**9)
    with baseline._lock:
        baseline._runs["other"] = other
    response = client.post("/api/baseline/runs", json=request)
    assert response.status_code == 409 and "already going" in response.json()["detail"]


# --------------------------------------------------------------------------- #
# File by file into the bucket
# --------------------------------------------------------------------------- #
STREAMED = REQUEST | {"streamed": True}
PER_FILE = "gs://bkt/derived_products/jane.doe/Henry_B._Bigelow/HB1603/EK60/"


def test_file_by_file_preview_has_no_fetch_and_names_every_store(tools):
    preview = (
        TestClient(create_app()).post("/api/baseline/preview", json=STREAMED).json()
    )
    assert preview["filesDestination"] == PER_FILE
    assert [s["id"] for s in preview["stages"]] == [
        "request",
        "convert",
        "filesv",
        "combine",
        "sv",
        "echogram",
        "record",
    ]
    convert = next(s for s in preview["stages"] if s["id"] == "convert")["command"]
    assert convert[0] == "aa-ed" and convert[1:4] == FILES  # NCEI: by name
    assert convert[convert.index("--dest") + 1] == PER_FILE
    assert convert[convert.index("--format") + 1] == "zarr"
    # NCEI: aa-ed downloads each itself, no lookup, and deletes it once converted.
    assert convert[convert.index("--ship_name") + 1] == "Henry_B._Bigelow"
    assert convert[convert.index("--file_download_directory") + 1].endswith("/raw")
    assert "--cleanup-raw" in convert and "--progress" in convert
    combine = next(s for s in preview["stages"] if s["id"] == "combine")["command"]
    assert combine[1:4] == [PER_FILE + f.replace(".raw", ".zarr") for f in FILES]
    assert "--workdir" not in combine
    assert (
        combine[combine.index("-o") + 1]
        == preview["destination"] + preview["base"] + ".zarr"
    )
    assert all(not s["frees"] for s in preview["stages"])
    assets = {a["kind"]: a["uri"] for a in preview["assets"]}
    assert assets["echodata"].endswith(".zarr") and assets["sv"].endswith(".zarr")
    # Sv file by file: each file's store calibrated where it is, its Sv beside
    # it; then the range's Sv joined from those, in the bucket.
    filesv = next(s for s in preview["stages"] if s["id"] == "filesv")
    assert filesv["tool"] == "aa-sv"
    command = filesv["command"]
    assert command[1:4] == [PER_FILE + f.replace(".raw", ".zarr") for f in FILES]
    assert command[command.index("--dest") + 1] == PER_FILE
    assert command[command.index("--format") + 1] == "zarr"
    sv = next(s for s in preview["stages"] if s["id"] == "sv")
    assert sv["tool"] == "aa-combine" and sv["command"][0] == "aa-combine"
    assert sv["command"][1] == baseline.EACH_FILE_SV
    assert sv["command"][sv["command"].index("--dest") + 1] == preview["destination"]
    assert sv["command"][sv["command"].index("--base") + 1] == preview["base"]


def test_file_by_file_run_combines_the_stores_aa_ed_made(tools, monkeypatch):
    monkeypatch.setenv("FAKE_ED_REUSE", "1")
    client = TestClient(create_app())
    run = _wait(client, client.post("/api/baseline/runs", json=STREAMED).json()["id"])
    assert run["state"] == "succeeded", run["error"]
    assert run["filesDestination"] == PER_FILE
    states = {s["id"]: s["state"] for s in run["stages"]}
    assert states["fetch"] == "skipped" and states["combine"] == "done"
    fetch = next(s for s in run["stages"] if s["id"] == "fetch")
    assert "file by file" in fetch["detail"].lower()
    convert = next(s for s in run["stages"] if s["id"] == "convert")
    assert convert["output"] == PER_FILE
    assert convert["detail"].startswith("3 files, one Zarr store each")
    assert "3 already there" in convert["detail"]
    combine = next(s for s in run["stages"] if s["id"] == "combine")
    assert combine["command"][1:4] == [
        PER_FILE + f.replace(".raw", ".zarr") for f in FILES
    ]
    filesv = next(s for s in run["stages"] if s["id"] == "filesv")
    assert filesv["state"] == "done" and filesv["detail"].startswith("3 files, Sv for")
    sv = next(s for s in run["stages"] if s["id"] == "sv")
    assert (
        sv["tool"] == "aa-combine"
        and sv["detail"] == "3 files' Sv joined, in the bucket."
    )
    assert sv["command"][1:4] == [
        PER_FILE + f.replace(".raw", "_1a2b3c4d.zarr") for f in FILES
    ]
    kinds = {a["kind"]: a["uri"] for a in run["assets"]}
    assert kinds["echodata"] == f"{run['destination']}{run['base']}.zarr"
    assert kinds["sv"] == f"{run['destination']}{run['base']}_5e6f7a8b.zarr"
    assert kinds["echogram"] == f"{run['destination']}{run['base']}_5e6f7a8b.png"
    assert len(client.get("/api/jobs").json()["jobs"]) == 7  # no fetch job
    assert "and their Sv" in " ".join(run["notes"])
    assert not Path(run["scratch"]).exists()


def test_a_file_s_sv_missing_from_aa_svs_list_stops_the_run(tools, monkeypatch):
    monkeypatch.setenv("FAKE_SV_SHORT", "1")
    client = TestClient(create_app())
    run = _wait(client, client.post("/api/baseline/runs", json=STREAMED).json()["id"])
    assert run["state"] == "failed"
    assert "2 of the 3 per-file Sv" in run["error"]
    assert {s["id"]: s["state"] for s in run["stages"]}["sv"] == "pending"


def test_the_base_cannot_be_the_echosounder_s_folder(tools):
    response = TestClient(create_app()).post(
        "/api/baseline/preview", json=STREAMED | {"base": "EK60"}
    )
    assert response.status_code == 400 and "echosounder" in response.json()["detail"]


def test_a_store_missing_from_aa_eds_list_stops_the_run(tools, monkeypatch):
    monkeypatch.setenv("FAKE_ED_SHORT", "1")
    client = TestClient(create_app())
    run = _wait(client, client.post("/api/baseline/runs", json=STREAMED).json()["id"])
    assert run["state"] == "failed"
    assert "2 of the 3 per-file stores" in run["error"]
    assert {s["id"]: s["state"] for s in run["stages"]}["combine"] == "pending"


def test_one_file_file_by_file_goes_straight_to_a_store(tools, monkeypatch):
    monkeypatch.setenv("FAKE_FILES", FILES[0])
    request = STREAMED | {"expectedFiles": [FILES[0]]}
    client = TestClient(create_app())
    run = _wait(client, client.post("/api/baseline/runs", json=request).json()["id"])
    assert run["state"] == "succeeded", run["error"]
    convert = next(s for s in run["stages"] if s["id"] == "convert")
    assert convert["command"][1] == FILES[0]
    assert convert["command"][convert["command"].index("-o") + 1].endswith(".zarr")
    combine = next(s for s in run["stages"] if s["id"] == "combine")
    assert combine["state"] == "skipped" and "One file" in combine["detail"]
    assert run["filesDestination"] == ""  # straight to the asset: no per-file folder
    # Its Sv: the asset's, as a Zarr store in the bucket; nothing to join.
    states = {s["id"]: s["state"] for s in run["stages"]}
    assert states["filesv"] == "skipped"
    sv = next(s for s in run["stages"] if s["id"] == "sv")
    assert (
        sv["tool"] == "aa-sv"
        and sv["command"][sv["command"].index("--format") + 1] == "zarr"
    )


def test_file_by_file_without_the_files_is_refused(tools):
    client = TestClient(create_app())
    response = client.post(
        "/api/baseline/preview", json=STREAMED | {"expectedFiles": []}
    )
    assert response.status_code == 400 and "names none" in response.json()["detail"]


def test_keeping_the_raw_files_file_by_file_does_not_delete_them(tools):
    preview = (
        TestClient(create_app())
        .post("/api/baseline/preview", json=STREAMED | {"keepLocal": True})
        .json()
    )
    convert = next(s for s in preview["stages"] if s["id"] == "convert")["command"]
    assert "--cleanup-raw" not in convert


def test_file_by_file_needs_one_raw_file_of_space_not_the_range(tools, monkeypatch):
    monkeypatch.setattr(
        baseline.workspace, "disk_space", lambda path: (2 * 10**9, 10**11)
    )
    client = TestClient(create_app())
    big = {"expectedBytes": 40 * 10**9, "largestBytes": 200 * 10**6, "sv": False}
    whole = client.post("/api/baseline/workspace", json=REQUEST | big).json()
    assert whole["problem"] and "file by file" in whole["problem"]
    streamed = client.post("/api/baseline/workspace", json=STREAMED | big).json()
    assert streamed["streamed"] and streamed["problem"] == ""
    # One raw file, its store and (200 MB or more) its swap, with the margin.
    assert streamed["needBytes"] == int(200 * 10**6 * (1 + 2.2 + 2.0) * 1.15)
    # Keeping the raw files, the range accumulates again.
    kept = client.post(
        "/api/baseline/workspace", json=STREAMED | big | {"keepLocal": True}
    ).json()
    assert kept["needBytes"] > 40 * 10**9 and "turn that off" in kept["problem"]
    # Sv file by file: one file's Sv here at a time, so no more than converting.
    with_sv = client.post(
        "/api/baseline/workspace", json=STREAMED | big | {"sv": True}
    ).json()
    assert with_sv["problem"] == ""
    assert with_sv["needBytes"] == streamed["needBytes"]
    # An aalibrary that makes the whole range's Sv here: say to update it.
    monkeypatch.setattr(baseline.workspace, "tools_sv_by_file", lambda tool: False)
    old = client.post(
        "/api/baseline/workspace", json=STREAMED | big | {"sv": True}
    ).json()
    assert old["needBytes"] >= 4.5 * 40 * 10**9
    assert old["problem"] == baseline.SV_BY_FILE_UPDATE
    response = client.post("/api/baseline/runs", json=STREAMED | big | {"sv": True})
    assert response.status_code == 409


def test_file_by_file_with_an_old_aalibrary_says_to_update(tools, monkeypatch):
    monkeypatch.setattr(baseline.workspace, "tools_file_by_file", lambda tool: False)
    client = TestClient(create_app())
    report = client.post("/api/baseline/workspace", json=STREAMED).json()
    assert report["problem"] == baseline.FILE_BY_FILE_UPDATE
    assert client.post("/api/baseline/runs", json=STREAMED).status_code == 409
    # The ordinary way still works with it.
    assert client.post("/api/baseline/workspace", json=REQUEST).json()["problem"] == ""


def test_the_largest_file_s_conversion_is_counted_in_memory(tools, monkeypatch):
    monkeypatch.setattr(baseline.workspace, "memory_total", lambda: 2 * 10**9)
    client = TestClient(create_app())
    big = STREAMED | {"expectedBytes": 47 * 10**9, "largestBytes": 10**9, "sv": False}
    report = client.post("/api/baseline/workspace", json=big).json()
    assert report["memoryNeedBytes"] == 3 * 10**9
    assert report["problem"] == "" and "may stop it" in report["warnings"][0]
    # An aalibrary that holds the expansion in memory: say to update it.
    monkeypatch.setattr(baseline.workspace, "tools_swap", lambda tool: False)
    old = client.post("/api/baseline/workspace", json=big).json()
    assert old["memoryNeedBytes"] == 7 * 10**9 and "Update aalibrary" in old["problem"]
    # Small files: combining sets it, as before.
    small = client.post(
        "/api/baseline/workspace", json=STREAMED | {"largestBytes": 10**6}
    ).json()
    assert small["memoryNeedBytes"] < 2 * 10**9
