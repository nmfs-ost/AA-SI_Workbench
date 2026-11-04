"""Prepare requests from other apps (api/remote.py).

Google's token check, the source's file listing and the Prepare run itself
are stand-ins: nothing here reaches Google, NCEI or the tools.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from aa_si_workbench.api import baseline, remote, sources
from aa_si_workbench.api.main import create_app
from aa_si_workbench.api.schemas import RawFile

APP = "metadata-manager@ggn-nmfs-aa-prod-1.iam.gserviceaccount.com"
CARD = {
    "vessel": "Henry_B._Bigelow",
    "survey": "HB1603",
    "sonar": "EK60",
    "start": "2016-07-03T06:10:00",
    "end": "2016-07-03T06:40:00",
}


def _files():
    """Files every 15 minutes from 06:00, then a pause, then two more."""
    names = [
        "T060000",
        "T061500",
        "T063000",
        "T064500",
        "T070000",
        "T120000",
        "T121500",
    ]
    return [
        RawFile(
            name=f"D20160703-{n}.raw",
            sizeBytes=1000 * (i + 1),
            acquiredAt=f"2016-07-03T{n[1:3]}:{n[3:5]}:{n[5:7]}Z",
        )
        for i, n in enumerate(names)
    ]


@pytest.fixture
def world(monkeypatch):
    """Who signed which token, what the source lists, and the runs started."""
    seen = SimpleNamespace(runs=[], audiences=[], refuse=None)

    def verify(token, audiences):
        seen.audiences.append(list(audiences))
        if not token.startswith("good:"):
            raise ValueError("Could not verify token signature.")
        email = token[len("good:") :]
        return {"email": email, "email_verified": not email.startswith("unverified")}

    def post_run(req):
        if seen.refuse:
            raise HTTPException(status_code=409, detail=seen.refuse)
        seen.runs.append(req)
        return SimpleNamespace(
            id=f"run{len(seen.runs)}",
            base="HB1603_EK60_x",
            destination="gs://bkt/derived_products/jane/Henry_B._Bigelow/HB1603/x/",
        )

    monkeypatch.setattr(remote, "verify", verify)
    monkeypatch.setattr(
        sources, "files", lambda source, vessel, survey, sonar: _files()
    )
    monkeypatch.setattr(baseline, "post_run", post_run)
    monkeypatch.setattr(
        baseline, "get_run", lambda run_id: SimpleNamespace(state="running")
    )
    return seen


@pytest.fixture
def client(world):
    return TestClient(create_app())


def _on(client, *accounts, gcloud=False):
    state = client.post(
        "/api/remote/settings",
        json={
            "enabled": True,
            "accounts": list(accounts),
            "acceptGcloudTokens": gcloud,
        },
    )
    assert state.status_code == 200, state.text
    return state.json()


def _send(client, token, card=CARD):
    headers = {"X-AA-Identity": token} if token is not None else {}
    return client.post("/api/remote/prepare", json=card, headers=headers)


# ----------------------------------------------------------------- who
def test_no_token_no_run(client, world):
    _on(client, APP)
    answer = _send(client, None)
    assert answer.status_code == 401 and "X-AA-Identity" in answer.json()["detail"]
    assert world.runs == []


def test_a_token_google_did_not_sign_is_refused(client, world):
    _on(client, APP)
    answer = _send(client, "forged")
    assert answer.status_code == 401 and "not accepted" in answer.json()["detail"]
    assert world.runs == []


def test_a_token_without_a_verified_email_is_refused(client, world):
    _on(client, "unverified@x.org")
    assert _send(client, "good:unverified@x.org").status_code == 401
    assert world.runs == []


def test_off_until_the_user_turns_it_on(client, world):
    answer = _send(client, f"good:{APP}")
    assert answer.status_code == 403 and "switched off" in answer.json()["detail"]
    assert world.runs == []


def test_gcloud_tokens_only_when_allowed(client, world):
    _on(client, APP)
    _send(client, f"good:{APP}")
    _on(client, APP, gcloud=True)
    _send(client, f"good:{APP}")
    assert world.audiences == [
        [remote.DEFAULT_AUDIENCE],
        [remote.DEFAULT_AUDIENCE, remote.GCLOUD_AUDIENCE],
    ]


def test_on_a_workstation_the_audience_is_its_own_address(client, world, monkeypatch):
    # A token made for one workstation is no use on another.
    monkeypatch.setenv("WEB_HOST", "aa-jane.cluster-abc.cloudworkstations.dev")
    _on(client, APP)
    _send(client, f"good:{APP}")
    url = "https://8000-aa-jane.cluster-abc.cloudworkstations.dev"
    assert world.audiences[-1] == [url]
    assert client.get("/api/remote/state").json()["audience"] == url


def test_while_off_no_token_is_even_checked(client, world):
    assert _send(client, f"good:{APP}").status_code == 403
    assert world.audiences == []


def test_a_refused_token_says_what_is_needed_not_why(client, world):
    _on(client, APP)
    detail = _send(client, "forged").json()["detail"]
    assert "Could not verify" not in detail and remote.DEFAULT_AUDIENCE in detail


# ---------------------------------------------------------- an approved account
def test_an_approved_account_starts_a_prepare_run(client, world):
    _on(client, APP.upper())  # addresses are compared without case
    answer = _send(client, f"good:{APP}")
    assert answer.status_code == 202, answer.text
    body = answer.json()
    assert (body["status"], body["runId"], body["runState"]) == (
        "started",
        "run1",
        "running",
    )
    req = world.runs[0]
    # The files that cover 06:10-06:40, and the window that fetches exactly them.
    assert req.expectedFiles == [
        "D20160703-T060000.raw",
        "D20160703-T061500.raw",
        "D20160703-T063000.raw",
    ]
    assert (req.fetchFrom, req.fetchTo) == (
        "2016-07-03T06:00:00",
        "2016-07-03T06:30:00",
    )
    assert (req.start, req.end) == ("2016-07-03T06:10:00", "2016-07-03T06:40:00")
    assert req.expectedBytes == 6000 and req.largestBytes == 3000
    # Elias's flow by default: EchoData and Sv as Zarr, file by file into the bucket.
    assert (req.streamed, req.format, req.sv) == (True, "zarr", True)
    # Nothing on this machine is the caller's to choose.
    assert (req.workRoot, req.keepLocal, req.prefix) == ("", False, "")

    followed = client.get(
        f"/api/remote/requests/{body['id']}", headers={"X-AA-Identity": f"good:{APP}"}
    )
    assert followed.status_code == 200 and followed.json()["status"] == "started"
    # Someone else can't follow it.
    other = client.get(
        f"/api/remote/requests/{body['id']}",
        headers={"X-AA-Identity": "good:x@noaa.gov"},
    )
    assert other.status_code == 404


def test_a_card_cant_choose_the_bucket_or_unknown_options(client, world):
    _on(client, APP)
    answer = _send(client, f"good:{APP}", dict(CARD, bucket="attacker-bucket"))
    assert answer.status_code == 422
    assert _send(client, f"good:{APP}", dict(CARD, workRoot="/tmp")).status_code == 422
    assert world.runs == []
    _send(client, f"good:{APP}")
    assert world.runs[0].bucket == ""  # the workstation's own


@pytest.mark.parametrize(
    "change",
    [
        {"gapSeconds": float("nan")},
        {"gapFactor": -1},
        {"vessel": "x" * 5000},
        {"start": "not a time"},
        {"end": "9999-12-31T23:59:59-05:00"},
        {"end": "2016-07-03T06:00:00"},  # before the start
    ],
)
def test_bad_values_are_refused_before_anything(client, world, change):
    _on(client, APP)
    import json as _json

    body = _json.dumps(dict(CARD, **change), allow_nan=True)
    answer = client.post(
        "/api/remote/prepare",
        content=body,
        headers={"X-AA-Identity": f"good:{APP}", "Content-Type": "application/json"},
    )
    assert answer.status_code in (400, 422), answer.text
    assert world.runs == []
    # Nor are they held for the user to trip over later.
    held = client.post(
        "/api/remote/prepare",
        content=body,
        headers={
            "X-AA-Identity": "good:elias@noaa.gov",
            "Content-Type": "application/json",
        },
    )
    assert held.status_code in (400, 422)
    assert client.get("/api/remote/state").json()["requests"] == []


def test_a_range_nothing_covers_is_refused_and_recorded(client, world):
    _on(client, APP)
    answer = _send(
        client,
        f"good:{APP}",
        dict(CARD, start="2016-07-03T09:00:00", end="2016-07-03T10:00:00"),
    )
    assert answer.status_code == 409 and answer.json()["status"] == "refused"
    assert "in a gap" in answer.json()["detail"]
    assert world.runs == []
    state = client.get("/api/remote/state").json()
    assert state["requests"][0]["status"] == "refused"


def test_what_prepare_refuses_is_passed_back(client, world):
    _on(client, APP)
    world.refuse = "This range needs about 40 GB of working space"
    answer = _send(client, f"good:{APP}")
    assert answer.status_code == 409 and "40 GB" in answer.json()["detail"]


# ------------------------------------------------------- anyone else: held
def test_another_account_waits_for_the_user(client, world):
    _on(client, APP)
    answer = _send(client, "good:elias@noaa.gov", dict(CARD, note="for the Zarr test"))
    assert answer.status_code == 202 and answer.json()["status"] == "held"
    assert world.runs == []
    held = client.get("/api/remote/state").json()["requests"][0]
    assert (held["caller"], held["status"], held["card"]["note"]) == (
        "elias@noaa.gov",
        "held",
        "for the Zarr test",
    )

    ran = client.post(f"/api/remote/requests/{held['id']}/run", json={}).json()
    assert ran["status"] == "started" and len(world.runs) == 1
    # Once decided, it can't be run twice.
    assert (
        client.post(f"/api/remote/requests/{held['id']}/run", json={}).status_code
        == 409
    )


def test_allowing_an_account_runs_its_request_and_the_next_ones(client, world):
    _on(client, APP)
    first = _send(client, "good:elias@noaa.gov").json()
    allowed = client.post(f"/api/remote/requests/{first['id']}/allow", json={}).json()
    assert allowed["status"] == "started"
    assert (
        "elias@noaa.gov"
        in client.get("/api/remote/state").json()["settings"]["accounts"]
    )
    assert _send(client, "good:elias@noaa.gov").json()["status"] == "started"
    assert len(world.runs) == 2


def test_a_request_is_decided_once(client, world):
    _on(client, APP)
    held = _send(client, "good:elias@noaa.gov").json()
    url = f"/api/remote/requests/{held['id']}"
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(4) as pool:
        codes = list(
            pool.map(
                lambda action: client.post(f"{url}/{action}", json={}).status_code,
                ["run", "run", "allow", "discard"],
            )
        )
    assert codes.count(200) == 1 and codes.count(409) == 3
    assert len(world.runs) <= 1


def test_the_dialogs_changes_must_be_json(client, world):
    # A page on another site can post a form, but not JSON (CORS asks first).
    _on(client, APP)
    held = _send(client, "good:elias@noaa.gov").json()
    form = client.post(
        f"/api/remote/requests/{held['id']}/run",
        content="x",
        headers={"Content-Type": "text/plain"},
    )
    assert form.status_code == 415
    settings = client.post(
        "/api/remote/settings",
        content='{"enabled": true, "accounts": ["evil@x.org"]}',
        headers={"Content-Type": "text/plain"},
    )
    assert settings.status_code == 415
    assert world.runs == []


def test_waiting_requests_are_kept_and_capped(client, world, monkeypatch):
    _on(client, APP)
    monkeypatch.setattr(remote, "MAX_HELD", 3)
    monkeypatch.setattr(remote, "KEEP", 2)
    for _ in range(3):
        assert _send(client, "good:elias@noaa.gov").json()["status"] == "held"
    assert _send(client, "good:elias@noaa.gov").status_code == 429
    for _ in range(4):
        _send(client, f"good:{APP}")  # decided ones: only the last 2 kept
    statuses = [r["status"] for r in client.get("/api/remote/state").json()["requests"]]
    assert statuses.count("held") == 3 and statuses.count("started") == 2


def test_a_discarded_request_never_runs(client, world):
    _on(client, APP)
    held = _send(client, "good:elias@noaa.gov").json()
    assert client.post(f"/api/remote/requests/{held['id']}/discard", json={}).json()[
        "status"
    ] == ("discarded")
    assert (
        client.post(f"/api/remote/requests/{held['id']}/run", json={}).status_code
        == 409
    )
    assert world.runs == []


def test_requests_are_kept_across_a_restart(client, world):
    _on(client, APP)
    held = _send(client, "good:elias@noaa.gov").json()
    again = TestClient(create_app())
    assert again.get("/api/remote/state").json()["requests"][0]["id"] == held["id"]


# --------------------------------------------------------------- settings
def test_settings_keep_clean_addresses(client):
    state = _on(client, " Jane.Doe@NOAA.gov ", "jane.doe@noaa.gov", "")
    assert state["settings"]["accounts"] == ["jane.doe@noaa.gov"]
    bad = client.post(
        "/api/remote/settings", json={"enabled": True, "accounts": ["ACCOUNT"]}
    )
    assert bad.status_code == 400


# ---------------------------------------------- the plan matches the panel's
@pytest.mark.parametrize(
    "start, end, files, window",
    [
        # Starts inside a file: that file holds the first ping.
        ("06:20", "06:50", ["T061500", "T063000", "T064500"], ("06:15:00", "06:45:00")),
        # Across the pause: the file before it is taken to run 1.5 cadences
        # (to 07:22:30), not to 12:00; one file is a one-second window.
        ("07:20", "12:10", ["T070000", "T120000"], ("07:00:00", "12:00:00")),
        ("07:30", "12:10", ["T120000"], ("12:00:00", "12:00:01")),
        # The last files.
        ("12:05", "13:00", ["T120000", "T121500"], ("12:00:00", "12:15:00")),
    ],
)
def test_plan_range(start, end, files, window):
    plan = remote.plan_range(
        _files(),
        remote._epoch(f"2016-07-03T{start}:00"),
        remote._epoch(f"2016-07-03T{end}:00"),
    )
    assert plan["files"] == [f"D20160703-{n}.raw" for n in files]
    assert (plan["fetchFrom"], plan["fetchTo"]) == tuple(
        f"2016-07-03T{w}" for w in window
    )


def test_a_last_file_at_midnight_is_not_read_as_the_whole_day():
    files = [
        RawFile(
            name="D20160704-T000000.raw", sizeBytes=1, acquiredAt="2016-07-04T00:00:00Z"
        )
    ]
    plan = remote.plan_range(
        files,
        remote._epoch("2016-07-03T23:50:00"),
        remote._epoch("2016-07-04T00:10:00"),
    )
    assert plan["fetchTo"] == "2016-07-04T00:00:01"
