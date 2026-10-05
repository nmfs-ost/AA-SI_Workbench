"""Shared test isolation."""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _own_settings(tmp_path_factory, monkeypatch):
    """Each test has its own settings folder (the saved GCP project choice
    lives there), so nothing reads or writes the real ~/.config, and a choice
    one test makes is not another test's starting point."""
    monkeypatch.setenv("AASI_CONFIG_DIR", str(tmp_path_factory.mktemp("config")))
    for name in (
        "AASI_GCP_PROJECT",
        "AASI_GCP_PROJECTS",
        "AASI_NCEI_CACHE_PROJECT",
        "AASI_DERIVED_BUCKET",
        "AASI_BASELINE_BUCKET",
        "AASI_NCEI_SOURCE",
    ):
        monkeypatch.delenv(name, raising=False)
    from aa_si_workbench.api import gcp, ncei

    # Discovery never reaches Google from a test: one that wants a cloud
    # brings its fake.
    gcp._reset_for_tests(_no_google)
    ncei._reset_for_tests()
    yield
    gcp._reset_for_tests(_no_google)
    ncei._reset_for_tests()


def _no_google():
    raise RuntimeError("Tests do not talk to Google.")
