"""Response schemas for the NCEI API.

Field names are camelCase so the JSON matches the frontend's TypeScript types
(`Vessel`, `Survey`, `SonarModel`, `RawFile`) verbatim — the frontend adapter
consumes these with no remapping.
"""

from __future__ import annotations

from pydantic import BaseModel


class Vessel(BaseModel):
    id: str  # exact NCEI ship folder, e.g. "Reuben_Lasker"
    name: str  # display form, e.g. "Reuben Lasker"


class Survey(BaseModel):
    id: str
    name: str
    vesselId: str
    year: int


class SonarModel(BaseModel):
    id: str  # echosounder name, e.g. "EK60"
    name: str


class RawFile(BaseModel):
    name: str  # e.g. "D20190415-T120000.raw"
    sizeBytes: int
    acquiredAt: str  # ISO 8601, UTC
