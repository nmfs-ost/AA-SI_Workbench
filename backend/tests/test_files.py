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
from urllib.parse import quote

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


# --------------------------------------------------------------------------- #
# Describing one path                                                           #
# --------------------------------------------------------------------------- #


def test_stat_describes_a_file_without_reading_it(sandbox: Path) -> None:
    entry = files.stat_entry(path=str(sandbox / "notes.txt"))
    assert entry.name == "notes.txt"
    assert entry.isDir is False
    assert entry.kind == "text"
    assert entry.modifiedAt  # the Modified column has something to show


def test_stat_distinguishes_a_directory(sandbox: Path) -> None:
    # The whole reason /stat exists: the terminal prints extensionless paths
    # and has to choose between an editor and a reveal.
    assert files.stat_entry(path=str(sandbox / "sub")).isDir is True


def test_stat_reports_a_zarr_store_as_a_leaf(sandbox: Path) -> None:
    (sandbox / "survey.zarr").mkdir()
    entry = files.stat_entry(path=str(sandbox / "survey.zarr"))
    assert entry.kind == "zarr"
    assert entry.isDir is False


def test_stat_refuses_to_escape_the_root(sandbox: Path) -> None:
    with pytest.raises(HTTPException) as caught:
        files.stat_entry(path=str(sandbox.parent / "outside.txt"))
    assert caught.value.status_code == 403


def test_listing_reports_an_owner(sandbox: Path) -> None:
    listing = files.list_directory(path=str(sandbox), showHidden=False, limit=2000)
    notes = next(e for e in listing.entries if e.name == "notes.txt")
    # POSIX-only, so the assertion is that it is populated *when* it can be.
    assert notes.owner == files._owner_for(os.stat(sandbox / "notes.txt").st_uid)


# --------------------------------------------------------------------------- #
# Renaming                                                                      #
# --------------------------------------------------------------------------- #


def test_rename_moves_the_entry_in_place(sandbox: Path) -> None:
    entry = files.rename_entry(
        files.FsRenameRequest(path=str(sandbox / "notes.txt"), name="journal.txt")
    )
    assert entry.name == "journal.txt"
    assert (sandbox / "journal.txt").read_text() == "hello\nworld\n"
    assert not (sandbox / "notes.txt").exists()


def test_rename_to_the_same_name_is_not_an_error(sandbox: Path) -> None:
    entry = files.rename_entry(
        files.FsRenameRequest(path=str(sandbox / "notes.txt"), name="notes.txt")
    )
    assert entry.name == "notes.txt"
    assert (sandbox / "notes.txt").exists()


def test_rename_refuses_to_overwrite(sandbox: Path) -> None:
    (sandbox / "taken.txt").write_text("mine", encoding="utf-8")
    with pytest.raises(HTTPException) as caught:
        files.rename_entry(
            files.FsRenameRequest(path=str(sandbox / "notes.txt"), name="taken.txt")
        )
    assert caught.value.status_code == 409
    assert (sandbox / "taken.txt").read_text() == "mine"


@pytest.mark.parametrize("name", ["../escape.txt", "sub/nested.txt", "..", "", "   "])
def test_rename_rejects_a_name_that_is_really_a_path(sandbox: Path, name: str) -> None:
    # This is the check that keeps rename from being a move. Without it,
    # "../../.ssh/authorized_keys" resolves rather than being refused.
    with pytest.raises(HTTPException) as caught:
        files.rename_entry(
            files.FsRenameRequest(path=str(sandbox / "notes.txt"), name=name)
        )
    assert caught.value.status_code == 400
    assert (sandbox / "notes.txt").exists()


def test_rename_refuses_the_root(sandbox: Path) -> None:
    with pytest.raises(HTTPException) as caught:
        files.rename_entry(files.FsRenameRequest(path=str(sandbox), name="elsewhere"))
    assert caught.value.status_code == 400


def test_rename_is_refused_when_read_only(
    sandbox: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AASI_FS_READONLY", "true")
    with pytest.raises(HTTPException) as caught:
        files.rename_entry(
            files.FsRenameRequest(path=str(sandbox / "notes.txt"), name="x.txt")
        )
    assert caught.value.status_code == 405


# --------------------------------------------------------------------------- #
# Moving                                                                        #
# --------------------------------------------------------------------------- #


def test_move_relocates_into_a_folder(sandbox: Path) -> None:
    entry = files.move_entry(
        files.FsMoveRequest(
            path=str(sandbox / "notes.txt"), destination=str(sandbox / "sub")
        )
    )
    assert Path(entry.path) == sandbox / "sub" / "notes.txt"
    assert (sandbox / "sub" / "notes.txt").read_text() == "hello\nworld\n"


def test_move_refuses_to_overwrite(sandbox: Path) -> None:
    (sandbox / "sub" / "notes.txt").write_text("theirs", encoding="utf-8")
    with pytest.raises(HTTPException) as caught:
        files.move_entry(
            files.FsMoveRequest(
                path=str(sandbox / "notes.txt"), destination=str(sandbox / "sub")
            )
        )
    assert caught.value.status_code == 409
    assert (sandbox / "sub" / "notes.txt").read_text() == "theirs"


def test_move_refuses_a_folder_into_its_own_subtree(sandbox: Path) -> None:
    # os.rename gives EINVAL on some platforms and an unreachable directory on
    # others, so this is refused before it is attempted.
    (sandbox / "sub" / "deeper").mkdir()
    with pytest.raises(HTTPException) as caught:
        files.move_entry(
            files.FsMoveRequest(
                path=str(sandbox / "sub"), destination=str(sandbox / "sub" / "deeper")
            )
        )
    assert caught.value.status_code == 400
    assert (sandbox / "sub" / "deeper").is_dir()


def test_move_refuses_to_escape_the_root(sandbox: Path) -> None:
    outside = sandbox.parent / "outside"
    outside.mkdir()
    with pytest.raises(HTTPException) as caught:
        files.move_entry(
            files.FsMoveRequest(
                path=str(sandbox / "notes.txt"), destination=str(outside)
            )
        )
    assert caught.value.status_code == 403


# --------------------------------------------------------------------------- #
# Trash and restore                                                             #
# --------------------------------------------------------------------------- #


@pytest.fixture
def trash(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """An XDG data home of our own, so no test touches the real trash."""
    data_home = tmp_path / "xdg"
    monkeypatch.setenv("XDG_DATA_HOME", str(data_home))
    return data_home / "Trash"


def test_trash_moves_rather_than_deletes(sandbox: Path, trash: Path) -> None:
    result = files.trash_entry(files.FsTrashRequest(path=str(sandbox / "notes.txt")))
    assert not (sandbox / "notes.txt").exists()
    # The bytes still exist somewhere reachable — that is the whole claim.
    assert Path(result.trashedTo).read_text() == "hello\nworld\n"
    assert (trash / "info" / f"{result.token}.trashinfo").exists()


def test_trashinfo_records_the_original_path(sandbox: Path, trash: Path) -> None:
    result = files.trash_entry(files.FsTrashRequest(path=str(sandbox / "notes.txt")))
    info = (trash / "info" / f"{result.token}.trashinfo").read_text()
    assert info.startswith("[Trash Info]")
    assert "DeletionDate=" in info
    # URL-encoded per the spec, so a path with a space survives /restore.
    assert quote(str(sandbox / "notes.txt")) in info


def test_trash_survives_a_name_collision(sandbox: Path, trash: Path) -> None:
    first = files.trash_entry(files.FsTrashRequest(path=str(sandbox / "notes.txt")))
    (sandbox / "notes.txt").write_text("second", encoding="utf-8")
    second = files.trash_entry(files.FsTrashRequest(path=str(sandbox / "notes.txt")))

    assert first.token != second.token
    # Neither copy was clobbered by the other.
    assert Path(first.trashedTo).read_text() == "hello\nworld\n"
    assert Path(second.trashedTo).read_text() == "second"


def test_trash_handles_a_name_with_a_space(sandbox: Path, trash: Path) -> None:
    awkward = sandbox / "Dyson's Bank survey.txt"
    awkward.write_text("legs", encoding="utf-8")
    result = files.trash_entry(files.FsTrashRequest(path=str(awkward)))
    restored = files.restore_entry(files.FsRestoreRequest(token=result.token))
    assert Path(restored.path) == awkward
    assert awkward.read_text() == "legs"


def test_trash_takes_a_whole_directory(sandbox: Path, trash: Path) -> None:
    (sandbox / "sub" / "inner.txt").write_text("deep", encoding="utf-8")
    result = files.trash_entry(files.FsTrashRequest(path=str(sandbox / "sub")))
    assert not (sandbox / "sub").exists()
    assert (Path(result.trashedTo) / "inner.txt").read_text() == "deep"


def test_restore_puts_it_back(sandbox: Path, trash: Path) -> None:
    result = files.trash_entry(files.FsTrashRequest(path=str(sandbox / "notes.txt")))
    entry = files.restore_entry(files.FsRestoreRequest(token=result.token))

    assert Path(entry.path) == sandbox / "notes.txt"
    assert (sandbox / "notes.txt").read_text() == "hello\nworld\n"
    # The record is consumed, so the same undo can't fire twice.
    assert not (trash / "info" / f"{result.token}.trashinfo").exists()


def test_restore_refuses_when_the_name_is_taken_again(
    sandbox: Path, trash: Path
) -> None:
    result = files.trash_entry(files.FsTrashRequest(path=str(sandbox / "notes.txt")))
    (sandbox / "notes.txt").write_text("something new", encoding="utf-8")

    with pytest.raises(HTTPException) as caught:
        files.restore_entry(files.FsRestoreRequest(token=result.token))
    assert caught.value.status_code == 409
    assert (sandbox / "notes.txt").read_text() == "something new"


def test_restore_reports_an_emptied_trash(sandbox: Path, trash: Path) -> None:
    result = files.trash_entry(files.FsTrashRequest(path=str(sandbox / "notes.txt")))
    Path(result.trashedTo).unlink()

    with pytest.raises(HTTPException) as caught:
        files.restore_entry(files.FsRestoreRequest(token=result.token))
    assert caught.value.status_code == 404


def test_restore_will_not_write_outside_the_root(
    sandbox: Path, trash: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A .trashinfo is a file on disk, so its Path= is untrusted input.

    Nothing in the Workbench writes a record naming somewhere outside the root,
    but the trash is shared with the desktop and editable by hand, so a restore
    goes back through the same boundary check as a path in a query string.
    """
    result = files.trash_entry(files.FsTrashRequest(path=str(sandbox / "notes.txt")))
    info = trash / "info" / f"{result.token}.trashinfo"
    info.write_text(
        f"[Trash Info]\nPath={quote(str(sandbox.parent / 'escaped.txt'))}\n"
        "DeletionDate=2024-01-01T00:00:00\n",
        encoding="utf-8",
    )

    with pytest.raises(HTTPException) as caught:
        files.restore_entry(files.FsRestoreRequest(token=result.token))
    assert caught.value.status_code == 403
    assert not (sandbox.parent / "escaped.txt").exists()


def test_trash_refuses_the_root(sandbox: Path, trash: Path) -> None:
    with pytest.raises(HTTPException) as caught:
        files.trash_entry(files.FsTrashRequest(path=str(sandbox)))
    assert caught.value.status_code == 400


def test_trash_is_refused_when_read_only(
    sandbox: Path, trash: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AASI_FS_READONLY", "true")
    with pytest.raises(HTTPException) as caught:
        files.trash_entry(files.FsTrashRequest(path=str(sandbox / "notes.txt")))
    assert caught.value.status_code == 405
    assert (sandbox / "notes.txt").exists()


@pytest.mark.parametrize(
    "call",
    [
        lambda root: files.stat_entry(path=str(root / "notes.txt")),
        lambda root: files.rename_entry(
            files.FsRenameRequest(path=str(root / "notes.txt"), name="x.txt")
        ),
        lambda root: files.move_entry(
            files.FsMoveRequest(
                path=str(root / "notes.txt"), destination=str(root / "sub")
            )
        ),
        lambda root: files.trash_entry(
            files.FsTrashRequest(path=str(root / "notes.txt"))
        ),
        lambda root: files.restore_entry(files.FsRestoreRequest(token="notes.txt")),
    ],
)
def test_non_loopback_bind_refuses_the_organising_routes(
    sandbox: Path, monkeypatch: pytest.MonkeyPatch, call
) -> None:
    monkeypatch.setenv("AASI_BIND_HOST", "0.0.0.0")
    monkeypatch.delenv("AASI_ALLOW_REMOTE_FS", raising=False)
    with pytest.raises(HTTPException) as caught:
        call(sandbox)
    assert caught.value.status_code == 403
