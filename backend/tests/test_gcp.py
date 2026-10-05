"""The GCP project and bucket: chosen, discovered, and used everywhere."""

from __future__ import annotations

import sys
import time

import pytest
from fastapi.testclient import TestClient

from aa_si_workbench.api import derived, gcp, identity, jobs, ncei
from aa_si_workbench.api.main import create_app

PROD, DEV, OTHER = "ggn-nmfs-aa-prod-1", "ggn-nmfs-aa-dev-1", "someone-else-7"


class FakeCloud:
    """Prod: read and write. Dev: read only. Other: listed, no bucket access."""

    def __init__(self, *, search=None, perms=None, listable=None, cache=None):
        self.search = search if search is not None else [(OTHER, "Other team")]
        self.perms = perms or {
            f"{PROD}-data": set(gcp.READ + gcp.WRITE),
            f"{DEV}-data": set(gcp.READ),
            "shared-results": set(gcp.READ + gcp.WRITE),
        }
        self.listable = listable or {}
        self.cache = cache or {PROD: True, DEV: True}

    def account(self):
        return "jane.doe@noaa.gov", ""

    def search_projects(self):
        if isinstance(self.search, Exception):
            raise self.search
        return list(self.search)

    def list_buckets(self, project):
        if project not in self.listable:
            raise PermissionError("403 storage.buckets.list denied")
        return self.listable[project]

    def permissions(self, bucket):
        if bucket not in self.perms:
            return None
        return set(self.perms[bucket])

    def has_ncei_cache(self, project):
        return self.cache.get(project, False)


def use(cloud):
    gcp._reset_for_tests(lambda: cloud)


# --------------------------------------------------------------------------- #
# The context in force
# --------------------------------------------------------------------------- #
def test_nothing_is_chosen_until_someone_chooses(monkeypatch):
    monkeypatch.delenv("AASI_DERIVED_BUCKET", raising=False)
    context = gcp.current()
    assert (context.source, context.bucket, context.project) == ("unset", "", "")
    assert context.nceiCacheProject == PROD  # the table aa-fetch has always read
    assert gcp.tool_env() == {}


def test_the_deployment_environment_still_counts(monkeypatch):
    monkeypatch.setenv("AASI_DERIVED_BUCKET", f"{DEV}-data")
    context = gcp.current()
    assert (context.source, context.project, context.bucket) == (
        "environment",
        DEV,
        f"{DEV}-data",
    )
    monkeypatch.delenv("AASI_DERIVED_BUCKET")
    monkeypatch.setenv("AASI_GCP_PROJECT", PROD)
    assert gcp.current().bucket == f"{PROD}-data"


def test_a_choice_is_remembered_and_beats_the_environment(monkeypatch):
    monkeypatch.setenv("AASI_DERIVED_BUCKET", f"{DEV}-data")
    gcp.choose("", f"gs://{PROD}-data/")
    context = gcp.current()
    assert (context.source, context.project, context.bucket) == (
        "chosen",
        PROD,
        f"{PROD}-data",
    )
    assert gcp.tool_env() == {
        "AALIBRARY_GCP_PROJECT_ID": PROD,
        "GOOGLE_CLOUD_PROJECT": PROD,
        "AALIBRARY_GCP_BUCKET_NAME": f"{PROD}-data",
    }
    assert (gcp.config_dir() / "gcp.json").is_file()
    assert gcp.forget().source == "environment"


def test_bad_names_are_refused():
    for project, bucket in (("Bad_Project", "ok-bucket"), ("", "x"), ("", "UPPER")):
        with pytest.raises(Exception) as caught:
            gcp.choose(project, bucket)
        assert getattr(caught.value, "status_code", None) == 400


def test_a_bucket_needs_a_project():
    """Its name may not say; the tools must be told one, so it is asked for."""
    with pytest.raises(Exception) as caught:
        gcp.choose("", "team-results")
    assert "type the project id" in str(caught.value.detail)
    # Discovery found it, so its project is known.
    use(
        FakeCloud(
            listable={OTHER: ["team-results"]}, perms={"team-results": set(gcp.READ)}
        )
    )
    gcp.discover(refresh=True)
    assert gcp.choose("", "team-results").project == OTHER
    # A project alone means its conventional bucket.
    assert gcp.choose(DEV, "").bucket == f"{DEV}-data"


def test_a_hand_edited_file_cannot_smuggle_a_project_into_sql():
    (gcp.config_dir()).mkdir(parents=True, exist_ok=True)
    (gcp.config_dir() / "gcp.json").write_text(
        '{"project": "x`; DROP TABLE t; --", "bucket": "team-results",'
        ' "nceiCacheProject": "a`b"}'
    )
    context = gcp.current()
    assert context.source == "unset" and context.nceiCacheProject == PROD


def test_a_project_without_the_ncei_cache_reads_one_that_has_it(monkeypatch):
    use(
        FakeCloud(
            listable={OTHER: ["team-results"]},
            perms={"team-results": set(gcp.READ + gcp.WRITE)},
        )
    )
    gcp.discover(refresh=True)
    context = gcp.choose(OTHER, "team-results")
    assert (context.project, context.nceiCacheProject) == (OTHER, PROD)
    # The fetch is told the cache's project; everything else the chosen one.
    assert gcp.tool_env(ncei=True)["AALIBRARY_GCP_PROJECT_ID"] == PROD
    assert gcp.tool_env()["AALIBRARY_GCP_PROJECT_ID"] == OTHER
    assert gcp.choose(DEV, f"{DEV}-data").nceiCacheProject == DEV


def test_forgetting_is_not_undone_by_choosing_for_you():
    use(FakeCloud(perms={f"{PROD}-data": set(gcp.READ + gcp.WRITE)}))
    assert gcp.discover(refresh=True).autoSelected
    gcp.forget()
    found = gcp.discover(refresh=True)
    assert not found.autoSelected and found.context.source == "unset"


def test_discovery_does_not_wait_forever(monkeypatch):
    monkeypatch.setattr(gcp, "DISCOVERY_DEADLINE", 0.3)

    class Slow(FakeCloud):
        def permissions(self, bucket):
            if bucket.startswith(DEV):
                time.sleep(2)
            return super().permissions(bucket)

    use(Slow())
    started = time.monotonic()
    found = gcp.discover(refresh=True)
    assert time.monotonic() - started < 1.5
    dev = next(p for p in found.projects if p.id == DEV)
    assert "took too long" in dev.detail
    assert any(p.id == PROD and p.buckets for p in found.projects)
    # Prod is the only writable bucket found, but dev was not checked: nothing
    # is chosen from a partial list.
    assert not found.complete and not found.autoSelected


def test_the_cli_choice_checks_the_cache_itself():
    """No discovery in that process: Google is asked once."""

    class NoCache(FakeCloud):
        def has_ncei_cache(self, project):
            return project != OTHER

    gcp._reset_for_tests(lambda: NoCache())
    assert gcp.choose(OTHER, "").nceiCacheProject == PROD


# --------------------------------------------------------------------------- #
# Discovery
# --------------------------------------------------------------------------- #
def test_discovery_lists_what_you_can_use_writable_first():
    use(FakeCloud(listable={OTHER: ["shared-results"]}))
    found = gcp.discover(refresh=True)
    assert found.account == "jane.doe@noaa.gov"
    ids = [p.id for p in found.projects]
    assert ids[:3] == [PROD, OTHER, DEV]  # writable (known first), then read-only
    by_id = {p.id: p for p in found.projects}
    prod = by_id[PROD].buckets[0]
    assert (prod.name, prod.read, prod.write) == (f"{PROD}-data", True, True)
    assert (by_id[DEV].buckets[0].read, by_id[DEV].buckets[0].write) == (True, False)
    assert [b.name for b in by_id[OTHER].buckets] == ["shared-results"]
    assert by_id[OTHER].listedBy == "search" and by_id[PROD].listedBy == "known"
    assert by_id[PROD].nceiCache is True


def test_the_only_writable_bucket_is_chosen_for_you():
    use(FakeCloud(perms={f"{PROD}-data": set(gcp.READ + gcp.WRITE)}))
    found = gcp.discover(refresh=True)
    assert found.autoSelected
    assert (found.context.source, found.context.bucket) == (
        "discovered",
        f"{PROD}-data",
    )


def test_with_a_choice_to_make_nothing_is_chosen_for_you():
    use(FakeCloud(listable={OTHER: ["shared-results"]}))  # two writable buckets
    found = gcp.discover(refresh=True)
    assert not found.autoSelected and found.context.source == "unset"


def test_a_choice_already_made_is_left_alone():
    gcp.choose(DEV, f"{DEV}-data")
    use(FakeCloud(perms={f"{PROD}-data": set(gcp.READ + gcp.WRITE)}))
    found = gcp.discover(refresh=True)
    assert not found.autoSelected and found.context.bucket == f"{DEV}-data"


def test_project_search_failing_still_checks_the_known_projects():
    use(FakeCloud(search=RuntimeError("403 SERVICE_DISABLED: Resource Manager")))
    found = gcp.discover(refresh=True)
    assert "Could not list your projects" in found.notes[0]
    assert {p.id for p in found.projects} == {PROD, DEV}


def test_no_credentials_says_how_to_get_them():
    def broken():
        raise RuntimeError("Your default credentials were not found.")

    gcp._reset_for_tests(broken)
    found = gcp.discover(refresh=True)
    assert "application-default login" in found.notes[0]
    assert [p.id for p in found.projects] == [PROD, DEV]


def test_known_projects_can_be_configured(monkeypatch):
    monkeypatch.setenv("AASI_GCP_PROJECTS", f"{DEV}, not_a_project ,{PROD}")
    assert gcp.candidates() == [DEV, PROD]


def test_discovery_is_reused_for_a_while():
    calls = []

    class Counting(FakeCloud):
        def search_projects(self):
            calls.append(1)
            return []

    use(Counting())
    gcp.discover(refresh=True)
    gcp.discover()
    assert len(calls) == 1
    gcp.discover(refresh=True)
    assert len(calls) == 2


# --------------------------------------------------------------------------- #
# Everything follows the choice
# --------------------------------------------------------------------------- #
def test_routes(monkeypatch):
    monkeypatch.delenv("AASI_DERIVED_BUCKET", raising=False)
    use(FakeCloud())
    client = TestClient(create_app())
    assert client.get("/api/gcp").json()["source"] == "unset"
    assert client.get("/api/gcp/discover?refresh=true").json()["projects"]
    chosen = client.post("/api/gcp", json={"project": DEV, "bucket": f"{DEV}-data"})
    assert chosen.json()["bucket"] == f"{DEV}-data"
    assert client.post("/api/gcp", json={"bucket": "No!"}).status_code == 400
    assert client.post("/api/gcp/forget", json={}).json()["source"] == "unset"
    # Not from a form on another site: it has to be JSON.
    refused = client.post(
        "/api/gcp/forget", content="forget=1", headers={"content-type": "text/plain"}
    )
    assert refused.status_code == 422


def test_derived_panel_follows_the_choice(monkeypatch):
    monkeypatch.delenv("AASI_DERIVED_BUCKET", raising=False)
    derived._reset_for_tests()
    status = derived.status()
    assert not status.configured and "No GCP project" in status.detail
    built = []

    class Provider:
        def __init__(self):
            built.append((derived.project_id(), derived.bucket_name()))

        def list(self, prefix, limit):
            return derived.DerivedListing(
                bucket=derived.bucket_name(), prefix="", parent="", entries=[]
            )

    monkeypatch.setattr(derived, "GcsProvider", Provider)
    gcp.choose(PROD, f"{PROD}-data")
    assert derived.status().bucket == f"{PROD}-data"
    gcp.choose(DEV, f"{DEV}-data")
    assert derived.status().bucket == f"{DEV}-data"
    assert built == [(PROD, f"{PROD}-data"), (DEV, f"{DEV}-data")]


def test_prepare_writes_to_the_chosen_bucket(monkeypatch):
    monkeypatch.delenv("AASI_DERIVED_BUCKET", raising=False)
    monkeypatch.delenv("AASI_BASELINE_BUCKET", raising=False)
    monkeypatch.setenv("AASI_PRINCIPAL", "jane.doe@noaa.gov")
    client = TestClient(create_app())
    request = {
        "vessel": "Henry_B._Bigelow",
        "survey": "HB1603",
        "sonar": "EK60",
        "start": "2016-07-03T06:00:00",
        "end": "2016-07-03T07:00:00",
    }
    refused = client.post("/api/baseline/preview", json=request)
    assert refused.status_code == 400 and "choose a GCP project" in refused.text
    gcp.choose(PROD, f"{PROD}-data")
    preview = client.post("/api/baseline/preview", json=request).json()
    assert preview["destination"].startswith(f"gs://{PROD}-data/derived_products/")
    config = client.get("/api/baseline/config").json()
    assert (config["project"], config["bucketSource"]) == (PROD, "chosen")


def test_identity_reports_the_chosen_project(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "something-else-1")
    gcp.choose(DEV, f"{DEV}-data")
    assert identity.detect_project(refresh=True) == DEV


def test_the_ncei_cache_is_the_projects_own(monkeypatch):
    monkeypatch.setenv("AASI_NCEI_SOURCE", "cache")
    made = []

    class Cache:
        def __init__(self, project):
            made.append(project)

    monkeypatch.setattr(ncei, "CacheProvider", Cache)
    ncei.get_provider()
    gcp.choose(DEV, f"{DEV}-data")
    ncei.get_provider()
    ncei.get_provider()
    monkeypatch.setenv("AASI_NCEI_CACHE_PROJECT", "cache-project-1")
    ncei.get_provider()
    assert made == [PROD, DEV, "cache-project-1"]


def test_tools_are_told_the_chosen_project(tmp_path, monkeypatch):
    tool = tmp_path / "aa-env"
    tool.write_text(
        f"#!{sys.executable}\nimport os\n"
        "print(os.environ.get('AALIBRARY_GCP_PROJECT_ID', '-'),"
        " os.environ.get('GOOGLE_CLOUD_PROJECT', '-'),"
        " os.environ.get('AALIBRARY_GCP_BUCKET_NAME', '-'))\n"
    )
    tool.chmod(0o755)
    monkeypatch.setattr(jobs, "_bin_dir", lambda: tmp_path)
    # What aalibrary's import does to the server's own environment.
    monkeypatch.setenv("AALIBRARY_GCP_PROJECT_ID", PROD)
    jobs._reset_for_tests()
    gcp.choose(DEV, f"{DEV}-data")
    job = jobs.submit(jobs.JobRequest(tool="aa-env", args=[]))
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        status = jobs.status_of(job.id, since=0)
        if status and status.state in jobs.FINAL_STATES:
            break
        time.sleep(0.05)
    assert status.stdout[-1].split() == [DEV, DEV, f"{DEV}-data"]

    # A job keeps the project it was submitted with.
    pinned = jobs.submit(
        jobs.JobRequest(tool="aa-env", args=[]), gcp_env=gcp.tool_env()
    )
    gcp.choose(PROD, f"{PROD}-data")
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        status = jobs.status_of(pinned.id, since=0)
        if status and status.state in jobs.FINAL_STATES:
            break
        time.sleep(0.05)
    assert status.stdout[-1].split()[0] == DEV
