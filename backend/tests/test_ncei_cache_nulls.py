"""The BigQuery cache provider survives NULLs in the cache table.

NULLs come through pandas as None, NaN or NaT, and a NaN among the names made
sorting raise "'<' not supported between instances of 'str' and 'float'"
(seen live as a 502 when choosing a survey with --source cache).
"""

from __future__ import annotations

import math
import types

import pytest

from aa_si_workbench.api import ncei


@pytest.fixture()
def provider(monkeypatch):
    values = {
        "ship_name": ["Henry_B._Bigelow", math.nan, None],
        "survey_name": ["HB1603", math.nan],
        "echosounder_name": ["EK60", math.nan, "EK60", None, ""],
    }
    p = object.__new__(ncei.CacheProvider)
    p.project, p.table = "proj-1", "proj-1.metadata.ncei_cache"
    p._distinct = lambda column, where="", **params: values[column]
    monkeypatch.setattr(ncei, "_normalized", lambda vessel: vessel)
    return p


def test_nulls_are_dropped_from_name_lists(provider):
    assert [s.id for s in provider.list_sonars("Henry_B._Bigelow", "HB1603")] == [
        "EK60"
    ]
    assert [s.id for s in provider.list_surveys("Henry_B._Bigelow")] == ["HB1603"]
    assert [v.id for v in provider.list_vessels()] == ["Henry_B._Bigelow"]


def test_cache_values_treat_nan_and_nat_as_missing():
    assert ncei._iso_from_cache_value(math.nan) == ""
    assert ncei._iso_from_cache_value(None) == ""
    assert ncei._iso_from_cache_value("NaT") == ""
    assert ncei._iso_from_cache_value("2016-07-03 06:00:00") == "2016-07-03T06:00:00Z"


def test_raw_file_rows_with_nulls(provider):
    pd = pytest.importorskip("pandas")
    pytest.importorskip("google.cloud.bigquery")
    frame = pd.DataFrame(
        {
            "file_name": [
                "HB1603_L1-D20160703-T060000.raw",
                None,
                "HB1603_L1-D20160703-T062000.raw",
            ],
            "file_datetime": [pd.NaT, pd.NaT, "2016-07-03 06:20:00"],
            "file_size": [math.nan, 5.0, 123.0],
        }
    )

    class _Job:
        def result(self):
            return self

        def to_dataframe(self, **_):
            return frame

    seen = {}

    def query(sql, **_kwargs):
        seen["sql"] = sql
        return _Job()

    provider._bq = types.SimpleNamespace(query=query)
    files = provider.list_raw_files("Henry_B._Bigelow", "HB1603", "EK60")
    # The table is the project's own, not one project's name written in.
    assert "`proj-1.metadata.ncei_cache`" in seen["sql"]
    assert [f.name for f in files] == [
        "HB1603_L1-D20160703-T060000.raw",
        "HB1603_L1-D20160703-T062000.raw",
    ]
    assert files[0].sizeBytes == 0 and files[1].sizeBytes == 123
    assert files[0].acquiredAt.startswith("2016-07-03T06:00:00")  # from the name
    assert files[1].acquiredAt.startswith("2016-07-03T06:20:00")
