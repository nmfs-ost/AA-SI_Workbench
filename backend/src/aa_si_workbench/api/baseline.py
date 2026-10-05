"""The baseline operation: NCEI survey + time range -> EchoData asset in the bucket.

This is the first bookmark of the data lifecycle (Data Roadmap levels 0-2A):

    L0   aa-request   what to retrieve: vessel, survey, echosounder, time window
    L0   aa-fetch     retrieve those raw files from NCEI into a scratch folder
    L1   aa-ed        convert each .raw to EchoData (echopype NetCDF)
    L1   aa-combine   merge them, in time order, into ONE EchoData asset, with a
                      QC report, written straight to the bucket
    L2A  aa-sv        calibrate: Sv, beside it in the bucket          (optional)
    L2A  aa-graph     an echogram of that Sv                          (optional)
         aa-upload    the request document, kept with the products

Why a server-side runner and not a row of buttons
-------------------------------------------------
The NCEI panel's sequence strip runs one stage per click, and the user presses
"Run all" once per stage. That is right for a person exploring the tools and
wrong for this operation, whose whole point is that it is one well-defined act:
each stage consumes the path the previous one printed, and the chain must run
unattended for an hour without the browser tab staying open. So the chain runs
here, one job at a time through the ordinary job runner (every stage still
shows up in the Processing Queue, with its exact argv and its log), and the UI
only watches.

The console tools stay the auditable operations underneath. Nothing here does
science: every product is written by a tool, carries that tool's provenance,
and is named by the tools' own rule (``<base>.nc``, ``<base>_<recipe8>.nc``).

Which files
-----------
One file
--------
``aa-combine`` refuses a single input (a one-file "combine" is a copy). When
the range covers exactly one raw file, ``aa-ed`` converts it straight to the
asset's name in the bucket and the combine stage is skipped; the asset is the
same kind of product (L1 EchoData, sealed, provenance inside) under the same
name, as NetCDF.

The user asks for a time range; the source files are an implementation detail.
The UI resolves the range to the files that overlap it and sends their names
and the file-aligned window (first file's start .. last file's start). The
request document asks for exactly that window, and after the fetch the runner
checks that exactly those files arrived — so what the card promised is what
was combined, or the run stops and says which files are missing.

Working space
-------------
Raw files and the per-file EchoData live in a per-run scratch folder under
the working folder the card names (default ``AASI_RUN_ROOT``, itself
``~/aa-workbench-runs`` by default), with ``AA_CACHE_DIR`` pointed inside it so
the tools' staging and download cache land there too. On success the folder is
removed unless the user asked to keep it: it is this run's own working data,
never a user's file. On failure it is kept, because it is the evidence (less
what *Free space as it goes* had already deleted).

With tools that stream, memory no longer limits the length of a range; the
disk under that folder does. So the card shows where the folder is, how much
the range needs at most and how much is free (see workspace.py), and a run
that cannot fit is refused before it starts. *Free space as it goes* deletes
each kind of working file as soon as no later stage reads it (``frees_after``
names them, and the preview shows them, so the copied script does the same).
Each run reports the working space it actually used.
"""

from __future__ import annotations

import os
import re
import shutil
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from . import jobs, workspace

router = APIRouter(prefix="/api/baseline", tags=["baseline"])

#: The console tools this operation needs. `aa-metadata` only exists in the
#: provenance-aware release of aalibrary, which is also the release whose
#: tools accept gs:// outputs, so its absence is the tell for an old install.
REQUIRED_TOOLS = (
    "aa-request",
    "aa-fetch",
    "aa-ed",
    "aa-combine",
    "aa-sv",
    "aa-graph",
    "aa-upload",
    "aa-metadata",
)

#: Where products go, below the bucket. `{user}` is the signed-in account's
#: local part; the rest comes from the request.
PREFIX_TEMPLATE = "derived_products/{user}/{vessel}/{survey}/{base}/"

POLL_SECONDS = 1.0
_MAX_RUNS = 30


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


# --------------------------------------------------------------------------- #
# Wire models
# --------------------------------------------------------------------------- #
class EchogramOptions(BaseModel):
    vmin: float = -80
    vmax: float = -30
    decimate: int = 10
    cmap: str = "viridis"


class BaselineRequest(BaseModel):
    """What the pipeline card sends. Names are NCEI's own (folder ids)."""

    vessel: str = Field(min_length=1)  # e.g. Henry_B._Bigelow
    survey: str = Field(min_length=1)  # e.g. HB1603
    sonar: str = Field(min_length=1)  # e.g. EK60
    #: The range the user asked for (UTC, ISO 8601). Names the asset.
    start: str
    end: str
    #: The file-aligned window: first overlapping file's start .. last one's.
    #: Defaults to start/end when the UI could not resolve files.
    fetchFrom: str = ""
    fetchTo: str = ""
    #: The raw files the card showed. Checked against what the fetch delivered.
    expectedFiles: list[str] = Field(default_factory=list)
    base: str = ""  # default: <survey>_<sonar>_<from>-<to>
    bucket: str = ""  # default: the Derived panel's bucket
    prefix: str = ""  # default: PREFIX_TEMPLATE
    format: Literal["nc", "zarr"] = "nc"
    sv: bool = True
    echogram: bool = True
    gapSeconds: float = 900
    gapFactor: float = 6
    strict: bool = False
    keepLocal: bool = False
    echogramOptions: EchogramOptions = Field(default_factory=EchogramOptions)
    #: EK80 calibration needs both; echopype refuses EK80 Sv without them.
    #: Ignored for other echosounders.
    waveformMode: Literal["CW", "BB"] = "CW"
    encodeMode: Literal["complex", "power"] = "complex"
    #: Where the run's working files go, on this machine: an absolute path,
    #: or "" for the server's default (AASI_RUN_ROOT).
    workRoot: str = ""
    #: Delete each kind of working file once no later stage reads it.
    #: Off whenever keepLocal is on.
    freeAsYouGo: bool = True
    #: The raw files' total size as listed, for the working-space estimate.
    expectedBytes: int = Field(default=0, ge=0)


class ToolState(BaseModel):
    name: str
    present: bool


class BaselineConfig(BaseModel):
    bucket: str
    prefixTemplate: str
    user: str
    runRoot: str
    tools: list[ToolState]
    ready: bool
    problems: list[str]


class StagePreview(BaseModel):
    id: str
    label: str
    tool: str
    level: str
    description: str
    command: list[str]
    #: Working files deleted once this stage succeeds (free space as it
    #: goes): patterns relative to the run's folder; "**/" means any depth.
    frees: list[str] = Field(default_factory=list)


class Preview(BaseModel):
    base: str
    destination: str
    stages: list[StagePreview]
    assets: list[dict]
    #: The folder the run's own folder is made in.
    workRoot: str = ""


class Workspace(BaseModel):
    """What the card shows about where a run works, and whether it fits."""

    root: str
    defaultRoot: str
    exists: bool
    filesystem: str
    mountPoint: str
    freeBytes: int
    totalBytes: int
    rawBytes: int
    #: The most working space the run holds at once, as asked.
    needBytes: int
    #: The same, keeping everything / freeing as it goes.
    needKeepingBytes: int
    needFreeingBytes: int
    freeing: bool
    memoryBytes: int
    memoryNeedBytes: int
    #: Whether the installed aa-combine/aa-sv/aa-graph stream; None: unknown.
    streaming: bool | None
    #: Why a run cannot start here; '' when it can.
    problem: str = ""
    warnings: list[str] = Field(default_factory=list)


class WorkUsage(BaseModel):
    """The working space a run has used, as it goes."""

    root: str = ""
    needBytes: int = 0
    freeBytes: int = 0
    usedBytes: int = 0
    peakBytes: int = 0
    freedBytes: int = 0


class StageStatus(BaseModel):
    id: str
    label: str
    tool: str
    level: str
    description: str
    #: pending | running | done | failed | skipped | cancelled
    state: str = "pending"
    jobId: str = ""
    command: list[str] = Field(default_factory=list)
    #: What the stage printed: a path or a gs:// URI.
    output: str = ""
    #: One line about progress or outcome, e.g. "12 of 24 files".
    detail: str = ""
    done: int = 0
    total: int = 0
    startedAt: str = ""
    finishedAt: str = ""


class Asset(BaseModel):
    #: echodata | sv | echogram | request | report
    kind: str
    label: str
    uri: str
    level: str = ""


class RunStatus(BaseModel):
    id: str
    base: str
    #: running | succeeded | failed | cancelled
    state: str
    destination: str
    scratch: str
    stages: list[StageStatus]
    assets: list[Asset]
    error: str = ""
    notes: list[str] = Field(default_factory=list)
    createdAt: str
    finishedAt: str = ""
    request: BaselineRequest
    work: WorkUsage = Field(default_factory=WorkUsage)


# --------------------------------------------------------------------------- #
# Naming and addressing
# --------------------------------------------------------------------------- #
def _parse(value: str) -> datetime:
    text = str(value).strip().replace(" ", "T").rstrip("Z")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=f"Not a date-time: {value!r}"
        ) from exc
    return parsed.replace(tzinfo=None)


def default_base(req: BaselineRequest) -> str:
    """<survey>_<sonar>_<from>-<to>: which data, exactly, in one short name."""
    start, end = _parse(req.start), _parse(req.end)
    if end <= start:
        raise HTTPException(
            status_code=400, detail="The time range ends before it starts."
        )
    stamp = "%Y%m%dT%H%M%S"
    return f"{req.survey}_{req.sonar}_{start:{stamp}}-{end:{stamp}}"


def _clean_segment(text: str) -> str:
    """A path segment for a bucket key: what the user's script did to ship names."""
    return re.sub(r"[^A-Za-z0-9_.-]", "", text.replace(" ", "_")) or "unknown"


def detect_user() -> str:
    """The signed-in account's local part, for the per-user prefix."""
    try:
        from .identity import detect_principal

        principal, _source = detect_principal()
    except Exception:  # noqa: BLE001 - identity is best-effort here
        principal = ""
    local = (principal or "").split("@", 1)[0]
    return _clean_segment(local) if local else ""


def default_bucket() -> str:
    explicit = os.getenv("AASI_BASELINE_BUCKET", "").strip()
    if explicit:
        return explicit
    from .derived import bucket_name

    return bucket_name()


def run_root() -> Path:
    return Path(
        os.getenv("AASI_RUN_ROOT", str(Path.home() / "aa-workbench-runs"))
    ).expanduser()


def work_root(req: BaselineRequest) -> Path:
    """The folder a run's own folder is made in: the card's choice or the default."""
    text = req.workRoot.strip()
    if not text:
        return run_root()
    if "\x00" in text or "\n" in text:
        raise HTTPException(status_code=400, detail="Not a folder path.")
    try:
        path = Path(text).expanduser()
    except RuntimeError as exc:  # ~someone who does not exist
        raise HTTPException(
            status_code=400, detail=f"Not a folder path: {exc}"
        ) from exc
    if not path.is_absolute():
        raise HTTPException(
            status_code=400,
            detail=f"The working folder must be a full path (from /): {text!r}",
        )
    return Path(os.path.normpath(path))


def destination(req: BaselineRequest, base: str, user: str) -> str:
    bucket = (req.bucket or default_bucket()).strip().removeprefix("gs://").strip("/")
    if not bucket:
        raise HTTPException(status_code=400, detail="No bucket to write to.")
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]", bucket):
        raise HTTPException(status_code=400, detail=f"Not a bucket name: {bucket!r}")
    template = req.prefix.strip() or PREFIX_TEMPLATE
    try:
        prefix = template.format(
            user=user or "unknown-user",
            vessel=_clean_segment(req.vessel),
            survey=_clean_segment(req.survey),
            sonar=_clean_segment(req.sonar),
            base=base,
        ).strip("/")
    except (KeyError, IndexError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail=f"The prefix may use {{user}}, {{vessel}}, {{survey}}, {{sonar}} "
            f"and {{base}} only: {exc}",
        ) from exc
    if ".." in prefix.split("/"):
        raise HTTPException(status_code=400, detail="The prefix cannot contain '..'.")
    return f"gs://{bucket}/{prefix}/" if prefix else f"gs://{bucket}/"


# --------------------------------------------------------------------------- #
# The stages
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Stage:
    id: str
    label: str
    tool: str
    level: str
    description: str


STAGES: tuple[Stage, ...] = (
    Stage(
        "request",
        "Request",
        "aa-request",
        "L0",
        "Write the request: vessel, survey, echosounder and time window.",
    ),
    Stage(
        "fetch",
        "Fetch",
        "aa-fetch",
        "L0",
        "Download the raw files from NCEI into a scratch folder.",
    ),
    Stage(
        "convert",
        "Convert",
        "aa-ed",
        "L1",
        "Convert each raw file to EchoData (echopype NetCDF).",
    ),
    Stage(
        "combine",
        "Combine",
        "aa-combine",
        "L1",
        "Merge the files in time order into one EchoData asset, with a QC "
        "report, written to the bucket.",
    ),
    Stage(
        "sv",
        "Calibrate",
        "aa-sv",
        "L2A",
        "Compute Sv (volume backscattering strength) beside it.",
    ),
    Stage(
        "echogram",
        "Echogram",
        "aa-graph",
        "L2A",
        "Render an echogram of the Sv, named after it.",
    ),
    Stage(
        "record",
        "Record",
        "aa-upload",
        "",
        "Keep the request document with the products.",
    ),
)


@dataclass
class Context:
    """Everything the argv of each stage is built from."""

    req: BaselineRequest
    base: str
    dest: str
    scratch: Path
    outputs: dict[str, str] = field(default_factory=dict)
    #: Raw files the fetch delivered; before that, the card's count stands in.
    raw_count: int | None = None

    @property
    def single(self) -> bool:
        """One raw file: converted straight to the asset, no combine."""
        count = (
            self.raw_count
            if self.raw_count is not None
            else len(self.req.expectedFiles)
        )
        return count == 1

    @property
    def single_raw(self) -> str:
        found = sorted(self.raw_dir.glob("*.raw")) if self.raw_count else []
        if found:
            return str(found[0])
        name = self.req.expectedFiles[0] if self.req.expectedFiles else "<file>.raw"
        return str(self.raw_dir / name)

    @property
    def freeing(self) -> bool:
        """Free space as it goes: asked for, and nothing asked to be kept."""
        return self.req.freeAsYouGo and not self.req.keepLocal

    @property
    def request_doc(self) -> Path:
        return self.scratch / f"{self.base}.yaml"

    @property
    def raw_dir(self) -> Path:
        return self.scratch / "raw"

    @property
    def combined(self) -> str:
        fmt = "nc" if self.single else self.req.format
        return f"{self.dest}{self.base}.{fmt}"

    def output(self, stage: str, placeholder: str) -> str:
        return self.outputs.get(stage) or placeholder


def is_ek80(sonar: str) -> bool:
    """EK80-family data (EK80, and the WBT-based variants NCEI files under it)."""
    return "EK80" in sonar.upper()


def enabled(stage_id: str, req: BaselineRequest, single: bool = False) -> bool:
    if stage_id == "combine":
        return not single
    if stage_id == "sv":
        return req.sv
    if stage_id == "echogram":
        return req.sv and req.echogram
    return True


def request_window(req: BaselineRequest) -> tuple[str, str]:
    """The --from/--to aa-request is given: the file-aligned window, made safe.

    One file gives a window that starts and ends at the same instant, which
    aa-request rightly refuses; and an end of exactly 00:00:00 means "the
    whole of that day" to the NCEI query. One second later is the same files
    in both cases, and unambiguous.
    """
    start = _parse(req.fetchFrom or req.start)
    end = _parse(req.fetchTo or req.end)
    if end <= start or end.time() == datetime.min.time():
        end = max(end, start) + timedelta(seconds=1)
    stamp = "%Y-%m-%dT%H:%M:%S"
    return start.strftime(stamp), end.strftime(stamp)


def stage_args(stage_id: str, ctx: Context) -> list[str]:
    """argv[1:] for one stage. The preview and the run use this same function."""
    req = ctx.req
    if stage_id == "request":
        window = request_window(req)
        return [
            "--vessel",
            req.vessel,
            "--survey",
            req.survey,
            "--instrument",
            req.sonar,
            "--from",
            window[0],
            "--to",
            window[1],
            "-o",
            str(ctx.request_doc),
            "--force",
        ]
    if stage_id == "fetch":
        return [
            ctx.output("request", str(ctx.request_doc)),
            "-o",
            str(ctx.scratch),
            "-n",
            ctx.raw_dir.name,
        ]
    if stage_id == "convert":
        if ctx.single:
            # Not --quiet: its "reusing" line is how the card tells a reused
            # product from a new one.
            return [ctx.single_raw, "-o", ctx.combined, "--sonar_model", req.sonar]
        # A directory puts aa-ed in batch mode: every .raw converted in place,
        # the directory printed back for the next stage.
        return [
            ctx.output("fetch", str(ctx.raw_dir)),
            "--sonar_model",
            req.sonar,
            "--quiet",
        ]
    if stage_id == "combine":
        args = [
            "--workdir",
            ctx.output("convert", str(ctx.raw_dir)),
            "-o",
            ctx.combined,
            "--sort",
            "time",
            "--sonar_model",
            req.sonar,
            "--gap_seconds",
            f"{req.gapSeconds:g}",
            "--gap_factor",
            f"{req.gapFactor:g}",
            "--report",
            "--progress",
        ]
        if req.strict:
            args.append("--strict")
        return args
    if stage_id == "sv":
        args = [ctx.output("combine", ctx.combined), "--dest", ctx.dest]
        if is_ek80(req.sonar):
            args += [
                "--waveform_mode",
                req.waveformMode,
                "--encode_mode",
                req.encodeMode,
            ]
        return args
    if stage_id == "echogram":
        opts = req.echogramOptions
        return [
            ctx.output("sv", "<Sv from aa-sv>"),
            "--dest",
            ctx.dest,
            "--var",
            "Sv",
            "--decimate",
            str(opts.decimate),
            "--vmin",
            f"{opts.vmin:g}",
            "--vmax",
            f"{opts.vmax:g}",
            "--cmap",
            opts.cmap,
            "--figwidth",
            "14",
            "--rowheight",
            "3",
            "--dpi",
            "150",
        ]
    if stage_id == "record":
        return [ctx.output("request", str(ctx.request_doc)), ctx.dest]
    raise ValueError(stage_id)


def frees_after(stage_id: str, ctx: Context) -> list[str]:
    """Working files no later stage reads, deleted once *stage_id* succeeds.

    Patterns relative to the run's folder. The raw files are read only by
    the conversion; the per-file EchoData only by the combine; and the local
    copy of the combined EchoData (the tools keep what they upload in their
    cache, which is where aa-sv reads it) only by aa-sv. The Sv's own copy is
    what aa-graph reads, and goes with the folder at the end.
    """
    if not ctx.freeing:
        return []
    if stage_id == "convert":
        return ["raw/*.raw"]
    if stage_id == "combine" and not ctx.single:
        return ["raw/*.nc"]
    if stage_id == "sv":
        name = ctx.combined.rsplit("/", 1)[-1]
        return [f"cache/**/{name}"]
    return []


def _free(ctx: Context, patterns: list[str]) -> int:
    """Delete what *patterns* match inside the run's folder; bytes freed."""
    root = ctx.scratch.resolve()
    freed = 0
    for pattern in patterns:
        for path in sorted(ctx.scratch.glob(pattern)):
            try:
                resolved = path.resolve()
            except OSError:
                continue
            if resolved == root or root not in resolved.parents:
                continue  # never anything outside this run's own folder
            if path.is_dir() and not path.is_symlink():
                size = workspace.tree_bytes(path)
                shutil.rmtree(path, ignore_errors=True)
            else:
                try:
                    size = path.lstat().st_size
                    path.unlink()
                except OSError:
                    continue
            freed += size
    return freed


def planned_assets(ctx: Context) -> list[Asset]:
    req = ctx.req
    assets = [
        Asset(
            kind="echodata",
            label="EchoData" if ctx.single else "Combined EchoData",
            uri=ctx.combined,
            level="L1",
        )
    ]
    if not ctx.single:
        assets.append(
            Asset(kind="report", label="QC report", uri=f"{ctx.dest}{ctx.base}.qc.json")
        )
    if req.sv:
        assets.append(
            Asset(
                kind="sv",
                label="Sv (calibrated)",
                uri=f"{ctx.dest}{ctx.base}_<recipe>.nc",
                level="L2A",
            )
        )
        if req.echogram:
            assets.append(
                Asset(
                    kind="echogram",
                    label="Echogram",
                    uri=f"{ctx.dest}{ctx.base}_<recipe>.png",
                    level="L2A",
                )
            )
    assets.append(
        Asset(
            kind="request", label="Request document", uri=f"{ctx.dest}{ctx.base}.yaml"
        )
    )
    return assets


# --------------------------------------------------------------------------- #
# Runs
# --------------------------------------------------------------------------- #
@dataclass
class _Run:
    id: str
    ctx: Context
    stages: list[StageStatus]
    created_at: str = field(default_factory=_now)
    finished_at: str = ""
    state: str = "running"
    error: str = ""
    notes: list[str] = field(default_factory=list)
    assets: list[Asset] = field(default_factory=list)
    cancel_requested: bool = False
    current_job: str = ""
    work: WorkUsage = field(default_factory=WorkUsage)


_runs: dict[str, _Run] = {}
_lock = threading.RLock()


def _status(run: _Run) -> RunStatus:
    with _lock:
        return RunStatus(
            id=run.id,
            base=run.ctx.base,
            state=run.state,
            destination=run.ctx.dest,
            scratch=str(run.ctx.scratch),
            stages=[stage.model_copy() for stage in run.stages],
            assets=list(run.assets),
            error=run.error,
            notes=list(run.notes),
            createdAt=run.created_at,
            finishedAt=run.finished_at,
            request=run.ctx.req,
            work=run.work.model_copy(),
        )


def _count(directory: Path, pattern: str) -> int:
    try:
        return sum(1 for _ in directory.glob(pattern))
    except OSError:
        return 0


def _watch(stage: StageStatus, ctx: Context, total_raw: int) -> None:
    """Progress a job does not report itself, read off the scratch folder."""
    if stage.id == "fetch":
        stage.total = total_raw
        stage.done = _count(ctx.raw_dir, "*.raw")
        stage.detail = (
            f"{stage.done} of {stage.total} files"
            if stage.total
            else f"{stage.done} files"
        )
    elif stage.id == "convert" and not ctx.single:
        stage.total = _count(ctx.raw_dir, "*.raw")
        stage.done = _count(ctx.raw_dir, "*.nc")
        stage.detail = f"{stage.done} of {stage.total} files"


def _verify_fetch(ctx: Context) -> tuple[str, str]:
    """(error, note) comparing what arrived with what the card promised."""
    got = {p.name for p in ctx.raw_dir.glob("*.raw")}
    expected = set(ctx.req.expectedFiles)
    if not got:
        return (
            "aa-fetch finished but downloaded no .raw files. The NCEI metadata "
            "cache may not list this survey or window.",
            "",
        )
    if not expected:
        return "", f"{len(got)} raw files fetched."
    missing = sorted(expected - got)
    extra = sorted(got - expected)
    if missing:
        shown = ", ".join(missing[:4]) + (
            f" and {len(missing) - 4} more" if len(missing) > 4 else ""
        )
        return (
            f"aa-fetch delivered {len(got & expected)} of the {len(expected)} files "
            f"the time range covers. Missing: {shown}. NCEI's metadata cache "
            "(BigQuery) may not list them yet; the listing the card used is "
            "NCEI's S3 archive.",
            "",
        )
    note = f"{len(expected)} raw files fetched, as planned."
    if extra:
        # The request's window is file-aligned, so an extra file is one NCEI's
        # cache dates differently from its name. It is set aside, not
        # combined: the asset holds exactly what the card showed.
        aside = ctx.scratch / "outside-range"
        aside.mkdir(exist_ok=True)
        for name in extra:
            (ctx.raw_dir / name).rename(aside / name)
        note += (
            f" {len(extra)} other file(s) also arrived and were set aside, "
            "not combined: " + ", ".join(extra[:3]) + ("…" if len(extra) > 3 else "")
        )
    return "", note


#: Seconds between measurements of a run's folder while a stage runs.
MEASURE_SECONDS = 5.0


def _measure(run: _Run) -> None:
    """How much of the working space the run holds now, and at most so far."""
    used = workspace.tree_bytes(run.ctx.scratch)
    with _lock:
        run.work.usedBytes = used
        run.work.peakBytes = max(run.work.peakBytes, used)


def _finish(run: _Run, state: str, error: str = "") -> None:
    with _lock:
        run.state = state
        run.error = error
        run.finished_at = _now()
        if state == "cancelled":
            for stage in run.stages:
                if stage.state == "pending":
                    stage.state = "cancelled"


def _execute(run: _Run) -> None:
    """Run the stages; any failure of the runner itself ends the run, never hangs it."""
    try:
        _execute_stages(run)
    except Exception as exc:  # noqa: BLE001 - a run must always reach a final state
        detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
        with _lock:
            for stage in run.stages:
                if stage.state == "running":
                    stage.state = "failed"
        _finish(run, "failed", f"The runner stopped: {detail}")


def _execute_stages(run: _Run) -> None:
    ctx = run.ctx
    total_raw = len(ctx.req.expectedFiles)
    env = {"AA_CACHE_DIR": str(ctx.scratch / "cache")}
    for stage in run.stages:
        if run.cancel_requested:
            _finish(run, "cancelled")
            return
        if stage.state == "skipped":
            continue
        args = stage_args(stage.id, ctx)
        try:
            job = jobs.submit(
                jobs.JobRequest(
                    tool=stage.tool,
                    args=args,
                    cwd=str(ctx.scratch),
                    env=env,
                    label=f"{ctx.base} · {stage.label}",
                )
            )
        except HTTPException as exc:
            with _lock:
                stage.state = "failed"
                stage.detail = str(exc.detail)
            _finish(run, "failed", f"{stage.label}: {exc.detail}")
            return
        with _lock:
            stage.state = "running"
            stage.jobId = job.id
            stage.command = list(job.command)
            stage.startedAt = _now()
            run.current_job = job.id
            cancel_now = run.cancel_requested
        if cancel_now:
            # Asked between submit and here: post_cancel saw no job to stop.
            try:
                jobs.cancel(job.id)
            except HTTPException:
                pass

        measured = 0.0
        while True:
            status = jobs.status_of(job.id, since=10**9)
            if time.monotonic() - measured >= MEASURE_SECONDS:
                _measure(run)
                measured = time.monotonic()
            with _lock:
                _watch(stage, ctx, total_raw)
                if status and status.progress and status.progress.total:
                    stage.done = status.progress.done
                    stage.total = status.progress.total
                    stage.detail = (
                        f"{stage.done} of {stage.total} {status.progress.unit}".strip()
                    )
            if status is None or status.state in jobs.FINAL_STATES:
                break
            time.sleep(POLL_SECONDS)

        with _lock:
            stage.finishedAt = _now()
            run.current_job = ""
        _measure(run)
        if status is None or status.state != "succeeded":
            reason = ""
            if status is not None:
                reason = (
                    status.error
                    or status.verdict
                    or f"{status.state} (exit {status.exitCode})"
                )
            tail = jobs.tail_of(job.id, 6)
            with _lock:
                stage.state = "cancelled" if run.cancel_requested else "failed"
                stage.detail = reason
            if run.cancel_requested:
                _finish(run, "cancelled")
            else:
                message = f"{stage.label} ({stage.tool}) stopped: {reason}"
                if tail:
                    message += "\n" + "\n".join(tail)
                _finish(run, "failed", message)
            return

        output = status.stdout[-1].strip() if status.stdout else ""
        # A tool that found its product already made says "reusing" and does
        # nothing: the same inputs with the same settings are the same product.
        reused = any("reusing" in line for line in jobs.tail_of(job.id, 200))
        with _lock:
            stage.output = output
            stage.state = "done"
            ctx.outputs[stage.id] = output
            if stage.id not in ("fetch", "convert", "combine"):
                stage.detail = ""
            if reused and stage.id in ("combine", "sv", "echogram"):
                stage.detail = "Already in the bucket: reused, not recomputed."
        if stage.id == "fetch":
            error, note = _verify_fetch(ctx)
            with _lock:
                if note:
                    run.notes.append(note)
                stage.detail = note or stage.detail
            if error:
                with _lock:
                    stage.state = "failed"
                    stage.detail = error
                _finish(run, "failed", error)
                return
            with _lock:
                ctx.raw_count = _count(ctx.raw_dir, "*.raw")
                for other in run.stages:
                    if other.id == "combine":
                        other.state = "skipped" if ctx.single else "pending"
                        other.detail = (
                            (
                                "One file: converted straight to the bucket; "
                                "nothing to merge."
                            )
                            if ctx.single
                            else ""
                        )
        if stage.id == "convert" and ctx.single:
            with _lock:
                ctx.outputs["combine"] = output
                stage.detail = (
                    "Already in the bucket: reused, not recomputed."
                    if reused
                    else "Written to the bucket."
                )
        if stage.id == "combine" and not reused:
            with _lock:
                stage.detail = "Written to the bucket."
        patterns = frees_after(stage.id, ctx)
        if patterns:
            freed = _free(ctx, patterns)
            with _lock:
                run.work.freedBytes += freed
            _measure(run)

    # Everything the tools wrote, by the URIs they printed.
    assets = [
        Asset(
            kind="echodata",
            label="EchoData" if ctx.single else "Combined EchoData",
            uri=ctx.outputs.get("combine", ctx.combined),
            level="L1",
        )
    ]
    if not ctx.single:
        assets.append(
            Asset(kind="report", label="QC report", uri=f"{ctx.dest}{ctx.base}.qc.json")
        )
    if ctx.outputs.get("sv"):
        assets.append(
            Asset(
                kind="sv", label="Sv (calibrated)", uri=ctx.outputs["sv"], level="L2A"
            )
        )
    if ctx.outputs.get("echogram"):
        assets.append(
            Asset(
                kind="echogram",
                label="Echogram",
                uri=ctx.outputs["echogram"],
                level="L2A",
            )
        )
    if ctx.outputs.get("record"):
        assets.append(
            Asset(kind="request", label="Request document", uri=ctx.outputs["record"])
        )
    with _lock:
        run.assets = assets
        work = run.work
        line = f"Working space: {workspace.human(work.peakBytes)} at most"
        if work.needBytes:
            line += f" (estimated {workspace.human(work.needBytes)})"
        if work.freedBytes:
            line += f"; {workspace.human(work.freedBytes)} freed as it went"
        run.notes.append(line + ".")
    if not ctx.req.keepLocal:
        shutil.rmtree(ctx.scratch, ignore_errors=True)
        with _lock:
            run.notes.append(
                "Local scratch folder removed; the products are in the bucket."
            )
    else:
        with _lock:
            run.notes.append(f"Local working files kept in {ctx.scratch}.")
    _finish(run, "succeeded")


def _context(req: BaselineRequest, scratch: Path | None = None) -> Context:
    named = default_base(req)  # also checks the range
    base = req.base.strip() or named
    # The card's rule (plan.ts baseProblem): it names files and a folder.
    if base.startswith(".") or not re.fullmatch(r"[A-Za-z0-9_.+-]+", base):
        raise HTTPException(status_code=400, detail=f"Not a usable base name: {base!r}")
    user = detect_user()
    dest = destination(req, base, user)
    return Context(
        req=req, base=base, dest=dest, scratch=scratch or run_root() / f"{base}-preview"
    )


def workspace_report(req: BaselineRequest) -> Workspace:
    """Where the run would work, what it would need, and whether that fits."""
    root = work_root(req)
    single = len(req.expectedFiles) == 1
    freeing = req.freeAsYouGo and not req.keepLocal
    raw = req.expectedBytes
    need_keep = workspace.space_needed(raw, single=single, sv=req.sv, freeing=False)
    need_free = workspace.space_needed(raw, single=single, sv=req.sv, freeing=True)
    need = need_free if freeing else need_keep
    mount = workspace.mount_of(root)
    free, total = workspace.disk_space(root)
    try:
        tool = jobs.resolve_tool("aa-combine")
    except HTTPException:
        tool = ""
    streaming = workspace.tools_stream(tool) if tool else None
    memory = workspace.memory_total()
    memory_need = workspace.memory_needed(raw, len(req.expectedFiles), streaming)
    H = workspace.human

    problem = workspace.folder_problem(root, mount)
    warnings: list[str] = []
    if not problem and raw and free and need > free:
        problem = (
            f"This range needs about {H(need)} of working space at most, and "
            f"{root} has {H(free)} free."
        )
        if not freeing and need_free <= free and not req.keepLocal:
            problem += f" Free space as it goes needs about {H(need_free)}: turn it on."
        else:
            problem += " Choose a folder on a bigger disk, or a shorter range."
    if not problem and streaming is False and memory and memory_need:
        text = (
            f"The installed console tools hold the whole range in memory: about "
            f"{H(memory_need)} for this one, on a machine with {H(memory)}. "
            "aalibrary with the memory fix streams it instead (about 1 GB for any "
            "length)."
        )
        if memory_need > workspace.MEMORY_HEADROOM * memory:
            problem = text + " Update aalibrary, or choose a shorter range."
        else:
            warnings.append(text)
    caution = workspace.folder_warning(root, mount)
    if caution and not problem:
        warnings.append(caution)
    return Workspace(
        root=str(root),
        defaultRoot=str(run_root()),
        exists=workspace.is_dir(root),
        filesystem=mount.fstype if mount else "",
        mountPoint=mount.point if mount else "",
        freeBytes=free,
        totalBytes=total,
        rawBytes=raw,
        needBytes=need,
        needKeepingBytes=need_keep,
        needFreeingBytes=need_free,
        freeing=freeing,
        memoryBytes=memory,
        memoryNeedBytes=memory_need,
        streaming=streaming,
        problem=problem,
        warnings=warnings,
    )


def _device(path: Path) -> int | None:
    try:
        return os.stat(workspace.nearest_existing(path)).st_dev
    except OSError:
        return None


def _still_needed_on(root: Path) -> int:
    """Working space running runs on *root*'s file system have yet to take."""
    device = _device(root)
    if device is None:
        return 0
    with _lock:
        running = [
            (Path(run.work.root), run.work.needBytes - run.work.usedBytes)
            for run in _runs.values()
            if run.state == "running" and run.work.root and run.work.needBytes
        ]
    return sum(max(0, left) for where, left in running if _device(where) == device)


def _tool_states() -> list[ToolState]:
    states = []
    for name in REQUIRED_TOOLS:
        try:
            jobs.resolve_tool(name)
            present = True
        except HTTPException:
            present = False
        states.append(ToolState(name=name, present=present))
    return states


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@router.get("/config", response_model=BaselineConfig)
def get_config() -> BaselineConfig:
    tools = _tool_states()
    missing = [tool.name for tool in tools if not tool.present]
    problems = []
    if "aa-metadata" in missing:
        problems.append(
            "The installed aalibrary predates the provenance-aware console tools "
            "(no aa-metadata). Install the updated aalibrary, then restart the "
            "Workbench."
        )
    others = [name for name in missing if name != "aa-metadata"]
    if others:
        problems.append(f"Not installed in this environment: {', '.join(others)}.")
    user = detect_user()
    return BaselineConfig(
        bucket=default_bucket(),
        prefixTemplate=PREFIX_TEMPLATE,
        user=user,
        runRoot=str(run_root()),
        tools=tools,
        ready=not problems,
        problems=problems,
    )


@router.post("/preview", response_model=Preview)
def post_preview(req: BaselineRequest) -> Preview:
    """The exact argv each stage would run, before anything runs."""
    root = work_root(req)
    ctx = _context(req, scratch=root / "<run>")
    stages = [
        StagePreview(
            id=s.id,
            label=s.label,
            tool=s.tool,
            level=s.level,
            description=s.description,
            command=[s.tool, *stage_args(s.id, ctx)],
            frees=frees_after(s.id, ctx),
        )
        for s in STAGES
        if enabled(s.id, req, ctx.single)
    ]
    return Preview(
        base=ctx.base,
        destination=ctx.dest,
        stages=stages,
        assets=[a.model_dump() for a in planned_assets(ctx)],
        workRoot=str(root),
    )


@router.post("/workspace", response_model=Workspace)
def post_workspace(req: BaselineRequest) -> Workspace:
    """Where a run of this request would work, and whether it would fit."""
    return workspace_report(req)


@router.post("/runs", response_model=RunStatus)
def post_run(req: BaselineRequest) -> RunStatus:
    missing = [tool.name for tool in _tool_states() if not tool.present]
    if missing:
        raise HTTPException(
            status_code=409, detail=f"Missing console tools: {', '.join(missing)}."
        )
    run_id = uuid.uuid4().hex[:10]
    base_ctx = _context(req)
    # Build every stage's argv now, as the preview does, so a request that
    # cannot run is refused here with a 400 instead of failing in the thread.
    for stage in STAGES:
        if enabled(stage.id, req, base_ctx.single):
            stage_args(stage.id, base_ctx)
    # Refused here, not an hour in: a folder that cannot be used, a range
    # that cannot fit in it, or tools that would hold it all in memory.
    report = workspace_report(req)
    if report.problem:
        raise HTTPException(status_code=409, detail=report.problem)
    # Runs already going in the same file system will still take what they
    # have not used yet of their own estimate.
    others = _still_needed_on(Path(report.root))
    if report.rawBytes and others and report.needBytes + others > report.freeBytes:
        H = workspace.human
        raise HTTPException(
            status_code=409,
            detail=(
                f"This range needs about {H(report.needBytes)} of working space, and "
                f"runs already going in the same place will still take about "
                f"{H(others)} of the {H(report.freeBytes)} free there. Wait for them "
                "to finish, or choose a folder on another disk."
            ),
        )
    scratch = Path(report.root) / f"{base_ctx.base}-{run_id}"
    try:
        scratch.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise HTTPException(
            status_code=409, detail=f"Cannot make the working folder {scratch}: {exc}"
        ) from exc
    ctx = Context(req=req, base=base_ctx.base, dest=base_ctx.dest, scratch=scratch)
    stages = [
        StageStatus(
            id=s.id,
            label=s.label,
            tool=s.tool,
            level=s.level,
            description=s.description,
            state="pending" if enabled(s.id, req, ctx.single) else "skipped",
        )
        for s in STAGES
    ]
    run = _Run(id=run_id, ctx=ctx, stages=stages)
    run.work = WorkUsage(
        root=report.root, needBytes=report.needBytes, freeBytes=report.freeBytes
    )
    with _lock:
        _runs[run_id] = run
        if len(_runs) > _MAX_RUNS:
            for old in [
                key for key, value in _runs.items() if value.state != "running"
            ][: len(_runs) - _MAX_RUNS]:
                del _runs[old]
    threading.Thread(
        target=_execute, args=(run,), daemon=True, name=f"baseline-{run_id}"
    ).start()
    return _status(run)


@router.get("/runs", response_model=list[RunStatus])
def get_runs() -> list[RunStatus]:
    with _lock:
        runs = list(_runs.values())
    return [_status(run) for run in runs]


@router.get("/runs/{run_id}", response_model=RunStatus)
def get_run(run_id: str) -> RunStatus:
    with _lock:
        run = _runs.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"No run {run_id}.")
    return _status(run)


@router.post("/runs/{run_id}/cancel", response_model=RunStatus)
def post_cancel(run_id: str) -> RunStatus:
    with _lock:
        run = _runs.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail=f"No run {run_id}.")
        if run.state != "running":
            raise HTTPException(status_code=409, detail="That run is not running.")
        run.cancel_requested = True
        job_id = run.current_job
    if job_id:
        try:
            jobs.cancel(job_id)
        except HTTPException:
            pass
    return _status(run)


# --------------------------------------------------------------------------- #
# Provenance of a product (for the Metadata panel)
# --------------------------------------------------------------------------- #
class Provenance(BaseModel):
    uri: str
    found: bool
    document: dict | None = None
    verified: bool | None = None
    message: str = ""


#: Above this, a product with no provenance sidecar is not downloaded just to
#: read its provenance (products made before sidecars existed).
_PROVENANCE_DOWNLOAD_LIMIT = 200 * 1024 * 1024


def _without_sidecar_and_large(uri: str) -> str:
    """Why reading this product's provenance would mean a big download, or ''."""
    if not uri.startswith("gs://"):
        return ""
    try:
        from aalibrary.console._core import uris

        if uris.stat(uri.rstrip("/") + ".aa.json") is not None:
            return ""
        info = uris.stat(uri)
    except Exception:  # noqa: BLE001 - let aa-metadata give the real answer
        return ""
    if info is not None and info.size and info.size > _PROVENANCE_DOWNLOAD_LIMIT:
        size = info.size / 1024**3
        return (
            f"This product has no provenance sidecar (it predates them), and reading "
            f"its provenance would download {size:.1f} GB. In a terminal: "
            f"aa-metadata {uri}"
        )
    return ""


@router.get("/provenance", response_model=Provenance)
def get_provenance(uri: str = Query(..., min_length=1)) -> Provenance:
    """`aa-metadata --json` for one product (a local path or a gs:// URI).

    For a gs:// object the tools publish a small ``.aa.json`` beside the
    product, so this reads kilobytes rather than downloading a survey.
    """
    import json
    import subprocess

    try:
        program = jobs.resolve_tool("aa-metadata")
    except HTTPException as exc:
        return Provenance(uri=uri, found=False, message=str(exc.detail))
    too_big = _without_sidecar_and_large(uri)
    if too_big:
        return Provenance(uri=uri, found=False, message=too_big)
    try:
        proc = subprocess.run(  # noqa: S603 - resolved aa-* tool, argv only
            [program, "--json", "--verify", "--", uri],
            capture_output=True,
            text=True,
            timeout=float(os.getenv("AASI_PROVENANCE_TIMEOUT", "120")),
            stdin=subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired:
        return Provenance(uri=uri, found=False, message="aa-metadata took too long.")
    line = next((ln for ln in proc.stdout.splitlines() if ln.startswith("{")), "")
    if not line:
        message = (
            proc.stderr.strip().splitlines()[-1]
            if proc.stderr.strip()
            else "No provenance recorded."
        )
        return Provenance(uri=uri, found=False, message=message)
    try:
        document = json.loads(line)
    except ValueError:
        return Provenance(uri=uri, found=False, message="Unreadable provenance.")
    verified = None
    if "hash verified" in proc.stderr:
        verified = True
    elif "MISMATCH" in proc.stderr:
        verified = False
    return Provenance(uri=uri, found=True, document=document, verified=verified)


# --------------------------------------------------------------------------- #
# An echogram, for the card's results
# --------------------------------------------------------------------------- #
_IMAGE_LIMIT = 30 * 1024 * 1024


@router.get("/image")
def get_image(uri: str = Query(..., min_length=1)):
    """A PNG product from the bucket, so the card can show the echogram it made.

    Read the way the console tools read it (aalibrary's localize: a gcsfuse
    mount if there is one, else a checked download into the tools' cache), so
    there is one route to the bucket, not two. PNGs under the size limit only:
    this is a thumbnail, not a file server.
    """
    from fastapi.responses import FileResponse

    if not (uri.startswith("gs://") and uri.lower().endswith(".png")):
        raise HTTPException(status_code=400, detail="Only gs:// PNG products.")
    try:
        from aalibrary.console._core import uris
    except ImportError as exc:
        raise HTTPException(
            status_code=501, detail="aalibrary is not installed."
        ) from exc
    try:
        info = uris.stat(uri)
        if info is None:
            raise HTTPException(status_code=404, detail=f"No object {uri}.")
        if info.size and info.size > _IMAGE_LIMIT:
            raise HTTPException(status_code=413, detail="Too large to preview.")
        local = uris.localize(uri)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - say why, do not 500
        raise HTTPException(
            status_code=502, detail=f"Could not read {uri}: {exc}"
        ) from exc
    return FileResponse(local.path, media_type="image/png")


def _reset_for_tests() -> None:
    workspace._reset_for_tests()
    with _lock:
        _runs.clear()
