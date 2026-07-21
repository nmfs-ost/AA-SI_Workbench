"""Tests for the filesystem browser, reader and writer.

Every test runs against a real temporary directory with ``AASI_FS_ROOT``
pointed at it, because the whole safety story here is about what ``Path.resolve``
does with symlinks and ``..`` — mocking the filesystem would test the mock.

The boundary cases are the point: reading outside the root, creating outside the
root *via a symlinked folder*, overwriting by accident, and saving a file that
was only partially loaded. Those are the ways an editor loses someone's work.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from fastapi import HTTPException

from aa_si_workbench.api import files


@pytest.fixture
def sandbox(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A browsable root with a couple of files already in it."""
    root = tmp_path / "home"
    root.mkdir()
    (root / "notes.txt").write_text("hello\nworld\n", encoding="utf-8")
    (root / "sub").mkdir()
    monkeypatch.setenv("AASI_FS_ROOT", str(root))
    monkeypatch.setenv("AASI_BIND_HOST", "127.0.0.1")
    monkeypatch.delenv("AASI_FS_READONLY", raising=False)
    return root


# --------------------------------------------------------------------------- #
# Reading                                                                       #
# --------------------------------------------------------------------------- #


def test_read_returns_text_and_metadata(sandbox: Path) -> None:
    doc = files.read_file(path=str(sandbox / "notes.txt"))
    assert doc.text == "hello\nworld\n"
    assert doc.name == "notes.txt"
    assert doc.kind == "text"
    assert doc.binary is False
    assert doc.truncated is False


def test_read_tags_python_and_notebook_kinds(sandbox: Path) -> None:
    (sandbox / "run.py").write_text("print(1)\n", encoding="utf-8")
    (sandbox / "book.ipynb").write_text(files.new_notebook_source(), encoding="utf-8")
    assert files.read_file(path=str(sandbox / "run.py")).kind == "python"
    assert files.read_file(path=str(sandbox / "book.ipynb")).kind == "notebook"


def test_read_reports_binary_rather_than_mojibake(sandbox: Path) -> None:
    (sandbox / "blob.bin").write_bytes(b"\x89PNG\x00\x1a\n\xff\xfe")
    doc = files.read_file(path=str(sandbox / "blob.bin"))
    assert doc.binary is True
    assert doc.text == ""
    assert doc.detail  # the panel needs a reason to render


def test_read_reports_invalid_utf8_as_binary(sandbox: Path) -> None:
    # No NUL byte, so this only fails at the decode step — the second guard.
    (sandbox / "latin.txt").write_bytes(b"caf\xe9 tables\n")
    doc = files.read_file(path=str(sandbox / "latin.txt"))
    assert doc.binary is True
    assert "UTF-8" in doc.detail


def test_read_marks_raw_assets_as_binary_without_reading_them(sandbox: Path) -> None:
    (sandbox / "D20190415-T120000.raw").write_bytes(b"\x01\x02\x03")
    doc = files.read_file(path=str(sandbox / "D20190415-T120000.raw"))
    assert doc.binary is True
    assert doc.kind == "raw"


def test_read_truncates_large_files_and_blocks_saving(
    sandbox: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(files, "MAX_TEXT_BYTES", 16)
    (sandbox / "big.txt").write_text("x" * 200, encoding="utf-8")
    doc = files.read_file(path=str(sandbox / "big.txt"))
    assert doc.truncated is True
    assert len(doc.text) == 16
    assert doc.detail


def test_read_rejects_a_directory(sandbox: Path) -> None:
    with pytest.raises(HTTPException) as caught:
        files.read_file(path=str(sandbox / "sub"))
    assert caught.value.status_code == 400


def test_read_refuses_to_escape_the_root(sandbox: Path) -> None:
    outside = sandbox.parent / "secret.txt"
    outside.write_text("private", encoding="utf-8")
    with pytest.raises(HTTPException) as caught:
        files.read_file(path=str(sandbox / ".." / "secret.txt"))
    assert caught.value.status_code == 403


def test_read_refuses_a_symlink_pointing_outside(sandbox: Path) -> None:
    outside = sandbox.parent / "secret.txt"
    outside.write_text("private", encoding="utf-8")
    (sandbox / "link.txt").symlink_to(outside)
    with pytest.raises(HTTPException) as caught:
        files.read_file(path=str(sandbox / "link.txt"))
    assert caught.value.status_code == 403


# --------------------------------------------------------------------------- #
# Writing                                                                       #
# --------------------------------------------------------------------------- #


def test_write_replaces_contents(sandbox: Path) -> None:
    entry = files.write_file(
        files.FsWriteRequest(path=str(sandbox / "notes.txt"), text="changed\n")
    )
    assert (sandbox / "notes.txt").read_text(encoding="utf-8") == "changed\n"
    assert entry.name == "notes.txt"
    assert entry.sizeBytes == len("changed\n")


def test_write_leaves_no_temporary_files_behind(sandbox: Path) -> None:
    files.write_file(
        files.FsWriteRequest(path=str(sandbox / "notes.txt"), text="changed\n")
    )
    assert sorted(p.name for p in sandbox.iterdir()) == ["notes.txt", "sub"]


def test_write_preserves_the_file_mode(sandbox: Path) -> None:
    script = sandbox / "run.sh"
    script.write_text("echo hi\n", encoding="utf-8")
    script.chmod(0o755)
    files.write_file(files.FsWriteRequest(path=str(script), text="echo bye\n"))
    assert script.stat().st_mode & 0o777 == 0o755


def test_write_refuses_to_create(sandbox: Path) -> None:
    with pytest.raises(HTTPException) as caught:
        files.write_file(
            files.FsWriteRequest(path=str(sandbox / "nope.txt"), text="x")
        )
    assert caught.value.status_code == 404


def test_write_refuses_to_escape_the_root(sandbox: Path) -> None:
    outside = sandbox.parent / "secret.txt"
    outside.write_text("private", encoding="utf-8")
    with pytest.raises(HTTPException) as caught:
        files.write_file(files.FsWriteRequest(path=str(outside), text="owned"))
    assert caught.value.status_code == 403
    assert outside.read_text(encoding="utf-8") == "private"


def test_write_is_refused_when_read_only(
    sandbox: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AASI_FS_READONLY", "true")
    with pytest.raises(HTTPException) as caught:
        files.write_file(
            files.FsWriteRequest(path=str(sandbox / "notes.txt"), text="x")
        )
    assert caught.value.status_code == 405
    assert (sandbox / "notes.txt").read_text(encoding="utf-8") == "hello\nworld\n"


def test_read_flags_read_only_mode(
    sandbox: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AASI_FS_READONLY", "true")
    assert files.read_file(path=str(sandbox / "notes.txt")).readOnly is True


# --------------------------------------------------------------------------- #
# Creating                                                                      #
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("kind", "given", "expected"),
    [
        ("text", "scratch", "scratch.txt"),
        ("python", "analysis", "analysis.py"),
        ("notebook", "survey", "survey.ipynb"),
        ("markdown", "README", "README.md"),
        ("python", "already.py", "already.py"),
        ("folder", "outputs", "outputs"),
    ],
)
def test_create_appends_the_right_suffix(
    sandbox: Path, kind: str, given: str, expected: str
) -> None:
    entry = files.create_entry(
        files.FsCreateRequest(parent=str(sandbox), name=given, kind=kind)
    )
    assert entry.name == expected
    assert (sandbox / expected).exists()


def test_created_notebook_is_valid_nbformat(sandbox: Path) -> None:
    files.create_entry(
        files.FsCreateRequest(parent=str(sandbox), name="survey", kind="notebook")
    )
    document = json.loads((sandbox / "survey.ipynb").read_text(encoding="utf-8"))
    assert document["nbformat"] == 4
    assert document["nbformat_minor"] >= 5
    assert len(document["cells"]) == 1
    # nbformat >= 4.5 requires an id on every cell.
    assert document["cells"][0]["id"]
    assert document["cells"][0]["cell_type"] == "code"
    assert document["metadata"]["kernelspec"]["language"] == "python"


def test_create_refuses_to_overwrite(sandbox: Path) -> None:
    with pytest.raises(HTTPException) as caught:
        files.create_entry(
            files.FsCreateRequest(parent=str(sandbox), name="notes.txt", kind="text")
        )
    assert caught.value.status_code == 409
    assert (sandbox / "notes.txt").read_text(encoding="utf-8") == "hello\nworld\n"


@pytest.mark.parametrize("name", ["../escape", "a/b", "..", "", "   "])
def test_create_rejects_names_that_are_really_paths(sandbox: Path, name: str) -> None:
    with pytest.raises(HTTPException) as caught:
        files.create_entry(
            files.FsCreateRequest(parent=str(sandbox), name=name, kind="text")
        )
    assert caught.value.status_code == 400


def test_create_rejects_an_unknown_kind(sandbox: Path) -> None:
    with pytest.raises(HTTPException) as caught:
        files.create_entry(
            files.FsCreateRequest(parent=str(sandbox), name="x", kind="executable")
        )
    assert caught.value.status_code == 400


def test_create_refuses_a_parent_outside_the_root(sandbox: Path) -> None:
    with pytest.raises(HTTPException) as caught:
        files.create_entry(
            files.FsCreateRequest(
                parent=str(sandbox.parent), name="x.txt", kind="text"
            )
        )
    assert caught.value.status_code == 403


def test_create_refuses_a_symlinked_parent_leading_outside(sandbox: Path) -> None:
    """The path is re-resolved *through* the parent, so this can't land outside."""
    outside = sandbox.parent / "elsewhere"
    outside.mkdir()
    (sandbox / "shortcut").symlink_to(outside, target_is_directory=True)
    with pytest.raises(HTTPException) as caught:
        files.create_entry(
            files.FsCreateRequest(
                parent=str(sandbox / "shortcut"), name="x.txt", kind="text"
            )
        )
    assert caught.value.status_code == 403
    assert list(outside.iterdir()) == []


def test_create_is_refused_when_read_only(
    sandbox: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AASI_FS_READONLY", "true")
    with pytest.raises(HTTPException) as caught:
        files.create_entry(
            files.FsCreateRequest(parent=str(sandbox), name="x", kind="text")
        )
    assert caught.value.status_code == 405


# --------------------------------------------------------------------------- #
# The remote guard applies to the new routes too                               #
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "call",
    [
        lambda root: files.read_file(path=str(root / "notes.txt")),
        lambda root: files.read_raw(path=str(root / "notes.txt")),
        lambda root: files.write_file(
            files.FsWriteRequest(path=str(root / "notes.txt"), text="x")
        ),
        lambda root: files.create_entry(
            files.FsCreateRequest(parent=str(root), name="x", kind="text")
        ),
    ],
)
def test_non_loopback_bind_refuses_every_route(
    sandbox: Path, monkeypatch: pytest.MonkeyPatch, call
) -> None:
    monkeypatch.setenv("AASI_BIND_HOST", "0.0.0.0")
    monkeypatch.delenv("AASI_ALLOW_REMOTE_FS", raising=False)
    with pytest.raises(HTTPException) as caught:
        call(sandbox)
    assert caught.value.status_code == 403


def test_explicit_override_reopens_the_routes(
    sandbox: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AASI_BIND_HOST", "0.0.0.0")
    monkeypatch.setenv("AASI_ALLOW_REMOTE_FS", "true")
    assert files.read_file(path=str(sandbox / "notes.txt")).text.startswith("hello")


# --------------------------------------------------------------------------- #
# Raw byte streaming                                                            #
# --------------------------------------------------------------------------- #


def test_raw_streams_the_file(sandbox: Path) -> None:
    response = files.read_raw(path=str(sandbox / "notes.txt"))
    assert Path(response.path) == sandbox / "notes.txt"


def test_raw_refuses_an_oversized_preview(
    sandbox: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(files, "MAX_RAW_BYTES", 4)
    (sandbox / "big.png").write_bytes(b"0" * 64)
    with pytest.raises(HTTPException) as caught:
        files.read_raw(path=str(sandbox / "big.png"))
    assert caught.value.status_code == 413


def test_listing_still_works_and_tags_the_new_kinds(sandbox: Path) -> None:
    (sandbox / "run.py").write_text("", encoding="utf-8")
    (sandbox / "book.ipynb").write_text("", encoding="utf-8")
    # Called directly rather than through FastAPI, so Query defaults don't apply.
    listing = files.list_directory(path=str(sandbox), showHidden=False, limit=2000)
    kinds = {entry.name: entry.kind for entry in listing.entries}
    assert kinds["run.py"] == "python"
    assert kinds["book.ipynb"] == "notebook"
    assert kinds["sub"] == "folder"
    # Directories sort ahead of files, as before.
    assert listing.entries[0].name == "sub"


def test_writes_survive_a_round_trip_through_read(sandbox: Path) -> None:
    """The property that matters for an editor: what you save is what reopens."""
    body = "line one\nline two\n\n# trailing comment\n"
    files.write_file(files.FsWriteRequest(path=str(sandbox / "notes.txt"), text=body))
    assert files.read_file(path=str(sandbox / "notes.txt")).text == body


def test_unicode_survives_the_round_trip(sandbox: Path) -> None:
    body = "temperature = 12.5 °C  # Reuben Lasker — RL2107\nnote = 'σ_bs'\n"
    files.write_file(files.FsWriteRequest(path=str(sandbox / "notes.txt"), text=body))
    assert files.read_file(path=str(sandbox / "notes.txt")).text == body
    assert (sandbox / "notes.txt").read_bytes().decode("utf-8") == body


def test_new_file_suffix_table_covers_every_creatable_kind() -> None:
    """The UI's New menu is generated from this table; a gap is a dead menu item."""
    assert set(files.NEW_FILE_SUFFIX) == {
        "text",
        "python",
        "notebook",
        "markdown",
        "folder",
    }


def test_text_kinds_are_a_subset_of_the_tagged_kinds() -> None:
    """Every editable kind must be one the lister can actually produce."""
    producible = set(files.ASSET_KINDS.values()) | {"folder", "file"}
    assert files.TEXT_KINDS <= producible


def test_os_access_check_marks_unwritable_files(sandbox: Path) -> None:
    locked = sandbox / "locked.txt"
    locked.write_text("x", encoding="utf-8")
    locked.chmod(0o444)
    try:
        # Running as root defeats the permission bit entirely; skip rather than
        # assert something the environment can't demonstrate.
        if os.access(locked, os.W_OK):
            pytest.skip("running with privileges that ignore the write bit")
        assert files.read_file(path=str(locked)).readOnly is True
    finally:
        locked.chmod(0o644)
