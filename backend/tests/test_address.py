"""The address to bookmark: the same every session on a Cloud Workstation."""

from __future__ import annotations

from fastapi.testclient import TestClient

from aa_si_workbench import cli
from aa_si_workbench.api.main import create_app


def test_on_a_workstation_the_address_is_its_host_and_port(monkeypatch):
    monkeypatch.setenv("WEB_HOST", "aa-jane.cluster-abc123.cloudworkstations.dev")
    monkeypatch.setenv("AASI_PORT", "8000")
    got = TestClient(create_app()).get("/api/address").json()
    assert got["workstation"] and got["name"] == "aa-jane"
    assert got["url"] == "https://8000-aa-jane.cluster-abc123.cloudworkstations.dev/"
    assert (
        " aa-jane 8000 --local-host-port=localhost:8000 --start-workstation"
        in got["tunnel"]
    )
    assert got["localUrl"] == "http://localhost:8000"


def test_off_a_workstation_there_is_no_workstation_address(monkeypatch):
    monkeypatch.delenv("WEB_HOST", raising=False)
    monkeypatch.setenv("AASI_PORT", "8123")
    got = TestClient(create_app()).get("/api/address").json()
    assert not got["workstation"] and got["url"] == ""
    assert got["localUrl"] == "http://localhost:8123"
    monkeypatch.setenv("WEB_HOST", "not a host; rm -rf /")
    assert TestClient(create_app()).get("/api/address").json()["url"] == ""


def test_aa_workbench_url_prints_it(monkeypatch, capsys):
    monkeypatch.setenv("WEB_HOST", "aa-jane.cluster-abc123.cloudworkstations.dev")
    monkeypatch.delenv("AASI_PORT", raising=False)
    cli.main(["url", "--port", "8000"])
    out = capsys.readouterr().out
    assert "https://8000-aa-jane.cluster-abc123.cloudworkstations.dev/" in out
    assert "gcloud workstations start-tcp-tunnel" in out
