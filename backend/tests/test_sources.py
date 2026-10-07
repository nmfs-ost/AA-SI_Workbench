"""Data sources: NCEI, OMAO and archives added later, listed and fetched alike.

Archives are folder trees on this machine or in the stand-in bucket the
console tools use in tests (AA_GCS_FAKE_ROOT); nothing here reaches a real
bucket.
"""

from __future__ import annotations

import json
import stat
import sys
import textwrap
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aa_si_workbench.api import sources
from aa_si_workbench.api.main import create_app

from .test_baseline import FILES, REQUEST, _wait, tools  # noqa: F401 - a fixture


@pytest.fixture(autouse=True)
def config(tmp_path, monkeypatch):
    monkeypatch.setenv("AASI_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.delenv("AASI_SOURCES_FILE", raising=False)
    sources._reset_for_tests()
    return tmp_path / "config"


def archive(root: Path, layout=("Henry_B._Bigelow", "HB1603", "EK60")) -> Path:
    folder = root.joinpath(*layout)
    folder.mkdir(parents=True)
    for name in FILES:
        (folder / name).write_bytes(b"raw " + name.encode())
    (folder / "notes.txt").write_text("not a raw file")
    (root / "Bell_M._Shimada" / "SH1901" / "EK80").mkdir(parents=True)
    return folder


def by_id(client: TestClient) -> dict[str, dict]:
    return {s["id"]: s for s in client.get("/api/sources").json()}


def test_ncei_is_ready_and_omao_waits_to_be_connected():
    found = by_id(TestClient(create_app()))
    assert list(found)[:2] == ["ncei", "omao"]
    assert found["ncei"]["ready"] and found["ncei"]["fetch"] == "aa-fetch"
    assert not found["omao"]["ready"]
    assert "not connected yet" in found["omao"]["detail"]
    refused = TestClient(create_app()).get("/api/sources/omao/vessels")
    assert refused.status_code == 409


def test_a_folder_archive_is_listed_like_ncei(tmp_path):
    root = tmp_path / "omao"
    archive(root)
    client = TestClient(create_app())
    saved = client.put("/api/sources/omao", json={"id": "omao", "root": str(root)})
    assert saved.status_code == 200, saved.text
    assert saved.json()["ready"] and saved.json()["fetch"] == "cp"
    vessels = client.get("/api/sources/omao/vessels").json()
    assert [v["id"] for v in vessels] == ["Bell_M._Shimada", "Henry_B._Bigelow"]
    assert vessels[1]["name"] == "Henry B. Bigelow"
    surveys = client.get(
        "/api/sources/omao/surveys", params={"vessel": "Henry_B._Bigelow"}
    ).json()
    assert surveys == [
        {"id": "HB1603", "name": "HB1603", "vesselId": "Henry_B._Bigelow", "year": 2016}
    ]
    q = {"vessel": "Henry_B._Bigelow", "survey": "HB1603"}
    assert client.get("/api/sources/omao/sonars", params=q).json()[0]["id"] == "EK60"
    files = client.get("/api/sources/omao/files", params=q | {"sonar": "EK60"}).json()
    assert [f["name"] for f in files] == FILES
    assert files[0]["acquiredAt"] == "2016-07-03T05:52:10Z"
    assert files[0]["sizeBytes"] == len(b"raw " + FILES[0].encode())


def test_names_never_leave_the_archive(tmp_path):
    archive(tmp_path / "a")
    client = TestClient(create_app())
    client.put("/api/sources/omao", json={"id": "omao", "root": str(tmp_path / "a")})
    for vessel in ("..", "a/b", "."):
        got = client.get("/api/sources/omao/surveys", params={"vessel": vessel})
        assert got.status_code == 400, vessel


def test_a_bucket_archive_with_its_own_layout(tmp_path, monkeypatch):
    fake = tmp_path / "gcs"
    monkeypatch.setenv("AA_GCS_FAKE_ROOT", str(fake))
    archive(fake / "omao-raw" / "fleet" / "data", ("Henry_B._Bigelow", "HB1603", "raw"))
    client = TestClient(create_app())
    saved = client.put(
        "/api/sources/omao",
        json={
            "id": "omao",
            "root": "gs://omao-raw/fleet/",
            "layout": "data/{vessel}/{survey}/raw",
            "sonar": "EK60",
        },
    ).json()
    assert saved["ready"] and saved["fetch"] == "aa-download"
    assert saved["where"] == "gs://omao-raw/fleet/data/{vessel}/{survey}/raw/"
    q = {"vessel": "Henry_B._Bigelow", "survey": "HB1603"}
    assert [
        s["id"] for s in client.get("/api/sources/omao/sonars", params=q).json()
    ] == ["EK60"]
    files = client.get("/api/sources/omao/files", params=q | {"sonar": "EK60"}).json()
    assert len(files) == 3
    provider = sources.provider("omao")
    assert provider.locations("Henry_B._Bigelow", "HB1603", "EK60", FILES[:1]) == [
        f"gs://omao-raw/fleet/data/Henry_B._Bigelow/HB1603/raw/{FILES[0]}"
    ]


def test_bad_locations_and_layouts_are_refused(tmp_path):
    client = TestClient(create_app())
    for body in (
        {"root": "relative/folder"},
        {"root": "s3://somewhere"},
        {"root": "gs://Bad_Bucket/x"},
        {"root": "gs://ok-bucket/../x"},
        {"root": str(tmp_path), "layout": "{survey}/{vessel}"},
        {"root": str(tmp_path), "layout": "{vessel}/../{survey}"},
        {"root": str(tmp_path), "layout": "{vessel}/{survey}"},  # which echosounder?
        {"root": ""},
    ):
        got = client.put("/api/sources/omao", json={"id": "omao", **body})
        assert got.status_code == 400, body
    assert (
        client.put("/api/sources/ncei", json={"id": "ncei", "root": "/x"}).status_code
        == 400
    )


def test_sources_are_added_and_removed(tmp_path, config):
    archive(tmp_path / "share")
    client = TestClient(create_app())
    body = {
        "id": "shimada",
        "name": "  Shimada   share ",
        "kind": "archive",
        "root": str(tmp_path / "share"),
        "description": "The ship's own copies.",
    }
    added = client.put("/api/sources/shimada", json=body)
    assert added.status_code == 200, added.text
    assert added.json()["name"] == "Shimada share" and added.json()["ready"]
    assert list(by_id(client)) == ["ncei", "omao", "shimada"]
    stored = json.loads((config / "sources.json").read_text())
    assert stored["sources"][0]["id"] == "shimada"
    assert (
        client.put("/api/sources/Bad Id", json=body | {"id": "Bad Id"}).status_code
        == 400
    )
    assert (
        client.put("/api/sources/x", json=body | {"id": "x", "kind": "ftp"}).status_code
        == 400
    )
    assert client.delete("/api/sources/shimada").status_code == 200
    assert "shimada" not in by_id(client)
    assert client.delete("/api/sources/shimada").status_code == 404


def test_a_deployment_names_sources_and_the_user_overrides(tmp_path, monkeypatch):
    archive(tmp_path / "deployed")
    archive(tmp_path / "mine")
    deployed = tmp_path / "sources.json"
    deployed.write_text(
        json.dumps({"sources": [{"id": "omao", "root": str(tmp_path / "deployed")}]})
    )
    monkeypatch.setenv("AASI_SOURCES_FILE", str(deployed))
    client = TestClient(create_app())
    assert by_id(client)["omao"]["root"] == str(tmp_path / "deployed")
    client.put("/api/sources/omao", json={"id": "omao", "root": str(tmp_path / "mine")})
    assert by_id(client)["omao"]["root"] == str(tmp_path / "mine")
    client.delete("/api/sources/omao")
    assert by_id(client)["omao"]["root"] == str(tmp_path / "deployed")


# --------------------------------------------------------------------------- #
# Prepare EchoData from another source
# --------------------------------------------------------------------------- #
def test_prepare_copies_a_folder_archives_files(tools, tmp_path):  # noqa: F811
    folder = archive(tmp_path / "omao")
    client = TestClient(create_app())
    client.put("/api/sources/omao", json={"id": "omao", "root": str(tmp_path / "omao")})
    request = REQUEST | {"source": "omao"}
    preview = client.post("/api/baseline/preview", json=request).json()
    assert preview["source"] == "OMAO"
    fetch = next(s for s in preview["stages"] if s["id"] == "fetch")
    assert fetch["tool"] == "cp" and "OMAO" in fetch["description"]
    assert fetch["command"][:3] == ["cp", "-p", "--"]
    assert fetch["command"][3] == str(folder / FILES[0])
    assert fetch["command"][-1].endswith("/raw/")
    run = _wait(client, client.post("/api/baseline/runs", json=request).json()["id"])
    assert run["state"] == "succeeded", run["error"]
    fetch = next(s for s in run["stages"] if s["id"] == "fetch")
    assert fetch["tool"] == "cp" and fetch["command"][0] == "cp"
    assert "from OMAO, as planned" in fetch["detail"]
    assert fetch["output"].endswith("/raw")


ARCHIVE_DOWNLOAD = """
dest = Path(args[args.index("--dest") + 1])
fake = Path(os.environ["AA_GCS_FAKE_ROOT"])
for uri in args[2:]:
    src = fake / uri[len("gs://"):]
    (dest / src.name).write_bytes(src.read_bytes())
    print(dest / src.name)
"""


def test_prepare_downloads_a_bucket_archives_files(tools, tmp_path, monkeypatch):  # noqa: F811
    fake = tmp_path / "gcs"
    monkeypatch.setenv("AA_GCS_FAKE_ROOT", str(fake))
    archive(fake / "omao-raw")
    script = tools / "aa-download"
    script.write_text(
        f"#!{sys.executable}\nimport os, sys\nfrom pathlib import Path\n"
        f"args = sys.argv[1:]\n{textwrap.dedent(ARCHIVE_DOWNLOAD)}"
    )
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    client = TestClient(create_app())
    client.put("/api/sources/omao", json={"id": "omao", "root": "gs://omao-raw"})
    request = REQUEST | {"source": "omao"}
    run = _wait(client, client.post("/api/baseline/runs", json=request).json()["id"])
    assert run["state"] == "succeeded", run["error"]
    fetch = next(s for s in run["stages"] if s["id"] == "fetch")
    assert fetch["tool"] == "aa-download"
    assert f"gs://omao-raw/Henry_B._Bigelow/HB1603/EK60/{FILES[0]}" in fetch["command"]
    # The next stage reads the folder, not the last file aa-download printed.
    convert = next(s for s in run["stages"] if s["id"] == "convert")
    assert convert["command"][1] == fetch["output"]


def test_prepare_refuses_a_source_that_is_not_connected(tools):  # noqa: F811
    client = TestClient(create_app())
    got = client.post("/api/baseline/preview", json=REQUEST | {"source": "omao"})
    assert got.status_code == 409 and "not connected" in got.text
    got = client.post("/api/baseline/preview", json=REQUEST | {"source": "nope"})
    assert got.status_code == 404


def test_a_folder_source_is_refused_when_the_server_is_reachable_from_outside(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("AASI_BIND_HOST", "0.0.0.0")
    monkeypatch.delenv("AASI_ALLOW_REMOTE_FS", raising=False)
    client = TestClient(create_app())
    got = client.put("/api/sources/omao", json={"id": "omao", "root": "/"})
    assert got.status_code == 403
    monkeypatch.setenv("AA_GCS_FAKE_ROOT", str(tmp_path / "gcs"))
    ok = client.put("/api/sources/omao", json={"id": "omao", "root": "gs://omao-raw"})
    assert ok.status_code == 200


class _Blobs(list):
    prefixes: set = set()


class _Client:
    """Lists like google-cloud-storage: prefix '' is the bucket's top."""

    def __init__(self):
        self.asked = []

    def list_blobs(self, bucket, prefix="", delimiter="/"):
        self.asked.append(prefix)
        blobs = _Blobs()
        blobs.prefixes = {"Henry_B._Bigelow/"} if prefix == "" else set()
        return blobs


def test_a_bucket_archive_at_the_top_of_its_bucket_lists_on_real_gcs(monkeypatch):
    monkeypatch.delenv("AA_GCS_FAKE_ROOT", raising=False)
    tree = sources._Tree("gs://omao-raw")
    tree._client = _Client()
    assert tree.folders([]) == ["Henry_B._Bigelow"]
    assert tree._client.asked == [""]
