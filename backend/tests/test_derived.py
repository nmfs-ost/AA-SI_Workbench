"""Tests for the derived-assets browser.

There is no GCP access in CI, so these drive the route layer against a fake
provider and exercise the real ``GcsProvider`` against a stubbed
google-cloud-storage client. That covers the parts we actually wrote — delimiter
folding, prefix arithmetic, placeholder filtering and error translation — and
leaves only "do these credentials work" untested, which no unit test could
answer anyway.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi import HTTPException

from aa_si_workbench.api import derived


class _Blob:
    def __init__(self, name: str, size: int = 0, content_type: str = "") -> None:
        self.name = name
        self.size = size
        self.content_type = content_type
        self.updated = datetime(2026, 5, 1, 12, 0, tzinfo=UTC)


class _Iterator(list):
    """list_blobs returns an iterator that also carries `prefixes`."""

    def __init__(self, blobs: list[_Blob], prefixes: set[str]) -> None:
        super().__init__(blobs)
        self.prefixes = prefixes


class _FakeClient:
    """Enough of storage.Client for GcsProvider, with call recording."""

    def __init__(self, tree: dict[str, tuple[list[_Blob], set[str]]]) -> None:
        self.tree = tree
        self.calls: list[dict] = []

    def bucket(self, name: str) -> str:
        return name

    def list_blobs(self, bucket, prefix="", delimiter=None, max_results=None):
        self.calls.append(
            {"bucket": bucket, "prefix": prefix, "delimiter": delimiter}
        )
        blobs, prefixes = self.tree.get(prefix, ([], set()))
        return _Iterator(blobs[:max_results] if max_results else blobs, prefixes)


def _provider(monkeypatch: pytest.MonkeyPatch, tree: dict) -> derived.GcsProvider:
    """A GcsProvider wired to a fake client, bypassing __init__'s import."""
    provider = object.__new__(derived.GcsProvider)
    client = _FakeClient(tree)
    provider._client = client
    provider._bucket = derived.bucket_name()
    monkeypatch.setattr(derived, "_provider", provider)
    return provider


@pytest.fixture(autouse=True)
def _clean(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("AASI_DERIVED_PREFIX", raising=False)
    monkeypatch.setenv("AASI_DERIVED_BUCKET", "test-bucket")
    derived._reset_for_tests(None)
    yield
    derived._reset_for_tests(None)


# --------------------------------------------------------------------------- #
# Listing
# --------------------------------------------------------------------------- #
def test_folders_and_objects_are_separated(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = _provider(
        monkeypatch,
        {
            "": (
                [_Blob("README.txt", 12, "text/plain")],
                {"HB0905/", "SH1507/"},
            )
        },
    )
    listing = provider.list("", 100)
    names = [(e.name, e.isDir) for e in listing.entries]
    assert names == [("HB0905", True), ("SH1507", True), ("README.txt", False)]
    assert listing.bucket == "test-bucket"


def test_object_metadata_is_carried_through(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = _provider(
        monkeypatch,
        {
            "HB0905/": (
                [_Blob("HB0905/combined.nc", 5_242_880, "application/x-netcdf")],
                set(),
            )
        },
    )
    entry = provider.list("HB0905/", 100).entries[0]
    assert entry.name == "combined.nc"
    assert entry.path == "HB0905/combined.nc"
    assert entry.uri == "gs://test-bucket/HB0905/combined.nc"
    assert entry.kind == "netcdf"
    assert entry.sizeBytes == 5_242_880
    assert entry.updatedAt == "2026-05-01T12:00:00Z"


def test_directory_placeholder_objects_are_hidden(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = _provider(
        monkeypatch,
        {"HB0905/": ([_Blob("HB0905/"), _Blob("HB0905/sv.nc", 10)], set())},
    )
    names = [e.name for e in provider.list("HB0905/", 100).entries]
    assert names == ["sv.nc"], "the zero-byte folder marker should not be listed"


def test_parent_is_derived_from_the_prefix(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = _provider(monkeypatch, {})
    assert provider.list("", 10).parent == ""
    assert provider.list("HB0905/", 10).parent == ""
    assert provider.list("HB0905/EK60/", 10).parent == "HB0905/"


def test_root_prefix_is_stripped_from_displayed_paths(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AASI_DERIVED_PREFIX", "derived")
    provider = _provider(
        monkeypatch,
        {"derived/": ([_Blob("derived/a.nc", 1)], {"derived/HB0905/"})},
    )
    listing = provider.list("", 100)
    assert [e.path for e in listing.entries] == ["HB0905/", "a.nc"]
    # The gs:// URI keeps the real object name — that's what a pipeline needs.
    assert listing.entries[1].uri == "gs://test-bucket/derived/a.nc"
    assert provider._client.calls[0]["prefix"] == "derived/"


def test_listing_uses_delimiter_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = _provider(monkeypatch, {})
    provider.list("HB0905/", 10)
    assert provider._client.calls[0]["delimiter"] == "/", (
        "without a delimiter the whole bucket comes back flat"
    )


def test_truncation_is_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    blobs = [_Blob(f"f{i}.nc", 1) for i in range(5)]
    provider = _provider(monkeypatch, {"": (blobs, set())})
    assert provider.list("", 5).truncated is True
    assert provider.list("", 50).truncated is False


# --------------------------------------------------------------------------- #
# Routes and error translation
# --------------------------------------------------------------------------- #
def test_traversal_prefixes_are_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    _provider(monkeypatch, {})
    for bad in ["/abs", "../secrets", "a/../../b"]:
        with pytest.raises(HTTPException) as excinfo:
            derived.list_prefix(prefix=bad)
        assert excinfo.value.status_code == 400


def test_backend_failure_becomes_a_502_with_a_useful_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _Broken:
        def list(self, prefix: str, limit: int):
            raise RuntimeError("403 Forbidden: caller lacks permission")

    derived._reset_for_tests(_Broken())
    with pytest.raises(HTTPException) as excinfo:
        derived.list_prefix(prefix="")
    assert excinfo.value.status_code == 502
    assert "denied" in excinfo.value.detail


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (ImportError("no module"), "pip install google-cloud-storage"),
        (RuntimeError("Could not automatically determine credentials"), "gcloud auth"),
        (RuntimeError("403 Forbidden"), "denied"),
        (RuntimeError("404 bucket not found"), "not found"),
        (RuntimeError("serviceusage quota project missing"), "set-quota-project"),
    ],
)
def test_common_gcp_failures_get_actionable_messages(
    error: Exception, expected: str
) -> None:
    assert expected in derived._explain(error)


def test_status_reports_unavailable_instead_of_raising(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _Broken:
        def list(self, prefix: str, limit: int):
            raise RuntimeError("Could not automatically determine credentials")

    derived._reset_for_tests(_Broken())
    result = derived.status()
    assert result.available is False
    assert "gcloud auth" in result.detail
    assert result.consoleUrl.startswith("https://console.cloud.google.com/storage")


def test_status_reports_available_when_the_bucket_answers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _provider(monkeypatch, {"": ([], set())})
    result = derived.status()
    assert result.available is True
    assert result.detail == ""
    assert result.bucket == "test-bucket"
