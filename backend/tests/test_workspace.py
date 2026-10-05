"""The working-space arithmetic and the questions asked of the machine."""

from __future__ import annotations

import os
import stat

import pytest

from aa_si_workbench.api import workspace

TABLE = """\
22 1 8:1 / / rw,relatime shared:1 - ext4 /dev/sda1 rw
40 22 0:35 / /tmp rw,nosuid shared:2 - tmpfs tmpfs rw
41 22 0:36 / /home/user/gcs rw,nosuid,nodev shared:3 - fuse.gcsfuse my-bucket rw
42 22 8:2 / /mnt/big\\040disk rw shared:4 - xfs /dev/sdb1 rw
"""


def test_the_mount_table_is_read_with_escapes():
    found = workspace.mounts(TABLE)
    assert [m.point for m in found] == ["/", "/tmp", "/home/user/gcs", "/mnt/big disk"]
    assert found[2].fstype == "fuse.gcsfuse" and found[2].source == "my-bucket"


def test_a_path_is_on_the_longest_mount_that_holds_it(tmp_path, monkeypatch):
    table = workspace.mounts(TABLE)
    monkeypatch.setattr(os.path, "realpath", lambda p: str(p))
    monkeypatch.setattr(workspace, "nearest_existing", lambda p: p)
    on = lambda p: workspace.mount_of(workspace.Path(p), table).fstype  # noqa: E731
    assert on("/home/user/gcs/runs") == "fuse.gcsfuse"
    assert on("/home/user/gcs-other") == "ext4"  # a prefix, not a parent
    assert on("/tmp/x") == "tmpfs"
    assert on("/mnt/big disk/aa") == "xfs"


def test_bucket_mounts_are_refused_and_memory_is_warned_about(tmp_path):
    gcs = workspace.Mount("/home/user/gcs", "fuse.gcsfuse", "b")
    tmpfs = workspace.Mount("/tmp", "tmpfs", "tmpfs")
    disk = workspace.Mount("/", "ext4", "/dev/sda1")
    assert "gcsfuse" in workspace.folder_problem(tmp_path, gcs)
    # tmpfs works (its size is checked like a disk's) but takes RAM.
    assert workspace.folder_problem(tmp_path, tmpfs) == ""
    assert "in memory" in workspace.folder_warning(tmp_path, tmpfs)
    assert workspace.folder_problem(tmp_path / "new" / "runs", disk) == ""
    assert workspace.folder_warning(tmp_path, disk) == ""


def test_an_unreadable_path_is_not_an_error(monkeypatch, tmp_path):
    real_exists = workspace.Path.exists

    def exists(self, *args, **kwargs):
        if "locked" in str(self):
            raise PermissionError(13, "Permission denied")
        return real_exists(self, *args, **kwargs)

    monkeypatch.setattr(workspace.Path, "exists", exists)
    inside = tmp_path / "locked" / "runs"
    assert workspace.nearest_existing(inside) == tmp_path
    assert workspace.disk_space(inside)[1] > 0


@pytest.mark.skipif(os.geteuid() == 0, reason="root may write anywhere")
def test_a_folder_without_permission_is_named(tmp_path):
    locked = tmp_path / "locked"
    locked.mkdir()
    locked.chmod(stat.S_IRUSR | stat.S_IXUSR)
    try:
        assert "no permission" in workspace.folder_problem(locked / "runs", None)
    finally:
        locked.chmod(stat.S_IRWXU)


def test_freeing_as_it_goes_keeps_only_the_largest_pair():
    raw = 1_000_000_000
    keep = workspace.space_needed(raw, single=False, sv=True, freeing=False)
    free = workspace.space_needed(raw, single=False, sv=True, freeing=True)
    m, e, s = workspace.MARGIN, workspace.ECHODATA_PER_RAW, workspace.SV_PER_RAW
    assert keep == int((1 + e + e + s) * raw * m)
    assert free == int((e + s) * raw * m)  # combined + Sv, while calibrating
    no_sv = workspace.space_needed(raw, single=False, sv=False, freeing=True)
    assert no_sv == int(2 * e * raw * m)  # per-file + combined, while combining
    one = workspace.space_needed(raw, single=True, sv=False, freeing=False)
    assert one == int((1 + e) * raw * m)
    assert workspace.space_needed(0, single=False, sv=True, freeing=True) == 0


def test_memory_depends_on_the_tools():
    assert workspace.memory_needed(10**9, 40, None) == 0
    assert workspace.memory_needed(10**9, 40, False) == 16 * 10**9
    streaming = workspace.memory_needed(10**9, 40, True)
    assert streaming == workspace.memory_needed(10**12, 40, True) < 2 * 10**9


def test_the_tools_are_asked_through_their_own_interpreter(tmp_path, monkeypatch):
    workspace._reset_for_tests()

    def python(answer: str, name: str):
        exe = tmp_path / name / "python3"
        exe.parent.mkdir()
        exe.write_text(f"#!/bin/sh\necho {answer}\n")
        exe.chmod(0o755)
        return exe

    def tool(name: str, head: str) -> str:
        script = tmp_path / name / "aa-combine"
        script.write_text(head + "import sys\n")
        return str(script)

    new, old, broken = python("1", "new"), python("0", "old"), python("Nope", "broken")
    assert workspace.tools_stream(tool("new", f"#!{new}\n")) is True
    assert workspace.tools_stream(tool("old", f"#!{old}\n")) is False
    assert workspace.tools_stream(tool("broken", f"#!{broken}\n")) is None

    # pip's launcher for long paths, and /usr/bin/env.
    sh = tool("new", f"#!/bin/sh\n'''exec' \"{new}\" \"$0\" \"$@\"\n' '''\n")
    assert workspace._interpreter(sh) == str(new)
    monkeypatch.setenv("PATH", f"{old.parent}:/usr/bin:/bin")
    env = tool("old", "#!/usr/bin/env python3\n")
    assert workspace._interpreter(env) == str(old)
    # Unclear: no answer rather than this process's own aalibrary.
    assert workspace._interpreter(tool("broken", "#!/bin/bash\n")) == ""
    workspace._reset_for_tests()
    assert workspace.tools_stream(str(tmp_path / "broken" / "aa-combine")) is None


def test_tree_bytes_and_human():
    assert workspace.human(999) == "999 B"
    assert workspace.human(1_500_000) == "1.5 MB"
    assert workspace.human(123_000_000_000) == "123 GB"


def test_tree_bytes_counts_files_and_survives_a_missing_folder(tmp_path):
    (tmp_path / "a").mkdir()
    (tmp_path / "a" / "x").write_bytes(b"12345")
    (tmp_path / "y").write_bytes(b"123")
    assert workspace.tree_bytes(tmp_path) == 8
    assert workspace.tree_bytes(tmp_path / "gone") == 0
