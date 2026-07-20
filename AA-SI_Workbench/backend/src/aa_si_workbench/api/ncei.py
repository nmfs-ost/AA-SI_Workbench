"""NCEI catalog endpoints.

These wrap the same `aalibrary` helpers that `aa-find` uses, so the Workbench
NCEI panel talks to the identical data. Two providers are available, chosen by
the ``AASI_NCEI_SOURCE`` environment variable:

  * ``s3``    (default) — lists the public ``noaa-wcsd-pds`` bucket anonymously
               via ``aalibrary.utils.ncei_utils``. Needs no credentials.
  * ``cache`` — queries the BigQuery ``metadata.ncei_cache`` table via
               ``aalibrary.utils.ncei_cache_utils``. Much faster and carries
               ``file_datetime`` directly, but needs GCP application-default
               credentials with BigQuery access.

Endpoints map one-to-one onto the frontend's ``NceiCatalogSource`` interface.
Both providers reuse `aalibrary`, so the backend must run in an environment where
`aalibrary` is importable (the same venv `aa-find` runs in).
"""

from __future__ import annotations

import os
import re
from collections.abc import Callable
from datetime import UTC, datetime
from functools import lru_cache
from typing import Protocol, TypeVar

from fastapi import APIRouter, HTTPException, Query

from .schemas import RawFile, SonarModel, Survey, Vessel

BUCKET = "noaa-wcsd-pds"
NCEI_CACHE_TABLE = "ggn-nmfs-aa-dev-1.metadata.ncei_cache"

_RAW_DT = re.compile(r"D(\d{8})-T(\d{6})")

T = TypeVar("T")


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #
def _display_name(ncei_name: str) -> str:
    """"Reuben_Lasker" -> "Reuben Lasker" for display; id keeps the raw form."""
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
        int(d[0:4]), int(d[4:6]), int(d[6:8]),
        int(t[0:2]), int(t[2:4]), int(t[4:6]),
        tzinfo=UTC,
    )
    return dt.isoformat().replace("+00:00", "Z")


def _iso_from_cache_value(value: object) -> str:
    """Normalize a BigQuery file_datetime (str or Timestamp) to ISO-8601 UTC."""
    if value is None:
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
    def list_channels(self, sonar_id: str) -> list[str]: ...


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

    def list_channels(self, sonar_id: str) -> list[str]:
        # Channel names live inside the raw/converted file config, not in the
        # S3 listing. Returning [] means "all channels" for aa-combine. See the
        # connecting-ncei guide for how to surface these later.
        return []


class CacheProvider:
    """Fast path backed by the BigQuery metadata.ncei_cache table (needs GCP)."""

    def __init__(self) -> None:
        from aalibrary.utils.cloud_utils import setup_gbq_client_objs

        self._bq = setup_gbq_client_objs()[0]

    def list_vessels(self) -> list[Vessel]:
        from aalibrary.utils import ncei_cache_utils

        names = ncei_cache_utils.get_all_ship_names_in_ncei_cache(
            normalize=False, gcp_bq_client=self._bq
        )
        return [Vessel(id=n, name=_display_name(n)) for n in sorted(set(names))]

    def list_surveys(self, vessel_id: str) -> list[Survey]:
        from aalibrary.utils import ncei_cache_utils

        names = ncei_cache_utils.get_all_survey_names_from_a_ship_in_ncei_cache(
            ship_name=vessel_id, gcp_bq_client=self._bq
        )
        return [
            Survey(id=n, name=n, vesselId=vessel_id, year=_year_from_survey(n))
            for n in sorted(set(names))
        ]

    def list_sonars(self, vessel_id: str, survey_id: str) -> list[SonarModel]:
        from aalibrary.utils import ncei_cache_utils

        names = ncei_cache_utils.get_all_echosounders_in_a_survey_in_ncei_cache(
            ship_name=vessel_id, survey_name=survey_id, gcp_bq_client=self._bq
        )
        return [SonarModel(id=n, name=n) for n in sorted(set(names))]

    def list_raw_files(
        self, vessel_id: str, survey_id: str, sonar_id: str
    ) -> list[RawFile]:
        from aalibrary.utils.helpers import normalize_ship_name

        ship_norm = normalize_ship_name(ship_name=vessel_id)
        # NOTE: `file_size` is assumed to exist in ncei_cache (the folder-size
        # cache implies it). If your column is named differently, adjust it here.
        query = f"""
            SELECT file_name, file_datetime, file_size
            FROM `{NCEI_CACHE_TABLE}`
            WHERE ship_name_normalized = @ship
              AND survey_name = @survey
              AND echosounder_name = @sonar
              AND file_type = 'raw'
            ORDER BY file_name ASC
        """
        # Parameterized to avoid SQL injection from path segments.
        from google.cloud import bigquery

        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("ship", "STRING", ship_norm),
                bigquery.ScalarQueryParameter("survey", "STRING", survey_id),
                bigquery.ScalarQueryParameter("sonar", "STRING", sonar_id),
            ]
        )
        df = self._bq.query(query, job_config=job_config).result().to_dataframe(
            create_bqstorage_client=False
        )
        files: list[RawFile] = []
        for _, row in df.iterrows():
            size = row.get("file_size")
            files.append(
                RawFile(
                    name=str(row["file_name"]),
                    sizeBytes=int(size) if size is not None else 0,
                    acquiredAt=_iso_from_cache_value(row.get("file_datetime")),
                )
            )
        return files

    def list_channels(self, sonar_id: str) -> list[str]:
        return []


@lru_cache(maxsize=1)
def get_provider() -> NceiProvider:
    """Construct (once) the provider selected by AASI_NCEI_SOURCE."""
    source = os.getenv("AASI_NCEI_SOURCE", "s3").lower()
    if source == "cache":
        return CacheProvider()
    return S3Provider()


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


@router.get("/channels", response_model=list[str])
def channels(sonar: str = Query(..., min_length=1)) -> list[str]:
    return _run(lambda: get_provider().list_channels(sonar))
