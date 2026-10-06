"""Calibration: what echopype will use for an EchoData, and ECS files to change it.

The values come from echopype itself (aa-ecs builds echopype's calibrator for
the EchoData, as compute_Sv does), per channel: the value in the file and the
value that will be used with a chosen ECS. Changing them writes a new ECS
product (aa-ecs --write: every channel, every value, an Echoview file echopype
and Echoview read), and calibrating with it is aa-sv --ecs: the ECS is an
input of the Sv, so its content is in the Sv's hash.

Asking about a large EchoData means fetching it once (into the tools' cache),
so a report is a tool call the panel follows rather than a request it waits on.
"""

from __future__ import annotations

import json
import re
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from . import products, toolcalls

router = APIRouter(prefix="/api/calibration", tags=["calibration"])

NAME_RE = re.compile(r"[A-Za-z0-9_-]{1,40}")


class ReportRequest(BaseModel):
    uri: str
    ecs: str = ""
    waveformMode: str = ""
    encodeMode: str = ""


class WriteRequest(BaseModel):
    #: The EchoData the values are for (their channels and the file's values).
    uri: str
    #: {"channels": [{"frequency": Hz, "values": {name: number}}]}
    values: dict[str, Any] = Field(default_factory=dict)
    #: Start from this ECS (values on top of it).
    ecs: str = ""
    label: str = "cal"
    dest: str = ""
    waveformMode: str = ""
    encodeMode: str = ""


class CalibrationFile(BaseModel):
    uri: str
    name: str
    productHash: str = ""
    createdAt: str = ""
    createdBy: str = ""
    label: str = ""


class CalibrationFiles(BaseModel):
    uri: str
    items: list[CalibrationFile] = Field(default_factory=list)
    destination: str = ""


def _echodata(uri: str) -> products.ProductInfo:
    info = products.info(uri)
    if not info.found:
        raise HTTPException(
            status_code=404, detail=info.detail or f"{uri} is not in the bucket."
        )
    if info.kind and info.kind != "echodata":
        if info.echodata:
            return products.info(info.echodata)
        raise HTTPException(
            status_code=400,
            detail="Calibration belongs to an EchoData; this product's record does "
            "not say "
            "which one it was made from.",
        )
    return info


def _modes(waveform: str, encode: str) -> list[str]:
    args = []
    if waveform:
        if waveform not in ("CW", "BB", "FM"):
            raise HTTPException(status_code=400, detail="waveformMode: CW, BB or FM.")
        args.append(f"--waveform_mode={waveform}")
    if encode:
        if encode not in ("complex", "power"):
            raise HTTPException(status_code=400, detail="encodeMode: complex or power.")
        args.append(f"--encode_mode={encode}")
    return args


def _ecs_arg(ecs: str) -> list[str]:
    if not ecs:
        return []
    info = products.info(ecs, history=False)
    if not info.found:
        raise HTTPException(status_code=404, detail=f"{ecs} is not in the bucket.")
    if not info.name.lower().endswith(".ecs"):
        raise HTTPException(status_code=400, detail="An ECS file (.ecs).")
    return [f"--ecs={info.uri}"]


def report(req: ReportRequest) -> toolcalls.Call:
    ed = _echodata(req.uri)
    args = [
        ed.uri,
        "--json",
        *_ecs_arg(req.ecs),
        *_modes(req.waveformMode, req.encodeMode),
    ]
    return toolcalls.start("aa-ecs", args, label=f"Calibration of {ed.name}")


def _check_values(values: dict) -> dict:
    channels = values.get("channels") if isinstance(values, dict) else None
    if not isinstance(channels, list) or not 1 <= len(channels) <= 64:
        raise HTTPException(
            status_code=400, detail="values.channels: one entry per channel."
        )
    clean = []
    for ch in channels:
        try:
            freq = float(ch["frequency"])
        except (KeyError, TypeError, ValueError):
            raise HTTPException(
                status_code=400, detail="Each channel needs its frequency (Hz)."
            ) from None
        vals = {}
        for name, value in (ch.get("values") or {}).items():
            if not re.fullmatch(r"[a-z_A-Z]{1,40}", str(name)):
                raise HTTPException(
                    status_code=400, detail=f"Not a parameter: {name!r}"
                )
            if value is None:
                continue
            try:
                number = float(value)
            except (TypeError, ValueError):
                raise HTTPException(
                    status_code=400, detail=f"{name}: a number."
                ) from None
            if number != number or number in (float("inf"), float("-inf")):
                raise HTTPException(status_code=400, detail=f"{name}: a finite number.")
            vals[str(name)] = number
        clean.append({"frequency": freq, "values": vals})
    return {"channels": clean}


def write(req: WriteRequest) -> toolcalls.Call:
    from .echogram import _destination
    from .pipelines import check_own_dest

    ed = _echodata(req.uri)
    label = req.label.strip() or "cal"
    if not NAME_RE.fullmatch(label):
        raise HTTPException(
            status_code=400, detail="A short label: letters, digits, - and _."
        )
    dest = check_own_dest(req.dest) or _destination(ed.uri)
    if not dest:
        raise HTTPException(
            status_code=409, detail="Choose a GCP project and bucket first."
        )
    values = _check_values(req.values)
    scratch = toolcalls.scratch_dir("ecs")
    (scratch / "values.json").write_text(json.dumps(values))
    args = [
        ed.uri,
        "--write",
        f"--values={scratch / 'values.json'}",
        f"--label={label}",
        f"--dest={dest}",
        *_ecs_arg(req.ecs),
        *_modes(req.waveformMode, req.encodeMode),
    ]
    return toolcalls.start(
        "aa-ecs",
        args,
        label=f"Write ECS for {ed.name}",
        want_json=False,
        scratch=scratch,
    )


def files(uri: str) -> CalibrationFiles:
    from .echogram import _destination

    ed = _echodata(uri)
    dest = _destination(ed.uri)
    out = CalibrationFiles(uri=ed.uri, destination=dest)
    seen: set[str] = set()
    for folder in dict.fromkeys(
        [products.folder_of(ed.uri), *([dest] if dest else [])]
    ):
        for entry in products.folder_entries(folder):
            if not entry.name.lower().endswith(".ecs") or entry.uri in seen:
                continue
            seen.add(entry.uri)
            out.items.append(
                CalibrationFile(
                    uri=entry.uri,
                    name=entry.name,
                    productHash=entry.productHash,
                    createdAt=entry.updatedAt,
                )
            )
    for item in out.items[:100]:
        doc = products.read_record(item.uri) or {}
        created = doc.get("created") or {}
        item.createdAt = str(created.get("at") or item.createdAt)
        item.createdBy = str(created.get("user") or "")
        item.label = str((doc.get("extra") or {}).get("label") or "")
    out.items.sort(key=lambda f: f.createdAt, reverse=True)
    return out


@router.post("/report", response_model=toolcalls.Call)
def post_report(req: ReportRequest) -> toolcalls.Call:
    return report(req)


@router.post("/write", response_model=toolcalls.Call)
def post_write(req: WriteRequest) -> toolcalls.Call:
    return write(req)


@router.get("/files", response_model=CalibrationFiles)
def get_files(uri: str = Query(..., min_length=6)) -> CalibrationFiles:
    return files(uri)
