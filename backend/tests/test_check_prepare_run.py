"""scripts/check_prepare_run.py: the parts that read EK80 beam groups and records.

The whole check is rehearsed on a stand-in bucket; these pin down what EK60
synthetic data can't show: an EK80 EchoData with complex CW and power beam
groups, and which of them Sv is calibrated from.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")
xr = pytest.importorskip("xarray")
pytest.importorskip("zarr")
pytest.importorskip("aalibrary.console._core.provenance")

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "check_prepare_run.py"


@pytest.fixture
def check(tmp_path, monkeypatch):
    monkeypatch.setenv("AA_GCS_FAKE_ROOT", str(tmp_path / "gcs"))
    monkeypatch.delenv("AA_GCS_MOUNTS", raising=False)
    from aalibrary.console._core import uris

    uris._BACKEND = None
    uris.install_fake_fsspec()
    spec = importlib.util.spec_from_file_location("check_prepare_run", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.findings.clear()
    yield module
    uris._BACKEND = None


def _ek80_like(path: Path) -> None:
    """The Sonar layout echopype 0.11 writes for an EK80 file with complex
    CW channels and power channels."""
    sonar = xr.Dataset(
        {
            "beam_group_descr": ("beam_group", ["complex", "power"]),
            "waveform_encode_descr": ("beam_group_index", ["complex_CW", "power"]),
        },
        coords={
            "beam_group": ["Beam_group1", "Beam_group2"],
            "beam_group_index": [1, 2],
        },
    )
    xr.Dataset(attrs={"keywords": "EK80"}).to_zarr(path, mode="w")
    sonar.to_zarr(path, group="Sonar", mode="a")
    times = np.array(
        ["2021-10-12T14:10:16", "2021-10-12T14:10:17"], dtype="datetime64[ns]"
    )
    for name, channels, pings in (
        (
            "Beam_group1",
            ["WBT 1-1 ES38-7_ES", "WBT 2-1 ES70-7C_ES", "WBT 3-1 ES120-7C_ES"],
            times,
        ),
        ("Beam_group2", ["WBT 4-1 ES18_ES", "WBT 5-1 ES200-7C_ES"], times[:1]),
    ):
        xr.Dataset(
            {
                "backscatter_r": (
                    ("channel", "ping_time"),
                    np.zeros((len(channels), len(pings))),
                )
            },
            coords={"channel": channels, "ping_time": pings},
        ).to_zarr(path, group=f"Sonar/{name}", mode="a")


def test_beam_groups_of_an_ek80_file(check, tmp_path):
    store = tmp_path / "gcs" / "bkt" / "x" / "2107RL_CW-D20211012-T141016.zarr"
    _ek80_like(store)
    groups = check.beam_groups(
        check.Bucket(), "gs://bkt/x/2107RL_CW-D20211012-T141016.zarr"
    )
    assert [(g["name"], g["mode"], len(g["channels"]), g["pings"]) for g in groups] == [
        ("Beam_group1", "complex_CW", 3, 2),
        ("Beam_group2", "power", 2, 1),
    ]


def test_the_beam_group_sv_is_calibrated_from(check):
    assert (
        check.calibrated_mode({"waveform_mode": "CW", "encode_mode": "complex"}, "EK80")
        == "complex_CW"
    )
    assert (
        check.calibrated_mode({"waveform_mode": "BB", "encode_mode": "complex"}, "EK80")
        == "complex_FM"
    )
    assert (
        check.calibrated_mode({"waveform_mode": "CW", "encode_mode": "power"}, "EK80")
        == "power"
    )
    assert check.calibrated_mode({}, "EK60") == "power"


def test_raw_size_comes_from_the_record(check):
    assert check.raw_size({"sources": [{"id": "md5:ab12:1074426648"}]}) == 1074426648
    assert check.raw_size({"sources": [{"id": "gcs-gen:bkt/x#7"}]}) is None
    assert check.raw_size(None) is None


def test_channel_names_shorten_to_a_frequency_or_transducer(check):
    assert check._short("GPT   38 kHz 00907205c001-1 ES38B") == "38 kHz"
    assert check._short("WBT 545612-15 ES38-7_ES") == "ES38-7_ES"
