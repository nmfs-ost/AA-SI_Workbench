"""Tests for principal detection and the capability *prediction*.

The most important assertion in this file is the dull one: `enforced` is False.
Everything else here decides what a button looks like; nothing here decides what
a user may do. A future change that made `enforced` True without adding a real
boundary would be a lie the UI would then repeat, so the value is pinned.

Detection is cached per process, so every test that cares clears the cache
rather than hoping about ordering.
"""

from __future__ import annotations

import pathlib
import subprocess

import pytest

from aa_si_workbench.api import identity

#: The real probe, captured before the autouse fixture stubs it out. The four
#: subprocess tests below need the genuine article; every other test needs it
#: gone, and those two requirements cannot both be met through the fixture.
_REAL_FROM_GCLOUD = identity._from_gcloud


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """No inherited config, and no cached answer from a previous test."""
    for name in (
        "AASI_PRINCIPAL",
        "AASI_PROJECT_MEMBERS",
        "AASI_FS_READONLY",
        "AALIBRARY_GCP_PROJECT_ID",
        # gcloud's own environment, which the suite must not inherit either:
        # a developer with CLOUDSDK_CORE_ACCOUNT exported would otherwise see
        # different results from CI for reasons nothing in the test says.
        "CLOUDSDK_CORE_ACCOUNT",
        "CLOUDSDK_CORE_PROJECT",
        "CLOUDSDK_ACTIVE_CONFIG_NAME",
        "CLOUDSDK_CONFIG",
        "GOOGLE_CLOUD_PROJECT",
        "GCLOUD_PROJECT",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(identity, "_cached", None)
    monkeypatch.setattr(identity, "_cached_project", None)
    # No probe may run in a test: gcloud might genuinely be installed on the
    # machine running this suite, the metadata server is a two-second timeout
    # on anything that isn't a GCE VM, and `_from_config_file` would read the
    # real ~/.config/gcloud of whoever is running the suite.
    monkeypatch.setattr(identity, "_from_gcloud", lambda: "")
    monkeypatch.setattr(identity, "_from_gcloud_auth_list", lambda: "")
    monkeypatch.setattr(identity, "_from_config_file", lambda key: "")
    monkeypatch.setattr(identity, "_from_metadata", lambda path="": "")


# --------------------------------------------------------------------------- #
# Detection                                                                     #
# --------------------------------------------------------------------------- #


def test_env_override_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AASI_PRINCIPAL", "ada@noaa.gov")
    monkeypatch.setattr(identity, "_from_gcloud", lambda: "someone-else@noaa.gov")
    assert identity.detect_principal(refresh=True) == ("ada@noaa.gov", "env")


def test_falls_back_to_gcloud(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(identity, "_from_gcloud", lambda: "ada@noaa.gov")
    assert identity.detect_principal(refresh=True) == ("ada@noaa.gov", "gcloud")


def test_falls_back_to_the_metadata_server(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        identity,
        "_from_metadata",
        lambda path="": "svc@project.iam.gserviceaccount.com"
        if "service-accounts" in path or not path
        else "",
    )
    principal, source = identity.detect_principal(refresh=True)
    assert source == "metadata"
    assert principal.startswith("svc@")


def test_gcloud_env_override_is_honoured(monkeypatch: pytest.MonkeyPatch) -> None:
    """CLOUDSDK_CORE_ACCOUNT beats probing, because gcloud itself obeys it."""
    monkeypatch.setenv("CLOUDSDK_CORE_ACCOUNT", "ada@noaa.gov")
    monkeypatch.setattr(identity, "_from_gcloud", lambda: "stale@noaa.gov")
    assert identity.detect_principal(refresh=True) == ("ada@noaa.gov", "env")


def test_gcloud_env_override_can_be_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLOUDSDK_CORE_ACCOUNT", "(unset)")
    assert identity.detect_principal(refresh=True) == ("", "unknown")


def test_application_default_login_is_found(monkeypatch: pytest.MonkeyPatch) -> None:
    """The case that made this endpoint report nobody for a signed-in user.

    `gcloud auth application-default login` never sets the `account` property,
    so `config get-value account` is empty while `auth list` shows them active.
    """
    monkeypatch.setattr(identity, "_from_gcloud", lambda: "")
    monkeypatch.setattr(identity, "_from_gcloud_auth_list", lambda: "ada@noaa.gov")
    assert identity.detect_principal(refresh=True) == ("ada@noaa.gov", "gcloud")


def test_config_file_is_read_when_gcloud_is_not_on_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Both subprocess probes fail; the configuration file still answers."""
    monkeypatch.setattr(identity, "_from_config_file", lambda key: {
        "account": "ada@noaa.gov",
    }.get(key, ""))
    assert identity.detect_principal(refresh=True) == ("ada@noaa.gov", "gcloud")


def test_config_file_probe_reads_the_real_file(
    tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`_from_config_file` against an actual gcloud config, not a stub."""
    monkeypatch.undo()
    config = tmp_path / "configurations" / "config_default"
    config.parent.mkdir(parents=True)
    config.write_text("[core]\naccount = ada@noaa.gov\nproject = some-project\n")
    monkeypatch.setenv("CLOUDSDK_CONFIG", str(tmp_path))
    assert identity._from_config_file("account") == "ada@noaa.gov"
    assert identity._from_config_file("project") == "some-project"


def test_config_file_probe_honours_the_active_configuration(
    tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.undo()
    root = tmp_path / "configurations"
    root.mkdir(parents=True)
    (root / "config_default").write_text("[core]\naccount = wrong@noaa.gov\n")
    (root / "config_survey").write_text("[core]\naccount = ada@noaa.gov\n")
    monkeypatch.setenv("CLOUDSDK_CONFIG", str(tmp_path))
    monkeypatch.setenv("CLOUDSDK_ACTIVE_CONFIG_NAME", "survey")
    assert identity._from_config_file("account") == "ada@noaa.gov"


def test_config_file_probe_survives_a_missing_or_broken_file(
    tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Absent, malformed and (unset) all mean 'this layer has no answer'."""
    monkeypatch.undo()
    monkeypatch.setenv("CLOUDSDK_CONFIG", str(tmp_path / "nothing-here"))
    assert identity._from_config_file("account") == ""

    config = tmp_path / "configurations" / "config_default"
    config.parent.mkdir(parents=True)
    config.write_text("this is not an ini file {{{")
    monkeypatch.setenv("CLOUDSDK_CONFIG", str(tmp_path))
    assert identity._from_config_file("account") == ""

    config.write_text("[core]\naccount = (unset)\n")
    assert identity._from_config_file("account") == ""


def test_probe_order_prefers_gcloud_over_the_file(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A running gcloud is authoritative: it resolves the active config itself."""
    monkeypatch.setattr(identity, "_from_gcloud", lambda: "live@noaa.gov")
    monkeypatch.setattr(identity, "_from_config_file", lambda key: "ondisk@noaa.gov")
    assert identity.detect_principal(refresh=True) == ("live@noaa.gov", "gcloud")


def test_unknown_is_a_real_answer(monkeypatch: pytest.MonkeyPatch) -> None:
    assert identity.detect_principal(refresh=True) == ("", "unknown")


def test_detection_is_cached_until_refreshed(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    def counted() -> str:
        calls.append(1)
        return "ada@noaa.gov"

    monkeypatch.setattr(identity, "_from_gcloud", counted)
    identity.detect_principal(refresh=True)
    identity.detect_principal()
    identity.detect_principal()
    assert len(calls) == 1

    identity.detect_principal(refresh=True)
    assert len(calls) == 2


def test_gcloud_unset_is_not_an_account(monkeypatch: pytest.MonkeyPatch) -> None:
    """`gcloud config get-value account` prints "(unset)" and exits 0.

    Taken literally that string becomes the principal and lands in the UI as
    though someone were signed in as an account called "(unset)".

    Calls `_REAL_FROM_GCLOUD` rather than `identity._from_gcloud`, because the
    autouse fixture has replaced the latter with a stub — patching the stub
    would test nothing.
    """

    def fake_run(*args: object, **kwargs: object) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(
            args=[], returncode=0, stdout="(unset)\n", stderr=""
        )

    monkeypatch.setattr(identity.subprocess, "run", fake_run)
    assert _REAL_FROM_GCLOUD() == ""


def test_gcloud_account_is_stripped(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run(*args: object, **kwargs: object) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(
            args=[], returncode=0, stdout="ada@noaa.gov\n", stderr=""
        )

    monkeypatch.setattr(identity.subprocess, "run", fake_run)
    assert _REAL_FROM_GCLOUD() == "ada@noaa.gov"


def test_missing_gcloud_is_not_an_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def explode(*args: object, **kwargs: object) -> None:
        raise FileNotFoundError("gcloud")

    monkeypatch.setattr(identity.subprocess, "run", explode)
    assert _REAL_FROM_GCLOUD() == ""


def test_a_hung_gcloud_is_not_an_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """The probe runs while the shell paints its first frame."""

    def timeout(*args: object, **kwargs: object) -> None:
        raise subprocess.TimeoutExpired(cmd="gcloud", timeout=identity._PROBE_TIMEOUT)

    monkeypatch.setattr(identity.subprocess, "run", timeout)
    assert _REAL_FROM_GCLOUD() == ""


# --------------------------------------------------------------------------- #
# The allowlist                                                                 #
# --------------------------------------------------------------------------- #


def test_no_allowlist_admits_everyone() -> None:
    assert identity.is_member("anyone@example.com", []) is True
    assert identity.is_member("", []) is True


def test_exact_address_matches() -> None:
    entries = ["ada@noaa.gov", "grace@noaa.gov"]
    assert identity.is_member("ada@noaa.gov", entries) is True
    assert identity.is_member("ADA@NOAA.GOV", entries) is True
    assert identity.is_member("mallory@example.com", entries) is False


def test_domain_entry_matches_the_whole_domain() -> None:
    assert identity.is_member("anyone@noaa.gov", ["@noaa.gov"]) is True
    assert identity.is_member("anyone@noaa.gov.example.com", ["@noaa.gov"]) is False
    assert identity.is_member("anyone@example.com", ["@noaa.gov"]) is False


def test_unknown_principal_is_not_a_member_of_a_configured_list() -> None:
    # "We could not tell who you are" does not read as "you are on the list".
    assert identity.is_member("", ["@noaa.gov"]) is False


def test_allowlist_parsing_tolerates_spacing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AASI_PROJECT_MEMBERS", " ada@noaa.gov , @noaa.gov ,, ")
    assert identity.allowlist() == ["ada@noaa.gov", "@noaa.gov"]


# --------------------------------------------------------------------------- #
# Capabilities                                                                  #
# --------------------------------------------------------------------------- #


def test_never_claims_to_enforce(monkeypatch: pytest.MonkeyPatch) -> None:
    """The load-bearing assertion of this module. See its docstring."""
    monkeypatch.setenv("AASI_PRINCIPAL", "ada@noaa.gov")
    monkeypatch.setenv("AASI_PROJECT_MEMBERS", "@nowhere.example")
    assert identity.get_identity(refresh=True).enforced is False


def test_read_only_removes_the_write_capabilities(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AASI_PRINCIPAL", "ada@noaa.gov")
    monkeypatch.setenv("AASI_FS_READONLY", "true")
    caps = identity.get_identity(refresh=True).capabilities
    assert caps.writeFiles is False
    assert caps.trashFiles is False


def test_non_member_loses_publish_but_keeps_the_filesystem(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Whose machine this is has already been answered by them being on it.

    Gating the local file browser on project membership would break the case of
    a colleague helping at someone else's desk, and would protect nothing —
    the terminal panel is right there.
    """
    monkeypatch.setenv("AASI_PRINCIPAL", "visitor@example.com")
    monkeypatch.setenv("AASI_PROJECT_MEMBERS", "@noaa.gov")
    result = identity.get_identity(refresh=True)

    assert result.member is False
    assert result.capabilities.publish is False
    assert result.capabilities.writeFiles is True
    assert result.capabilities.trashFiles is True


def test_member_keeps_everything(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AASI_PRINCIPAL", "ada@noaa.gov")
    monkeypatch.setenv("AASI_PROJECT_MEMBERS", "@noaa.gov")
    result = identity.get_identity(refresh=True)
    assert result.member is True
    assert result.restricted is True
    assert result.capabilities.publish is True


def test_unrestricted_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    """An allowlist that defaulted to closed would lock a scientist out of
    their own workstation over a missing environment variable."""
    monkeypatch.setenv("AASI_PRINCIPAL", "anyone@example.com")
    result = identity.get_identity(refresh=True)
    assert result.restricted is False
    assert result.member is True
    assert result.capabilities.publish is True


# --------------------------------------------------------------------------- #
# What the panel says                                                           #
# --------------------------------------------------------------------------- #


def test_detail_names_something_to_do_when_nobody_is_signed_in() -> None:
    result = identity.get_identity(refresh=True)
    assert result.principal == ""
    assert "gcloud auth login" in result.detail


def test_detail_explains_a_service_account(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        identity,
        "_from_metadata",
        lambda path="": "svc@project.iam.gserviceaccount.com"
        if "service-accounts" in path or not path
        else "",
    )
    detail = identity.get_identity(refresh=True).detail
    # The distinction that catches people out: the bucket grants are the
    # service account's, not theirs.
    assert "service account" in detail


def test_detail_says_a_refusal_is_local(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AASI_PRINCIPAL", "visitor@example.com")
    monkeypatch.setenv("AASI_PROJECT_MEMBERS", "@noaa.gov")
    detail = identity.get_identity(refresh=True).detail
    assert "AASI_PROJECT_MEMBERS" in detail
    assert "Workbench offering" in detail


def test_detail_leads_with_read_only(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AASI_PRINCIPAL", "ada@noaa.gov")
    monkeypatch.setenv("AASI_FS_READONLY", "1")
    detail = identity.get_identity(refresh=True).detail
    assert detail.startswith("This Workbench is read-only")


# --------------------------------------------------------------------------- #
# Project id                                                                    #
# --------------------------------------------------------------------------- #


def test_project_prefers_our_own_variable(monkeypatch: pytest.MonkeyPatch) -> None:
    """A deployment that pins the project keeps pinning it."""
    monkeypatch.setenv("AALIBRARY_GCP_PROJECT_ID", "pinned-project")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "ignored-project")
    assert identity.detect_project(refresh=True) == "pinned-project"


def test_project_reads_the_standard_variables(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "detected-project")
    assert identity.detect_project(refresh=True) == "detected-project"


def test_project_falls_back_to_the_gcloud_config(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(identity, "_from_config_file", lambda key: {
        "project": "configured-project",
    }.get(key, ""))
    assert identity.detect_project(refresh=True) == "configured-project"


def test_project_default_is_last_not_first(monkeypatch: pytest.MonkeyPatch) -> None:
    """The constant is a floor. Anything that can answer for itself wins."""
    assert identity.detect_project(refresh=True) == identity._DEFAULT_PROJECT
    monkeypatch.setattr(identity, "_from_config_file", lambda key: "real-project")
    assert identity.detect_project(refresh=True) == "real-project"


def test_project_does_not_probe_metadata_off_a_vm(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The metadata probe is a 2s timeout anywhere it isn't going to answer.

    It runs only when the principal already came from the metadata server,
    which is the only evidence available that one exists. This endpoint is
    called while the shell paints its first frame.
    """
    calls: list[str] = []

    def counted(path: str = "") -> str:
        calls.append(path)
        return "metadata-project"

    monkeypatch.setattr(identity, "_from_metadata", counted)

    assert identity.detect_project(source="gcloud", refresh=True) == (
        identity._DEFAULT_PROJECT
    )
    assert calls == []

    assert identity.detect_project(source="metadata", refresh=True) == (
        "metadata-project"
    )
    assert calls == ["project/project-id"]
