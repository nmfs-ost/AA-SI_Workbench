"""Pipelines of console tools run on a product in the bucket.

The tools' flags are a snapshot of the real aalibrary (fixtures/
aalibrary_tools.json, made by catalogue._introspect), the bucket is the
stand-in the tools themselves use in tests (AA_GCS_FAKE_ROOT), and the tools
that run are small scripts that report what they were given.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aa_si_workbench.api import catalogue, gcp, jobs, pipelines, products
from aa_si_workbench.api.main import create_app

FIXTURE = Path(__file__).parent / "fixtures" / "aalibrary_tools.json"
BUCKET = "ggn-nmfs-aa-prod-1-data"
FOLDER = "derived_products/jane.doe/Henry_B._Bigelow/HB1603/HB1603_L1"
ED = f"gs://{BUCKET}/{FOLDER}/HB1603_L1.nc"
SV = f"gs://{BUCKET}/{FOLDER}/HB1603_L1_097eda86.nc"
SV_DEPTH = f"gs://{BUCKET}/{FOLDER}/HB1603_L1_1a2b3c4d.nc"


@pytest.fixture
def raw() -> dict:
    return json.loads(FIXTURE.read_text())


@pytest.fixture(autouse=True)
def bucket(tmp_path, monkeypatch, raw):
    """A stand-in bucket holding an EchoData, its Sv, and an Sv with depth."""
    root = tmp_path / "gcs"
    monkeypatch.setenv("AA_GCS_FAKE_ROOT", str(root))
    monkeypatch.setenv("AASI_PRINCIPAL", "jane.doe@noaa.gov")
    monkeypatch.setenv("AASI_RUN_ROOT", str(tmp_path / "runs"))
    from aalibrary.console._core import uris

    monkeypatch.setattr(uris, "_BACKEND", None)
    catalogue._reset_for_tests(raw)
    pipelines._reset_for_tests()
    gcp.choose("ggn-nmfs-aa-prod-1", BUCKET)
    put(
        root, ED, b"echodata", tool="aa-combine", record={"kind": "echodata"}, inputs=[]
    )
    put(
        root,
        SV,
        b"sv",
        tool="aa-sv",
        record={"kind": "sv"},
        inputs=[{"role": "source", "uri": ED, "name": "HB1603_L1.nc", "id": "aa:1"}],
        steps=["aa-combine", "aa-sv"],
    )
    put(
        root,
        SV_DEPTH,
        b"sv with depth",
        tool="aa-depth",
        record={"kind": "sv"},
        inputs=[{"role": "source", "uri": SV, "name": "x", "id": "aa:2"}],
        steps=["aa-combine", "aa-sv", "aa-depth"],
    )
    yield root
    catalogue._reset_for_tests()
    monkeypatch.setattr(uris, "_BACKEND", None)


def put(root, uri, data, *, tool, record, inputs, steps=()):
    bucket, key = uri[len("gs://") :].split("/", 1)
    path = root / bucket / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    md5 = base64.b64encode(hashlib.md5(data).digest()).decode()  # noqa: S324
    product_hash = hashlib.sha256(uri.encode()).hexdigest()
    meta = root / ".meta" / bucket / (key + ".json")
    meta.parent.mkdir(parents=True, exist_ok=True)
    meta.write_text(
        json.dumps(
            {
                "generation": "1",
                "metadata": {
                    "aa-product-hash": product_hash,
                    "aa-tool": tool,
                    "aa-recipe": "097eda86" + "0" * 56,
                    "aa-base": "HB1603_L1",
                    "aa-content-md5": md5,
                },
            }
        )
    )
    sidecar = root / bucket / (key + ".aa.json")
    sidecar.write_text(
        json.dumps(
            {
                "base": "HB1603_L1",
                "product": {"hash": product_hash, **record},
                "inputs": inputs,
                "pipeline": [{"tool": t, "product": "x", "params": {}} for t in steps],
                "created": {"at": "2026-10-05T12:00:00Z", "user": "jane"},
            }
        )
    )
    return product_hash


def builtin(pid: str) -> pipelines.PipelineSpec:
    spec = pipelines.find(f"builtin-{pid}")
    assert spec is not None
    return spec


# --------------------------------------------------------------------------- #
# The catalogue comes from the tools
# --------------------------------------------------------------------------- #
def test_every_chainable_tool_is_described_by_the_installed_aalibrary(raw):
    cat = catalogue.build(raw)
    assert not cat.missing and not cat.problem
    assert {t.name for t in cat.tools} == set(catalogue.TRAITS)
    # The kind each tool writes, as its own SPEC says.
    for name, info in raw["tools"].items():
        traits = catalogue.TRAITS[name]
        if not traits.passthrough:
            assert info["kind"] == traits.produces, name


def test_flags_types_and_defaults_are_the_tools_own(raw):
    cat = catalogue.build(raw)
    mvbs = {p.id: p for p in catalogue.tool(cat, "aa-mvbs").params}
    assert (
        mvbs["range_bin"].default == "20m" and mvbs["range_bin"].flag == "--range_bin"
    )
    skipna = mvbs["skipna"]
    assert (skipna.type, skipna.default, skipna.trueFlag, skipna.falseFlag) == (
        "bool",
        True,
        "--skipna",
        "--no_skipna",
    )
    assert mvbs["range_var"].choices == ["echo_range", "depth"]
    assert "output_path" not in mvbs and "dest" not in mvbs and "force" not in mvbs
    graph = {p.id: p for p in catalogue.tool(cat, "aa-graph").params}
    assert graph["vmin"].type == "number" and graph["vmin"].science
    seafloor = {p.id: p for p in catalogue.tool(cat, "aa-detect-seafloor").params}
    assert seafloor["method"].required and seafloor["param"].type == "list"
    assert not seafloor["param"].repeat


def test_only_changed_settings_are_sent_and_negative_numbers_stay_values(raw):
    cat = catalogue.build(raw)
    graph = catalogue.tool(cat, "aa-graph")
    values, problems = catalogue.clean_values(
        graph, {"vmin": "-80", "cmap": "viridis", "decimate": 1, "no_flip": True}
    )
    assert problems == []
    assert values == {"vmin": -80, "no_flip": True}  # defaults dropped
    args = catalogue.stage_argv(graph, values, SV, "gs://b/f/")
    assert args == [SV, "--vmin=-80", "--no-flip", "--dest=gs://b/f/"]
    mvbs = catalogue.tool(cat, "aa-mvbs")
    values, _ = catalogue.clean_values(mvbs, {"skipna": False})
    assert catalogue.option_args(mvbs, values) == ["--no_skipna"]
    seafloor = catalogue.tool(cat, "aa-detect-seafloor")
    values, problems = catalogue.clean_values(
        seafloor, {"method": "basic", "param": ["var_name=Sv", "threshold=-50"]}
    )
    assert catalogue.option_args(seafloor, values) == [
        "--method=basic",
        "--param",
        "var_name=Sv",
        "threshold=-50",
    ]


def test_bad_settings_are_named(raw):
    cat = catalogue.build(raw)
    mvbs = catalogue.tool(cat, "aa-mvbs")
    _, problems = catalogue.clean_values(mvbs, {"range_var": "height", "nope": 1})
    assert any("one of echo_range, depth" in p for p in problems)
    assert any("no setting 'nope'" in p for p in problems)
    seafloor = catalogue.tool(cat, "aa-detect-seafloor")
    _, problems = catalogue.clean_values(seafloor, {})
    assert any("needs --method" in p for p in problems)


@pytest.mark.skipif(
    __import__("importlib").util.find_spec("aalibrary") is None,
    reason="aalibrary is not installed here",
)
def test_the_live_aalibrary_answers_too():
    catalogue._reset_for_tests()
    cat = catalogue.get(refresh=True)
    assert cat.problem == "" and cat.missing == []


# --------------------------------------------------------------------------- #
# Products: hashes and history, without downloading
# --------------------------------------------------------------------------- #
def test_a_product_shows_its_hashes_and_where_it_came_from(bucket):
    info = products.info(SV)
    assert info.found and info.kind == "sv" and info.level == "L2A"
    assert len(info.productHash) == 64 and info.recipe.startswith("097eda86")
    assert info.md5 == hashlib.md5(b"sv").hexdigest()  # noqa: S324
    assert info.intact is True
    assert info.echodata == ED and info.features == []
    deep = products.info(SV_DEPTH)
    assert deep.features == ["depth"] and deep.echodata == ED  # two hops up


def test_a_product_rewritten_after_publishing_is_not_intact(bucket):
    (bucket / BUCKET / FOLDER / "HB1603_L1_097eda86.nc").write_bytes(b"changed")
    assert products.info(SV).intact is False


def test_the_listing_carries_the_hashes(bucket):
    client = TestClient(create_app())
    listing = client.get(f"/api/derived/list?prefix={FOLDER}/").json()
    by_name = {e["name"]: e for e in listing["entries"]}
    assert not any(name.endswith(".aa.json") for name in by_name)
    sv = by_name["HB1603_L1_097eda86.nc"]
    assert (sv["productKind"], sv["level"], sv["tool"], sv["intact"]) == (
        "sv",
        "L2A",
        "aa-sv",
        True,
    )
    assert len(sv["productHash"]) == 64 and len(sv["md5"]) == 32


# --------------------------------------------------------------------------- #
# Planning
# --------------------------------------------------------------------------- #
def plan(pid: str, uri: str, **kw) -> pipelines.Plan:
    return pipelines.plan(pipelines.PlanRequest(pipeline=builtin(pid), input=uri, **kw))


def test_an_sv_input_skips_the_calibration_and_products_go_beside_it():
    result = plan("sv-echogram", SV)
    assert result.problems == []
    assert [(s.tool, s.action) for s in result.stages] == [
        ("aa-sv", "skip"),
        ("aa-graph", "run"),
    ]
    graph = result.stages[1]
    assert graph.command[:2] == ["aa-graph", SV]
    assert graph.command[-1] == f"--dest=gs://{BUCKET}/{FOLDER}/"
    assert result.outputKind == "echogram"
    assert 'OUT2=$(aa-graph "$IN"' in result.script


def test_an_echodata_input_runs_everything_and_chains_the_outputs():
    result = plan("mvbs-echogram", ED)
    assert [s.action for s in result.stages] == ["run", "run", "run"]
    assert result.stages[1].reads == "<the Sv output>"
    assert 'OUT2=$(aa-mvbs "$OUT1"' in result.script


def test_nasc_finds_the_echodata_for_position_in_the_svs_record():
    result = plan("nasc", SV)
    assert result.problems == []
    location = next(s for s in result.stages if s.tool == "aa-location")
    assert f"--echodata={ED}" in location.command


def test_a_missing_variable_names_the_tool_that_adds_it():
    spec = pipelines.PipelineSpec(
        name="x", stages=[pipelines.StageSpec(tool="aa-nasc")]
    )
    result = pipelines.plan(pipelines.PlanRequest(pipeline=spec, input=SV))
    assert any("add aa-depth" in p for p in result.problems)
    assert any("add aa-location" in p for p in result.problems)
    result = pipelines.plan(pipelines.PlanRequest(pipeline=spec, input=SV_DEPTH))
    assert not any("depth" in p for p in result.problems)  # its history has aa-depth


def test_a_stage_adding_what_the_input_already_has_is_skipped():
    # NASC on an Sv that has depth: aa-depth would remake the same depth.
    result = plan("nasc", SV_DEPTH)
    actions = {s.tool: (s.action, s.reason) for s in result.stages}
    action, reason = actions["aa-depth"]
    assert action == "skip" and "already has depth" in reason
    assert actions["aa-location"][0] == "run"
    location = next(s for s in result.stages if s.tool == "aa-location")
    assert location.reads == SV_DEPTH
    # On an Sv without depth it runs; with settings of its own it runs too.
    assert {s.tool: s.action for s in plan("nasc", SV).stages}["aa-depth"] == "run"
    spec = builtin("nasc")
    spec.stages[1].params = {"depth_offset": 5}
    tuned = pipelines.plan(pipelines.PlanRequest(pipeline=spec, input=SV_DEPTH))
    assert {s.tool: s.action for s in tuned.stages}["aa-depth"] == "run"


def test_a_pipeline_that_cannot_read_the_input_says_so():
    spec = pipelines.PipelineSpec(
        name="x", stages=[pipelines.StageSpec(tool="aa-graph")]
    )
    result = pipelines.plan(pipelines.PlanRequest(pipeline=spec, input=ED))
    assert any("No stage of this pipeline reads EchoData" in p for p in result.problems)


def test_an_input_in_another_bucket_writes_to_your_folder_in_yours(bucket):
    other = "gs://shared-results/derived_products/bob/Henry_B._Bigelow/HB1603/X/X.nc"
    put(bucket, other, b"ed", tool="aa-combine", record={"kind": "echodata"}, inputs=[])
    result = plan("sv-echogram", other)
    assert result.destination == (
        f"gs://{BUCKET}/derived_products/jane.doe/Henry_B._Bigelow/HB1603/X/"
    )
    assert "bucket you chose" in result.destinationReason


def test_a_destination_must_be_a_bucket_folder():
    with pytest.raises(Exception) as caught:
        plan("sv-echogram", SV, dest="/tmp/somewhere")
    assert getattr(caught.value, "status_code", None) == 400


# --------------------------------------------------------------------------- #
# Saved pipelines
# --------------------------------------------------------------------------- #
def test_pipelines_are_saved_validated_and_deleted():
    client = TestClient(create_app())
    listed = client.get("/api/pipelines").json()
    assert any(p["id"] == "builtin-sv-echogram" and p["builtin"] for p in listed)
    made = client.post(
        "/api/pipelines",
        json={
            "name": "My MVBS",
            "stages": [
                {"tool": "aa-sv"},
                {
                    "tool": "aa-mvbs",
                    "params": {"range_bin": "5m", "ping_time_bin": "20s"},
                },
            ],
        },
    ).json()
    assert made["id"] == "my-mvbs"
    assert made["stages"][1]["params"] == {"range_bin": "5m"}  # the default dropped
    made["name"] = "My MVBS, 5 m"
    assert client.post("/api/pipelines", json=made).json()["id"] == "my-mvbs"
    copy = client.post(
        "/api/pipelines", json={**builtin("sv-echogram").model_dump(), "name": "Mine"}
    ).json()
    assert copy["id"] == "mine" and not copy["builtin"]
    bad = client.post("/api/pipelines", json={"name": "x", "stages": [{"tool": "rm"}]})
    assert bad.status_code == 400
    assert (
        client.post("/api/pipelines/delete", json={"id": "my-mvbs"}).status_code == 200
    )
    assert "my-mvbs" not in {p["id"] for p in client.get("/api/pipelines").json()}


# --------------------------------------------------------------------------- #
# Running
# --------------------------------------------------------------------------- #
FAKE_TOOL = """#!{python}
import os, sys
args = sys.argv[1:]
print("args:", *args, file=sys.stderr)
print("project:", os.environ.get("AALIBRARY_GCP_PROJECT_ID", "-"), file=sys.stderr)
if os.environ.get("FAIL_TOOL") == "{name}":
    print("{name}: error: boom", file=sys.stderr)
    sys.exit(1)
dest = next(a.split("=", 1)[1] for a in args if a.startswith("--dest="))
print(dest + "{name}-" + os.path.basename(args[0]))
"""


@pytest.fixture
def tools(tmp_path, monkeypatch):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name in ("aa-sv", "aa-graph", "aa-mvbs"):
        path = bin_dir / name
        path.write_text(
            FAKE_TOOL.replace("{python}", sys.executable).replace("{name}", name)
        )
        path.chmod(0o755)
    monkeypatch.setattr(jobs, "_bin_dir", lambda: bin_dir)
    jobs._reset_for_tests()
    return bin_dir


def wait(run_id: str) -> pipelines.RunStatus:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        status = pipelines.snapshot(pipelines.get_run(run_id))
        if status.state != "running":
            return status
        time.sleep(0.05)
    raise AssertionError("the run did not finish")


def test_a_run_chains_each_stage_into_the_next(tools):
    started = pipelines.start(
        pipelines.PlanRequest(pipeline=builtin("mvbs-echogram"), input=ED)
    )
    status = wait(started.id)
    assert status.state == "succeeded", status.error
    sv, mvbs, graph = status.stages
    dest = f"gs://{BUCKET}/{FOLDER}/"
    assert sv.output == f"{dest}aa-sv-HB1603_L1.nc"
    assert mvbs.command[1] == sv.output  # the Sv went into aa-mvbs
    assert graph.command[1] == mvbs.output
    assert any("ggn-nmfs-aa-prod-1" in line for line in graph.log)


def test_a_failed_stage_stops_the_run_and_says_why(tools, monkeypatch):
    monkeypatch.setenv("FAIL_TOOL", "aa-mvbs")
    status = wait(
        pipelines.start(
            pipelines.PlanRequest(pipeline=builtin("mvbs-echogram"), input=ED)
        ).id
    )
    assert status.state == "failed"
    assert [s.state for s in status.stages] == ["succeeded", "failed", "skipped"]
    assert "boom" in status.error


def test_a_run_with_problems_is_refused():
    spec = pipelines.PipelineSpec(
        name="x", stages=[pipelines.StageSpec(tool="aa-nasc")]
    )
    client = TestClient(create_app())
    refused = client.post(
        "/api/pipelines/runs", json={"pipeline": spec.model_dump(), "input": SV}
    )
    assert refused.status_code == 409 and "aa-depth" in refused.text


# --------------------------------------------------------------------------- #
# Edges found in review
# --------------------------------------------------------------------------- #
def test_the_pipeline_is_picked_up_where_the_rest_of_it_holds(bucket):
    mvbs = f"gs://{BUCKET}/{FOLDER}/HB1603_L1_5d71817d.nc"
    put(bucket, mvbs, b"mvbs", tool="aa-mvbs", record={"kind": "mvbs"}, inputs=[])
    spec = pipelines.PipelineSpec(
        name="x",
        stages=[
            pipelines.StageSpec(tool=t)
            for t in ("aa-sv", "aa-coerce-time", "aa-mvbs", "aa-graph")
        ],
    )
    result = pipelines.plan(pipelines.PlanRequest(pipeline=spec, input=mvbs))
    assert result.problems == []
    assert [s.action for s in result.stages] == ["skip", "skip", "skip", "run"]


def test_a_colleagues_folder_is_never_written_to(bucket):
    theirs = f"gs://{BUCKET}/derived_products/bob/Henry_B._Bigelow/HB1603/X/X.nc"
    put(
        bucket, theirs, b"ed", tool="aa-combine", record={"kind": "echodata"}, inputs=[]
    )
    result = plan("sv-echogram", theirs)
    assert result.destination == (
        f"gs://{BUCKET}/derived_products/jane.doe/Henry_B._Bigelow/HB1603/X/"
    )
    assert "bob's folder" in result.destinationReason


def test_settings_that_need_the_echodata_say_so_when_it_is_unknown(bucket):
    orphan = f"gs://{BUCKET}/{FOLDER}/orphan_sv.nc"
    put(bucket, orphan, b"sv", tool="aa-sv", record={"kind": "sv"}, inputs=[])
    spec = pipelines.PipelineSpec(
        name="x",
        stages=[
            pipelines.StageSpec(tool="aa-depth", params={"use_platform_angles": True})
        ],
    )
    result = pipelines.plan(pipelines.PlanRequest(pipeline=spec, input=orphan))
    assert any("with these settings reads the EchoData" in p for p in result.problems)
    spec.stages[0].params = {}
    assert (
        pipelines.plan(pipelines.PlanRequest(pipeline=spec, input=orphan)).problems
        == []
    )


def test_nothing_typed_can_add_a_line_to_the_script():
    spec = builtin("sv-echogram").model_copy(update={"name": "x\ntouch /tmp/pwned #"})
    result = pipelines.plan(pipelines.PlanRequest(pipeline=spec, input=SV))
    assert "\ntouch" not in result.script
    for bad in ("gs://b-1/x\ntouch /tmp/p #/", "gs://b-1/x\r/"):
        with pytest.raises(Exception) as caught:
            pipelines.plan(pipelines.PlanRequest(pipeline=spec, input=SV, dest=bad))
        assert getattr(caught.value, "status_code", None) == 400
    for uri in (
        "gs://../x.nc",
        "gs://B/x.nc",
        f"gs://{BUCKET}/a\nb.nc",
        f"gs://{BUCKET}/",
    ):
        with pytest.raises(Exception) as caught:
            products.parse(uri)
        assert getattr(caught.value, "status_code", None) == 400


def test_a_failed_run_leaves_no_scratch_behind(tools, monkeypatch, tmp_path):
    monkeypatch.setenv("FAIL_TOOL", "aa-mvbs")
    status = wait(
        pipelines.start(
            pipelines.PlanRequest(pipeline=builtin("mvbs-echogram"), input=ED)
        ).id
    )
    assert status.state == "failed"
    assert not list((tmp_path / "runs").glob("pipeline-*"))


# --------------------------------------------------------------------------- #
# Steps of one's own: Bash and Python
# --------------------------------------------------------------------------- #
def own(*stages: pipelines.StageSpec) -> pipelines.PipelineSpec:
    return pipelines.PipelineSpec(name="Mine", stages=list(stages))


def bash(command: str, **kw) -> pipelines.StageSpec:
    return pipelines.StageSpec(tool="bash", command=command, **kw)


def test_own_steps_are_saved_with_their_command():
    client = TestClient(create_app())
    made = client.post(
        "/api/pipelines",
        json=own(
            pipelines.StageSpec(tool="aa-sv"),
            bash("tee -a ~/sv.log", label="  Log   the Sv \n"),
            pipelines.StageSpec(tool="python", command="print(input())"),
            pipelines.StageSpec(tool="aa-graph"),
        ).model_dump(),
    )
    assert made.status_code == 200, made.text
    stages = made.json()["stages"]
    assert stages[1]["command"] == "tee -a ~/sv.log"
    assert stages[1]["label"] == "Log the Sv"
    assert stages[2]["tool"] == "python"
    for bad in (bash("   "), bash("x\x00"), bash("tee", produces="nonsense")):
        refused = client.post("/api/pipelines", json=own(bad).model_dump())
        assert refused.status_code == 400


def test_an_own_step_runs_on_what_the_stage_before_it_made():
    spec = own(
        pipelines.StageSpec(tool="aa-sv"),
        bash('tee -a sv.log; echo "$(date)" >&2', label="Log the Sv"),
        pipelines.StageSpec(tool="aa-graph"),
    )
    on_ed = pipelines.plan(pipelines.PlanRequest(pipeline=spec, input=ED))
    assert on_ed.problems == []
    assert [s.action for s in on_ed.stages] == ["run", "run", "run"]
    step = on_ed.stages[1]
    assert step.label == "Log the Sv" and step.group == "Your own"
    assert step.command[:4] == ["bash", "-eo", "pipefail", "-c"]
    assert step.reads == "<the Sv output>" and step.produces == "sv"
    assert on_ed.stages[2].reads == "<the Log the Sv output>"
    assert 'OUT2=$(cd ~ && printf \'%s\\n\' "$OUT1" | IN="$OUT1"' in on_ed.script
    assert 'OUT3=$(aa-graph "$OUT2"' in on_ed.script
    # Given an Sv, the step after the Sv stage still runs: on the input.
    on_sv = pipelines.plan(pipelines.PlanRequest(pipeline=spec, input=SV))
    assert on_sv.problems == []
    assert [s.action for s in on_sv.stages] == ["skip", "run", "run"]
    assert on_sv.stages[1].reads == SV


def test_a_step_that_says_what_it_makes_starts_the_chain():
    spec = own(
        pipelines.StageSpec(tool="python", command="...", produces="sv"),
        pipelines.StageSpec(tool="aa-graph"),
    )
    result = pipelines.plan(pipelines.PlanRequest(pipeline=spec, input=ED))
    assert result.problems == []
    assert [s.action for s in result.stages] == ["run", "run"]
    assert result.stages[0].command[:2] == ["python3", "-c"]
    # Before a stage the input is past, it is skipped with that stage.
    spec = own(
        bash("echo hi >&2"),
        pipelines.StageSpec(tool="aa-sv"),
        pipelines.StageSpec(tool="aa-graph"),
    )
    result = pipelines.plan(pipelines.PlanRequest(pipeline=spec, input=SV))
    assert [s.action for s in result.stages] == ["skip", "skip", "run"]
    assert pipelines.plan(
        pipelines.PlanRequest(pipeline=own(bash(" ")), input=SV)
    ).problems


def test_the_script_runs_own_steps_as_written(tmp_path):
    spec = own(
        bash("tee -a steps.log", label='Log "$(touch pwned)"'),
        pipelines.StageSpec(
            tool="python", command="import sys\nprint(sys.stdin.read().strip() + '.x')"
        ),
        bash("echo not a product"),
    )
    result = pipelines.plan(pipelines.PlanRequest(pipeline=spec, input=SV))
    assert result.problems == [], result.problems
    script = tmp_path / "run.sh"
    # The products: the stand-in bucket has no gsutil, so a path stands in.
    (tmp_path / "sv.nc").write_text("sv")
    (tmp_path / "sv.nc.x").write_text("x")
    script.write_text(
        result.script.replace(f"IN={SV}", f"IN={tmp_path / 'sv.nc'}").replace(
            "python3 -c", f"{sys.executable} -c"
        )
        + 'echo "FINAL=$OUT3"\n'
    )
    import subprocess

    home = tmp_path / "home"
    home.mkdir()
    done = subprocess.run(
        ["bash", str(script)],
        cwd=tmp_path,
        env={**os.environ, "HOME": str(home)},
        capture_output=True,
        text=True,
        check=False,
    )
    assert done.returncode == 0, done.stderr
    # Steps run from the home folder, as the Workbench runs them.
    assert (home / "steps.log").read_text().strip() == str(tmp_path / "sv.nc")
    assert f"FINAL={tmp_path / 'sv.nc.x'}" in done.stdout
    assert not (tmp_path / "pwned").exists()


def test_a_relative_product_is_read_from_the_home_folder_in_both(
    tools, tmp_path, monkeypatch
):
    """The run and the plan's script agree on what a step hands on."""
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    spec = own(
        pipelines.StageSpec(tool="aa-sv"),
        bash("touch mine.nc && echo mine.nc", label="Make my own"),
        pipelines.StageSpec(tool="aa-graph"),
    )
    status = wait(pipelines.start(pipelines.PlanRequest(pipeline=spec, input=ED)).id)
    assert status.state == "succeeded", status.error
    assert status.stages[1].output == str(home / "mine.nc")
    assert status.stages[2].command[1] == str(home / "mine.nc")
    # The script: the same step, the same answer.
    only = own(bash("touch mine.nc && echo mine.nc"))
    script = pipelines.plan(pipelines.PlanRequest(pipeline=only, input=SV)).script
    import subprocess

    done = subprocess.run(
        ["bash", "-c", script + 'echo "FINAL=$OUT1"\n'],
        cwd=tmp_path,
        env={**os.environ, "HOME": str(home)},
        capture_output=True,
        text=True,
        check=False,
    )
    assert done.returncode == 0, done.stderr
    assert f"FINAL={home / 'mine.nc'}" in done.stdout


def test_own_steps_are_refused_when_the_server_is_reachable_from_outside(
    tools, tmp_path, monkeypatch
):
    monkeypatch.setenv("AASI_BIND_HOST", "0.0.0.0")
    monkeypatch.delenv("AASI_ALLOW_REMOTE_TERMINAL", raising=False)
    spec = own(bash(f"touch {tmp_path / 'ran'}"))
    planned = pipelines.plan(pipelines.PlanRequest(pipeline=spec, input=SV))
    assert any("bound to 0.0.0.0" in p for p in planned.problems)
    refused = TestClient(create_app()).post(
        "/api/pipelines/runs", json={"pipeline": spec.model_dump(), "input": SV}
    )
    assert refused.status_code == 409
    with pytest.raises(Exception) as caught:
        jobs.submit_step("bash", "true", stdin_text="", env={}, cwd="", label="x")
    assert getattr(caught.value, "status_code", None) == 403
    assert not (tmp_path / "ran").exists()
    monkeypatch.setenv("AASI_ALLOW_REMOTE_TERMINAL", "true")
    assert pipelines.plan(pipelines.PlanRequest(pipeline=spec, input=SV)).problems == []


def test_a_run_passes_on_what_an_own_step_prints(tools, tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    spec = own(
        pipelines.StageSpec(tool="aa-sv"),
        bash('tee -a sv.log; echo "logged $IN" >&2; ls / >/dev/null', label="Log"),
        pipelines.StageSpec(
            tool="python",
            command=(
                "import sys\nprint('looking')\n"
                "print(sys.stdin.read().strip() + '-renamed')"
            ),
        ),
        pipelines.StageSpec(tool="aa-graph"),
    )
    status = wait(pipelines.start(pipelines.PlanRequest(pipeline=spec, input=ED)).id)
    assert status.state == "succeeded", status.error
    sv, log, py, graph = status.stages
    assert log.output == sv.output and log.detail == "Passed its input on."
    assert (tmp_path / "sv.log").read_text().strip() == sv.output
    assert any("logged" in line for line in log.log)
    assert py.output == sv.output + "-renamed"
    assert "looking" in py.log
    assert graph.command[1] == py.output


def test_a_failed_own_step_stops_the_run(tools, tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    spec = own(
        pipelines.StageSpec(tool="aa-sv"),
        bash("grep nothing-here; echo never"),
        pipelines.StageSpec(tool="aa-graph"),
    )
    status = wait(pipelines.start(pipelines.PlanRequest(pipeline=spec, input=ED)).id)
    assert status.state == "failed"
    assert [s.state for s in status.stages] == ["succeeded", "failed", "skipped"]
    assert "exit 1" in status.error
    job = status.stages[1].jobId
    with pytest.raises(Exception) as caught:
        jobs.resume(job)
    assert getattr(caught.value, "status_code", None) in (404, 409)
