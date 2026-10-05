"""NCEI catalog endpoints.

These wrap the same `aalibrary` helpers that `aa-find` uses, so the
Workbench's Prepare EchoData card plans from the identical data. Two providers
are available, chosen by the ``AASI_NCEI_SOURCE`` environment variable:

  * ``s3``    (default) — lists the public ``noaa-wcsd-pds`` bucket anonymously
               via ``aalibrary.utils.ncei_utils``. Needs no credentials.
  * ``cache`` — queries the BigQuery ``<project>.metadata.ncei_cache`` table
               of the project this user works in (gcp.py; the table aa-fetch
               downloads by). Much faster and carries ``file_datetime``
               directly, but needs GCP application-default credentials with
               BigQuery access.

Endpoints map one-to-one onto the frontend's ``NceiCatalogSource`` interface.
Both providers reuse `aalibrary`, so the backend must run in an environment where
`aalibrary` is importable (the same venv `aa-find` runs in).
"""

from __future__ import annotations

import os
import re
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Protocol, TypeVar

from fastapi import APIRouter, HTTPException, Query

from .schemas import RawFile, SonarModel, Survey, Vessel

BUCKET = "noaa-wcsd-pds"

_RAW_DT = re.compile(r"D(\d{8})-T(\d{6})")

T = TypeVar("T")


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #
def _display_name(ncei_name: str) -> str:
    """ "Reuben_Lasker" -> "Reuben Lasker" for display; id keeps the raw form."""
    return ncei_name.replace("_", " ").strip()


def _year_from_survey(survey: str) -> int:
    """Best-effort year from a survey id like "RL2107" -> 2021. 0 if unknown."""
    match = re.search(r"[A-Za-z]*?(\d{2})", survey)
    if not match:
        return 0
    yy = int(match.group(1))
    return 2000 + yy if yy < 70 else 1900 + yy


def _acquired_at_from_name(file_name: str) -> str:
    """Parse the D{YYYYMMDD}-T{HHMMSS} convention into an ISO-8601 UTC string."""
    match = _RAW_DT.search(file_name)
    if not match:
        return ""
    d, t = match.groups()
    dt = datetime(
        int(d[0:4]),
        int(d[4:6]),
        int(d[6:8]),
        int(t[0:2]),
        int(t[2:4]),
        int(t[4:6]),
        tzinfo=UTC,
    )
    return dt.isoformat().replace("+00:00", "Z")


def _present(value: object) -> bool:
    """False for the gaps a BigQuery column brings through pandas.

    A NULL arrives as None, NaN (a float) or NaT depending on the column type.
    Sorting a list with one of those among the names raises
    "'<' not supported between instances of 'str' and 'float'".
    """
    if value is None:
        return False
    try:
        if value != value:  # NaN and NaT are not equal to themselves
            return False
    except (TypeError, ValueError):
        pass
    return str(value).strip() not in ("", "nan", "NaN", "NaT", "None")


def _names(values: object) -> list[str]:
    """Distinct non-empty names, sorted; NULLs from the cache dropped."""
    return sorted({str(v).strip() for v in (values or []) if _present(v)})


def _iso_from_cache_value(value: object) -> str:
    """Normalize a BigQuery file_datetime (str or Timestamp) to ISO-8601 UTC."""
    if not _present(value):
        return ""
    text = str(value).strip().replace(" ", "T")
    if text and not text.endswith("Z") and "+" not in text:
        text += "Z"
    return text


# --------------------------------------------------------------------------- #
# Providers
# --------------------------------------------------------------------------- #
class NceiProvider(Protocol):
    def list_vessels(self) -> list[Vessel]: ...
    def list_surveys(self, vessel_id: str) -> list[Survey]: ...
    def list_sonars(self, vessel_id: str, survey_id: str) -> list[SonarModel]: ...
    def list_raw_files(
        self, vessel_id: str, survey_id: str, sonar_id: str
    ) -> list[RawFile]: ...


class S3Provider:
    """Anonymous listing of the public noaa-wcsd-pds bucket (no credentials)."""

    def __init__(self) -> None:
        from aalibrary.utils.cloud_utils import create_s3_objs

        # Anonymous (UNSIGNED) client/resource for the public NCEI bucket.
        self._client, self._resource, _ = create_s3_objs()

    def list_vessels(self) -> list[Vessel]:
        from aalibrary.utils import ncei_utils

        names = ncei_utils.get_all_ship_names_in_ncei(s3_client=self._client)
        return [Vessel(id=n, name=_display_name(n)) for n in sorted(names)]

    def list_surveys(self, vessel_id: str) -> list[Survey]:
        from aalibrary.utils import ncei_utils

        names = ncei_utils.get_all_survey_names_from_a_ship(
            ship_name=vessel_id, s3_client=self._client
        )
        return [
            Survey(id=n, name=n, vesselId=vessel_id, year=_year_from_survey(n))
            for n in sorted(names)
        ]

    def list_sonars(self, vessel_id: str, survey_id: str) -> list[SonarModel]:
        from aalibrary.utils import ncei_utils

        names = ncei_utils.get_all_echosounders_in_a_survey(
            ship_name=vessel_id, survey_name=survey_id, s3_client=self._client
        )
        return [SonarModel(id=n, name=n) for n in sorted(names)]

    def list_raw_files(
        self, vessel_id: str, survey_id: str, sonar_id: str
    ) -> list[RawFile]:
        # One paginated list_objects_v2 gets Key + Size together — far cheaper
        # than a HEAD per file for surveys with thousands of objects. Acquisition
        # time is parsed from the file-name convention.
        prefix = f"data/raw/{vessel_id}/{survey_id}/{sonar_id}/"
        files: list[RawFile] = []
        paginator = self._client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=BUCKET, Prefix=prefix):
            for obj in page.get("Contents", []):
                name = obj["Key"].rsplit("/", 1)[-1]
                if not name.endswith(".raw"):
                    continue
                files.append(
                    RawFile(
                        name=name,
                        sizeBytes=int(obj["Size"]),
                        acquiredAt=_acquired_at_from_name(name),
                    )
                )
        files.sort(key=lambda f: f.name)  # == chronological for D…-T… names
        return files


class CacheProvider:
    """Fast path backed by the BigQuery NCEI cache table (needs GCP).

    The table is ``<project>.metadata.ncei_cache`` in the project this user
    works in (gcp.py), the same table aa-fetch downloads by, so the card can
    never promise a file the fetch will not find. The queries are written
    here, parameterised, rather than borrowed from aalibrary, whose helpers
    name one project's table outright.
    """

    def __init__(self, project: str) -> None:
        from google.cloud import bigquery

        self.project = project
        self.table = f"{project}.metadata.ncei_cache"
        # Jobs run (and are billed) in the same project the table is in.
        self._bq = bigquery.Client(project=project, location="US")

    def _rows(self, sql: str, params: dict[str, str]):  # noqa: ANN202 - a DataFrame
        from google.cloud import bigquery

        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter(name, "STRING", value)
                for name, value in params.items()
            ]
        )
        return (
            self._bq.query(sql, job_config=job_config)
            .result()
            .to_dataframe(create_bqstorage_client=False)
        )

    def _distinct(self, column: str, where: str = "", **params: str) -> list:
        """The distinct values of *column*, NULLs included (see _names)."""
        sql = f"SELECT DISTINCT {column} AS value FROM `{self.table}`"
        if where:
            sql += f" WHERE {where}"
        return list(self._rows(sql, params)["value"])

    def list_vessels(self) -> list[Vessel]:
        return [
            Vessel(id=n, name=_display_name(n))
            for n in _names(self._distinct("ship_name"))
        ]

    def list_surveys(self, vessel_id: str) -> list[Survey]:
        names = self._distinct(
            "survey_name",
            "ship_name_normalized = @ship",
            ship=_normalized(vessel_id),
        )
        return [
            Survey(id=n, name=n, vesselId=vessel_id, year=_year_from_survey(n))
            for n in _names(names)
        ]

    def list_sonars(self, vessel_id: str, survey_id: str) -> list[SonarModel]:
        names = self._distinct(
            "echosounder_name",
            "ship_name_normalized = @ship AND survey_name = @survey",
            ship=_normalized(vessel_id),
            survey=survey_id,
        )
        return [SonarModel(id=n, name=n) for n in _names(names)]

    def list_raw_files(
        self, vessel_id: str, survey_id: str, sonar_id: str
    ) -> list[RawFile]:
        # The cache's size column is `size_bytes` (what aalibrary's
        # get_folder_prefix_size_in_ncei_cache sums); there is no `file_size`.
        sql = f"""
            SELECT file_name, file_datetime, size_bytes AS file_size
            FROM `{self.table}`
            WHERE ship_name_normalized = @ship
              AND survey_name = @survey
              AND echosounder_name = @sonar
              AND file_type = 'raw'
            ORDER BY file_name ASC
        """
        df = self._rows(
            sql,
            {"ship": _normalized(vessel_id), "survey": survey_id, "sonar": sonar_id},
        )
        files: list[RawFile] = []
        for _, row in df.iterrows():
            name = row.get("file_name")
            if not _present(name):
                continue
            size = row.get("file_size")
            # A NULL datetime falls back to the D{date}-T{time} in the name.
            when = _iso_from_cache_value(row.get("file_datetime"))
            files.append(
                RawFile(
                    name=str(name),
                    sizeBytes=int(size) if _present(size) else 0,
                    acquiredAt=when or _acquired_at_from_name(str(name)),
                )
            )
        return files


def _normalized(vessel_id: str) -> str:
    from aalibrary.utils.helpers import normalize_ship_name

    return normalize_ship_name(ship_name=vessel_id)


_providers: dict[tuple[str, str], NceiProvider] = {}


def get_provider() -> NceiProvider:
    """The provider AASI_NCEI_SOURCE selects, for the project in force."""
    source = os.getenv("AASI_NCEI_SOURCE", "s3").lower()
    if source == "cache":
        from .gcp import current

        key = ("cache", current().nceiCacheProject)
    else:
        key = ("s3", "")
    provider = _providers.get(key)
    if provider is None:
        provider = CacheProvider(key[1]) if key[0] == "cache" else S3Provider()
        _providers[key] = provider
    return provider


def _reset_for_tests() -> None:
    _providers.clear()


def _run(thunk: Callable[[], T]) -> T:
    """Run a provider call, converting backend failures into clean 502s."""
    try:
        return thunk()
    except Exception as exc:  # noqa: BLE001 - surface any backend error to client
        raise HTTPException(
            status_code=502, detail=f"NCEI backend error: {exc}"
        ) from exc


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
router = APIRouter(prefix="/api/ncei", tags=["ncei"])


@router.get("/vessels", response_model=list[Vessel])
def vessels() -> list[Vessel]:
    return _run(lambda: get_provider().list_vessels())


@router.get("/surveys", response_model=list[Survey])
def surveys(vessel: str = Query(..., min_length=1)) -> list[Survey]:
    return _run(lambda: get_provider().list_surveys(vessel))


@router.get("/sonars", response_model=list[SonarModel])
def sonars(
    vessel: str = Query(..., min_length=1),
    survey: str = Query(..., min_length=1),
) -> list[SonarModel]:
    return _run(lambda: get_provider().list_sonars(vessel, survey))


@router.get("/files", response_model=list[RawFile])
def files(
    vessel: str = Query(..., min_length=1),
    survey: str = Query(..., min_length=1),
    sonar: str = Query(..., min_length=1),
) -> list[RawFile]:
    return _run(lambda: get_provider().list_raw_files(vessel, survey, sonar))
