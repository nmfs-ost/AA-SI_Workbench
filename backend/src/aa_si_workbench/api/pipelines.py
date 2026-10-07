"""Pipelines: chains of console tools run on a product in the bucket.

A pipeline is an ordered list of stages, each a console tool with the
settings that differ from its defaults. It runs on one product: a selected
gs:// object (EchoData, Sv, MVBS, ...), and every stage's product is
published beside it in the bucket, with the provenance and hashes the tools
record.

The server owns the chain, as it does for Prepare EchoData:

* **Planning** (:func:`plan`) reads the input product (its kind, its history,
  the EchoData it came from), finds where the pipeline picks it up (an Sv
  input skips a pipeline's ``aa-sv``), checks every hand-off (each stage reads
  what the one before writes, and has the variables it needs), and builds
  every command. The preview is the run: the same function builds both.
* **Running** (:func:`start`) submits one job per stage, in order, each
  reading the product the one before printed. A job is pinned to the project
  the run started in. A stage whose product is already in the bucket (same
  inputs, same settings) is reused by the tool, not recomputed.

Pipelines a user saves are kept in their settings folder (``pipelines.json``
beside the GCP choice); a few stock ones are built in.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import threading
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from . import catalogue, jobs, products
from .catalogue import (
    FEATURE_LABELS,
    FEATURE_TOOL,
    KIND_LABELS,
    LEVELS,
    Catalogue,
    ToolDef,
)
from .gcp import GcpContext, config_dir, tool_env
from .gcp import current as gcp_current

router = APIRouter(prefix="/api/pipelines", tags=["pipelines"])

POLL_SECONDS = 0.5
_MAX_RUNS = 40
TOOL_RE = re.compile(r"aa-[a-z][a-z0-9-]{1,40}")
ID_RE = re.compile(r"[a-z0-9][a-z0-9-]{0,62}")


# --------------------------------------------------------------------------- #
# Pipelines: built in, and saved
# --------------------------------------------------------------------------- #
class StageSpec(BaseModel):
    #: An aa-* console tool, or "bash" / "python" for a step of your own.
    tool: str
    #: Only the settings that differ from the tool's defaults.
    params: dict[str, Any] = Field(default_factory=dict)
    #: A step of your own: the Bash command (tee, grep, a script of yours ...)
    #: or the Python code it runs. It gets the input product on stdin and as
    #: $IN; the last line it prints names its product, or (nothing printed, or
    #: not a product) the input passes on unchanged.
    command: str = ""
    #: Its name on the card ("Log the Sv", "Copy to the share").
    label: str = ""
    #: The kind of product it prints ('' : the kind it was given).
    produces: str = ""


#: Stages that are not console tools: run as Bash or Python.
OWN_STEPS = {"bash": "Shell command", "python": "Python"}


def is_own(stage: StageSpec) -> bool:
    return stage.tool in OWN_STEPS


class PipelineSpec(BaseModel):
    id: str = ""
    name: str
    description: str = ""
    stages: list[StageSpec]
    builtin: bool = False
    updatedAt: str = ""


def _builtin(pid: str, name: str, description: str, *stages: StageSpec) -> PipelineSpec:
    return PipelineSpec(
        id=f"builtin-{pid}",
        name=name,
        description=description,
        stages=list(stages),
        builtin=True,
    )


def _s(tool: str, **params: Any) -> StageSpec:
    return StageSpec(tool=tool, params=params)


BUILTINS: tuple[PipelineSpec, ...] = (
    _builtin(
        "sv-echogram",
        "Sv and echogram",
        "Calibrate EchoData to volume backscattering strength and draw it. "
        "Given an Sv, only the echogram is drawn.",
        _s("aa-sv"),
        _s("aa-graph"),
    ),
    _builtin(
        "clean-echogram",
        "Remove background noise",
        "Sv with background noise removed (De Robertis & Higginbottom 2007), and "
        "an echogram of the cleaned values (Sv_corrected).",
        _s("aa-sv"),
        _s("aa-clean"),
        _s("aa-graph", var="Sv_corrected"),
    ),
    _builtin(
        "mvbs-echogram",
        "MVBS",
        "Mean volume backscattering strength on a 20 m by 20 s grid, and its echogram.",
        _s("aa-sv"),
        _s("aa-mvbs"),
        _s("aa-graph"),
    ),
    _builtin(
        "nasc",
        "NASC",
        "Sv integrated into nautical area scattering coefficients on 10 m by "
        "0.5 nmi cells. Depth and position are added first; position is read "
        "from the EchoData the Sv was made from.",
        _s("aa-sv"),
        _s("aa-depth"),
        _s("aa-location"),
        _s("aa-nasc"),
    ),
    _builtin(
        "impulse-mask",
        "Impulse noise mask",
        "Depth added to Sv, impulse noise found (a mask of the affected samples), "
        "and the mask drawn.",
        _s("aa-sv"),
        _s("aa-depth"),
        _s("aa-impulse"),
        _s("aa-graph"),
    ),
    _builtin(
        "bottom-line",
        "Bottom line to edit",
        "The seafloor found in Sv (echopype's basic detector on the channel nearest "
        "38 kHz) and saved as an Echoview line file (.evl): open it on its "
        "echogram to correct it, then use it as the bottom when integrating.",
        _s("aa-sv"),
        _s("aa-depth"),
        _s("aa-detect-seafloor", method="basic"),
        _s("aa-annotate"),
    ),
    _builtin(
        "integrate-echoview",
        "Integrate (Echoview)",
        "Sv integrated as Echoview's Integrate by cells does it: 0.5 nmi intervals "
        "(time intervals when there is no position) by 10 m layers, a -70 dB "
        "threshold, and Echoview's export columns (NASC, Sv_mean, ABC...). Choose a "
        "bottom line, bad-data and analysis regions in Configuration; open the "
        "result in Results.",
        _s("aa-sv"),
        _s("aa-depth"),
        _s("aa-integrate", min_sv=-70),
    ),
    _builtin(
        "center-of-mass",
        "Center of mass",
        "The mean range of backscatter, weighted by linear sv, per channel and ping.",
        _s("aa-sv"),
        _s("aa-center-of-mass"),
    ),
)

_store_lock = threading.RLock()


def _store_file() -> Path:
    return config_dir() / "pipelines.json"


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def saved() -> list[PipelineSpec]:
    try:
        data = json.loads(_store_file().read_text())
    except (OSError, ValueError):
        return []
    out = []
    for item in data.get("pipelines", []) if isinstance(data, dict) else []:
        try:
            spec = PipelineSpec.model_validate(item)
        except ValueError:
            continue
        spec.builtin = False
        out.append(spec)
    return out


def _write_saved(pipelines: list[PipelineSpec]) -> None:
    path = _store_file()
    with _store_lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(
                {"pipelines": [p.model_dump(exclude={"builtin"}) for p in pipelines]},
                indent=2,
            )
        )
        os.replace(tmp, path)


def all_pipelines() -> list[PipelineSpec]:
    return [p.model_copy(deep=True) for p in BUILTINS] + saved()


def find(pipeline_id: str) -> PipelineSpec | None:
    return next((p for p in all_pipelines() if p.id == pipeline_id), None)


def _slug(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "pipeline"
    return slug


def own_argv(tool: str, code: str) -> list[str]:
    """How a step of one's own runs (as shown, and in the script)."""
    if tool == "bash":
        return ["bash", "-eo", "pipefail", "-c", code]
    return ["python3", "-c", code]


def own_output(stdout: list[str], given: str, cwd: Path | None = None) -> str:
    """What a step of one's own passes on: the last line it printed when that
    names a product (gs://, or a file or folder that exists, a relative one
    read from the folder the step ran in, *cwd*, the home folder), else what
    it was given (a step that only logs, copies or checks). The plan's script
    does the same (its own-step lines)."""
    last = next((line.strip() for line in reversed(stdout) if line.strip()), "")
    if last.startswith("gs://") and len(last) > len("gs://"):
        return last
    if last and not last.startswith("-") and "\x00" not in last:
        try:
            path = Path(last).expanduser()
            if not path.is_absolute():
                path = (cwd or Path.home()) / path
            if path.exists():
                return str(path)
        except OSError:
            pass
    return given


def _checked_own(stage: StageSpec) -> StageSpec:
    """A step of one's own, as it may be stored and run."""
    code = stage.command.replace("\r\n", "\n")
    if not code.strip():
        raise HTTPException(
            status_code=400,
            detail=f"A {OWN_STEPS[stage.tool]} step needs its command.",
        )
    if len(code) > 20_000 or "\x00" in code:
        raise HTTPException(
            status_code=400, detail="A step's command: up to 20,000 characters."
        )
    label = " ".join(stage.label.split())[:60]
    produces = stage.produces.strip()
    if produces and produces not in KIND_LABELS:
        raise HTTPException(
            status_code=400, detail=f"Not a kind of product: {produces!r}"
        )
    return StageSpec(tool=stage.tool, command=code, label=label, produces=produces)


def validate_spec(spec: PipelineSpec, cat: Catalogue | None = None) -> PipelineSpec:
    """A pipeline as it may be stored: known tools, settings of the right type."""
    name = spec.name.strip()
    if not name or len(name) > 80 or "\n" in name:
        raise HTTPException(status_code=400, detail="A pipeline needs a one-line name.")
    if not spec.stages:
        raise HTTPException(
            status_code=400, detail="A pipeline needs at least one stage."
        )
    if len(spec.stages) > 12:
        raise HTTPException(status_code=400, detail="At most 12 stages.")
    cat = cat or catalogue.get()
    stages: list[StageSpec] = []
    for stage in spec.stages:
        if is_own(stage):
            stages.append(_checked_own(stage))
            continue
        if not TOOL_RE.fullmatch(stage.tool):
            raise HTTPException(
                status_code=400, detail=f"Not a console tool: {stage.tool!r}"
            )
        tool_def = catalogue.tool(cat, stage.tool)
        if tool_def is None:
            if cat.tools:
                raise HTTPException(
                    status_code=400,
                    detail=f"{stage.tool} cannot be chained (or is not installed).",
                )
            stages.append(StageSpec(tool=stage.tool, params=dict(stage.params)))
            continue
        values, problems = catalogue.clean_values(tool_def, stage.params)
        bad = [p for p in problems if "needs" not in p]
        if bad:
            raise HTTPException(status_code=400, detail=" ".join(bad))
        stages.append(StageSpec(tool=stage.tool, params=values))
    return PipelineSpec(
        id=spec.id,
        name=name,
        description=spec.description.strip()[:600],
        stages=stages,
        builtin=False,
        updatedAt=_now(),
    )


def save(spec: PipelineSpec) -> PipelineSpec:
    """Create (no id, or a built-in's id: a copy) or replace a saved pipeline."""
    clean = validate_spec(spec)
    with _store_lock:
        mine = saved()
        if (
            spec.id
            and not spec.id.startswith("builtin-")
            and any(p.id == spec.id for p in mine)
        ):
            if not ID_RE.fullmatch(spec.id):
                raise HTTPException(status_code=400, detail="Not a pipeline id.")
            clean.id = spec.id
            mine = [clean if p.id == spec.id else p for p in mine]
        else:
            taken = {p.id for p in all_pipelines()}
            base = _slug(clean.name)
            candidate, n = base, 2
            while candidate in taken:
                candidate, n = f"{base}-{n}", n + 1
            clean.id = candidate
            mine.append(clean)
        _write_saved(mine)
    return clean


def delete(pipeline_id: str) -> None:
    with _store_lock:
        mine = saved()
        kept = [p for p in mine if p.id != pipeline_id]
        if len(kept) == len(mine):
            raise HTTPException(status_code=404, detail="No such saved pipeline.")
        _write_saved(kept)


# --------------------------------------------------------------------------- #
# Planning
# --------------------------------------------------------------------------- #
class PlanRequest(BaseModel):
    pipeline: PipelineSpec
    #: The product to run on: gs://bucket/path.
    input: str
    #: Where the products go, gs://bucket/prefix/; '' for beside the input.
    dest: str = ""
    #: Recompute stages whose product is already in the bucket.
    force: bool = False


class PlannedStage(BaseModel):
    index: int
    tool: str
    label: str
    #: A step of one's own (bash, python): what it runs.
    code: str = ""
    group: str = ""
    consumes: list[str] = Field(default_factory=list)
    produces: str = ""
    level: str = ""
    #: run | skip (the input is already past this stage)
    action: Literal["run", "skip"] = "run"
    reason: str = ""
    #: What it reads: the input's URI, or "<the X output>".
    reads: str = ""
    command: list[str] = Field(default_factory=list)
    echodata: str = ""
    values: dict[str, Any] = Field(default_factory=dict)
    problems: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class Plan(BaseModel):
    pipelineId: str = ""
    pipelineName: str = ""
    input: products.ProductInfo
    destination: str = ""
    destinationReason: str = ""
    stages: list[PlannedStage] = Field(default_factory=list)
    #: Blocking: the run is refused while any remain.
    problems: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    #: What the last stage writes.
    outputKind: str = ""
    script: str = ""
    project: str = ""


DERIVED_RE = re.compile(r"derived_products/[^/]+/(?P<rest>.+)/[^/]+$")


DERIVED_OWNER_RE = re.compile(r"derived_products/(?P<owner>[^/]+)/")


def destination_for(input_uri: str, context: GcpContext, user: str) -> tuple[str, str]:
    """Where the products go, and why.

    Beside the input when it is in the chosen bucket and not in someone else's
    folder; otherwise in the user's own folder of the chosen bucket, at the
    same vessel/survey/asset path, so a run never writes into a colleague's
    products or a bucket the user did not choose.
    """
    bucket, key = products.parse(input_uri)
    folder = key.rsplit("/", 1)[0] + "/" if "/" in key else ""
    if not context.bucket:
        return "", ""
    owner = user or "workbench"
    theirs = DERIVED_OWNER_RE.match(key)
    if bucket == context.bucket and (theirs is None or theirs.group("owner") == owner):
        return f"gs://{bucket}/{folder}", "Beside the input."
    match = DERIVED_RE.match(key)
    why = (
        f"The input is in {theirs.group('owner')}'s folder; products go to yours."
        if bucket == context.bucket and theirs is not None
        else f"The input is in gs://{bucket}; products go to your folder in "
        f"gs://{context.bucket}, the bucket you chose."
    )
    if match:
        rest = match.group("rest")
        return f"gs://{context.bucket}/derived_products/{owner}/{rest}/", why
    stem = key.rsplit("/", 1)[-1].split(".", 1)[0] or "product"
    return f"gs://{context.bucket}/derived_products/{owner}/pipelines/{stem}/", why


def _check_dest(dest: str) -> str:
    dest = dest.strip()
    if not dest:
        return ""
    if (
        not dest.startswith("gs://")
        or any(ord(ch) < 32 or ord(ch) == 127 for ch in dest)
        or ".." in dest.split("/")
    ):
        raise HTTPException(status_code=400, detail="Products go to a gs:// folder.")
    bucket = dest[len("gs://") :].split("/", 1)[0]
    from .gcp import BUCKET_RE

    if not BUCKET_RE.fullmatch(bucket):
        raise HTTPException(status_code=400, detail=f"Not a bucket: {bucket!r}")
    return dest if dest.endswith("/") else dest + "/"


def check_own_dest(dest: str) -> str:
    """A destination in the bucket chosen in the Workbench, and only there: for
    files the Workbench itself writes (line, region and calibration files)."""
    dest = _check_dest(dest)
    if not dest:
        return ""
    from .gcp import current

    chosen = current().bucket
    bucket = dest[len("gs://") :].split("/", 1)[0]
    if not chosen or bucket != chosen:
        raise HTTPException(
            status_code=400,
            detail=f"Files are saved in the bucket chosen ({chosen or 'none yet'}), "
            f"not {bucket}.",
        )
    return dest


def _user() -> str:
    from .baseline import detect_user

    return detect_user()


def _label_of(kind: str) -> str:
    return KIND_LABELS.get(kind, kind or "unknown")


def _needs(tool_def: ToolDef, values: dict[str, Any]) -> list[str]:
    needs = list(tool_def.needs)
    if tool_def.depthParam:
        value = catalogue.effective(tool_def, values).get(tool_def.depthParam)
        if value == "depth" and "depth" not in needs:
            needs.append("depth")
    return needs


def _wants_echodata(tool_def: ToolDef, values: dict[str, Any]) -> bool:
    if not tool_def.echodataFlag:
        return False
    if tool_def.echodataRequired:
        return True
    current = catalogue.effective(tool_def, values)
    return any(bool(current.get(name)) for name in tool_def.echodataWhen)


def _product_values(tool_def: ToolDef, values: dict[str, Any]) -> list[tuple[str, str]]:
    """(label, gs:// URI) of every product an option of this stage names."""
    out = []
    for param in tool_def.params:
        if not param.productKinds or param.id not in values:
            continue
        value = values[param.id]
        for item in value if isinstance(value, list) else [value]:
            if isinstance(item, str) and item:
                out.append((param.label, item))
    return out


class OwnStep:
    """A step of one's own in a chain: reads anything, passes on what it is
    given unless it says what it makes."""

    def __init__(self, produces: str = ""):
        self.produces = produces


Link = ToolDef | OwnStep | None


def _chain_holds(tools: list[Link], kind: str) -> bool:
    """Every stage reads what the one before it writes, from *kind* on."""
    for tool_def in tools:
        if isinstance(tool_def, OwnStep):
            kind = tool_def.produces or kind
            continue
        if tool_def is None or kind not in tool_def.consumes:
            return False
        kind = kind if tool_def.passthrough else tool_def.produces
    return True


def start_index(tools: list[Link], kind: str) -> int:
    """Where a pipeline picks up a product of *kind*: the first stage that
    reads it and from which the rest of the chain holds (else the first that
    reads it, so the plan can say what breaks). -1: no stage reads it.

    A step of one's own reads anything: the chain may start at one (a `tee`
    between a stage the input is past and the next one runs on the input)."""
    readers = [
        i
        for i, t in enumerate(tools)
        if isinstance(t, OwnStep) or (t is not None and kind in t.consumes)
    ]
    for i in readers:
        if _chain_holds(tools[i:], kind):
            return i
    first_tool = next((i for i in readers if not isinstance(tools[i], OwnStep)), None)
    if first_tool is not None:
        return first_tool
    return readers[0] if readers else -1


def plan(req: PlanRequest, *, input_info: products.ProductInfo | None = None) -> Plan:
    cat = catalogue.get()
    info = input_info or products.info(req.input)
    out = Plan(
        pipelineId=req.pipeline.id,
        pipelineName=req.pipeline.name,
        input=info,
    )
    context = gcp_current()
    out.project = context.project
    if cat.problem:
        out.problems.append(cat.problem)
    if not info.found:
        out.problems.append(info.detail or f"{req.input} is not in the bucket.")
    if not req.pipeline.stages:
        out.problems.append("This pipeline has no stages.")
        return out

    dest = _check_dest(req.dest)
    if dest:
        out.destination, out.destinationReason = dest, "Chosen for this run."
    else:
        out.destination, out.destinationReason = destination_for(
            info.uri, context, _user()
        )
        if not out.destination:
            out.problems.append(
                "Choose a GCP project and bucket first: products are written to it."
            )

    tools: list[Link] = [
        OwnStep(stage.produces) if is_own(stage) else catalogue.tool(cat, stage.tool)
        for stage in req.pipeline.stages
    ]
    kind = info.kind
    start = 0
    if kind:
        start = start_index(tools, kind)
        if start < 0:
            first = next((t for t in tools if isinstance(t, ToolDef)), None)
            wanted = ", ".join(_label_of(k) for k in (first.consumes if first else []))
            out.problems.append(
                f"No stage of this pipeline reads {_label_of(kind)}: it starts from "
                f"{wanted or 'something else'}."
            )
            start = 0
    elif info.found:
        out.warnings.append(
            "The bucket does not say what kind of product this is (no provenance "
            "metadata), so the pipeline starts at its first stage."
        )

    # What the product reaching each stage is known to carry, and whether the
    # rest is unknown (an input whose history the bucket does not have).
    known: set[str] = set(info.features or [])
    unknown = info.features is None
    reads = info.uri
    script_lines: list[str] = []
    previous_var = "IN"
    for index, (stage, tool_def) in enumerate(
        zip(req.pipeline.stages, tools, strict=True)
    ):
        planned = PlannedStage(index=index, tool=stage.tool, label=stage.tool)
        out.stages.append(planned)
        if isinstance(tool_def, OwnStep):
            planned.label = stage.label or OWN_STEPS[stage.tool]
            planned.group = "Your own"
            planned.code = stage.command
            if index < start:
                planned.action = "skip"
                planned.reason = (
                    f"Not needed: the input is already {_label_of(kind)}, past the "
                    "stages before this one."
                )
                continue
            refused = jobs.own_code_refused()
            if refused:
                planned.problems.append(refused)
            if not stage.command.strip():
                planned.problems.append(f"{planned.label}: write its command first.")
            elif len(stage.command) > 20_000 or "\x00" in stage.command:
                planned.problems.append(f"{planned.label}: up to 20,000 characters.")
            produced = stage.produces or kind
            planned.produces = produced
            planned.level = LEVELS.get(produced, "")
            planned.reads = reads
            planned.command = own_argv(stage.tool, stage.command)
            var = f"OUT{index + 1}"
            runner = " ".join(shlex.quote(a) for a in planned.command)
            script_lines.append(f"# {_comment(planned.label)} (your own step)")
            # As the Workbench runs it: from the home folder, the input on
            # stdin and as $IN; the last line it prints that is not blank.
            script_lines.append(
                f"{var}=$(cd ~ && printf '%s\\n' \"${previous_var}\" | "
                f'IN="${previous_var}" DEST="$DEST" {runner} '
                "| awk 'NF {last = $0} END {print last}')"
            )
            # That line names a product (gs://, or a file: a relative one is in
            # the home folder), or the input passes on.
            script_lines.append(
                f'case "${var}" in gs://?*) ;; "") {var}="${previous_var}" ;; '
                f'*) {var}="${{{var}/#\\~/$HOME}}"; [[ "${var}" = /* ]] || '
                f'{var}="$HOME/${var}"; '
                f'[[ -e "${var}" ]] || {var}="${previous_var}" ;; esac'
            )
            script_lines.append(
                f'echo {shlex.quote(_comment(planned.label) + ": ")}"${var}"'
            )
            previous_var = var
            reads = f"<the {planned.label} output>"
            if produced != kind:
                known, unknown = set(), True
            kind = produced
            continue
        if tool_def is None:
            planned.problems.append(
                f"{stage.tool} is not a tool the Workbench can chain, or it is not "
                "installed."
            )
            continue
        planned.label = tool_def.label
        planned.group = tool_def.group
        planned.consumes = list(tool_def.consumes)
        planned.produces = tool_def.produces
        planned.level = tool_def.level
        values, problems = catalogue.clean_values(tool_def, stage.params)
        planned.values = values
        if index < start:
            planned.action = "skip"
            planned.reason = f"Not needed: the input is already {_label_of(kind)}."
            continue
        # A stage that only adds what the product already carries (aa-depth on
        # an Sv that has depth), with its default settings, would remake the
        # same values under a new name: skipped.
        if (
            tool_def.adds
            and not stage.params
            and not unknown
            and set(tool_def.adds) <= known
            and kind in tool_def.consumes
            and (tool_def.passthrough or tool_def.produces == kind)
        ):
            planned.action = "skip"
            planned.reason = (
                "Not needed: the input already has "
                + ", ".join(FEATURE_LABELS.get(a, a) for a in tool_def.adds)
                + "."
            )
            continue
        planned.problems.extend(problems)
        if kind and kind not in tool_def.consumes:
            planned.problems.append(
                f"{stage.tool} reads "
                f"{' or '.join(_label_of(k) for k in tool_def.consumes)}, "
                f"and gets {_label_of(kind)}."
            )
        for need in _needs(tool_def, values):
            if need in known:
                continue
            if unknown:
                planned.warnings.append(
                    f"{stage.tool} needs {FEATURE_LABELS.get(need, need)}; the input's "
                    "history is not known, so this cannot be checked."
                )
            else:
                adder = FEATURE_TOOL.get(need, "")
                planned.problems.append(
                    f"{stage.tool} needs {FEATURE_LABELS.get(need, need)}"
                    + (f": add {adder} before it." if adder else ".")
                )
        for label, uri in _product_values(tool_def, values):
            try:
                found = products.info(uri, history=False).found
            except HTTPException:
                found = False
            if not found:
                planned.problems.append(
                    f"{stage.tool}: {label}: {uri} is not in the bucket."
                )
        if tool_def.echodataOptional and tool_def.echodataFlag and info.echodata:
            planned.echodata = info.echodata
        elif _wants_echodata(tool_def, values):
            if info.echodata:
                planned.echodata = info.echodata
            else:
                why = "with these settings " if not tool_def.echodataRequired else ""
                planned.problems.append(
                    f"{stage.tool} {why}reads the EchoData the input was made from, "
                    "and the input's record does not say which. Run the pipeline "
                    "on that EchoData instead."
                )
        planned.reads = reads
        argv = catalogue.stage_argv(
            tool_def,
            values,
            reads,
            out.destination or "gs://<bucket>/",
            echodata=planned.echodata,
            force=req.force,
        )
        planned.command = [stage.tool, *argv]
        var = f"OUT{index + 1}"
        script_args = [f'"${previous_var}"', *(shlex.quote(a) for a in argv[1:])]
        script_lines.append(f"{var}=$({stage.tool} {' '.join(script_args)})")
        script_lines.append(f'echo "{tool_def.label}: ${var}"')
        previous_var = var
        reads = f"<the {tool_def.label} output>"
        # What the next stage gets: an Sv passed on keeps what it carried;
        # a new kind of product starts afresh.
        produced = kind if tool_def.passthrough and kind else tool_def.produces
        # Same kind in and out (an Sv corrected or added to): what it carried
        # is passed on, known or not. Kind unknown: so is the rest.
        same = produced == kind or (not kind and produced in tool_def.consumes)
        if same and produced in ("sv", "mvbs"):
            known |= set(tool_def.adds)
        else:
            known, unknown = set(tool_def.adds), False
        kind = produced

    out.outputKind = kind
    for planned in out.stages:
        out.problems.extend(planned.problems)
        out.warnings.extend(planned.warnings)
    out.script = _script(info.uri, out, script_lines)
    return out


def _comment(text: str) -> str:
    """One line of a script comment: no control characters can end it."""
    return "".join(ch if ch.isprintable() else " " for ch in text)


def _script(input_uri: str, out: Plan, lines: list[str]) -> str:
    head = [
        "#!/usr/bin/env bash",
        f"# {_comment(out.pipelineName or 'Pipeline')}: {_comment(input_uri)}",
        f"# Products: {_comment(out.destination or '(choose a bucket)')}",
        "set -euo pipefail",
    ]
    for name, value in tool_env(gcp_current()).items():
        head.append(f"export {name}={shlex.quote(value)}")
    head.append(f"IN={shlex.quote(input_uri)}")
    if any("(your own step)" in line for line in lines):
        head.append(f"DEST={shlex.quote(out.destination)}")
    return "\n".join([*head, *lines]) + "\n"


# --------------------------------------------------------------------------- #
# Running
# --------------------------------------------------------------------------- #
StageState = Literal[
    "pending", "running", "succeeded", "failed", "skipped", "cancelled"
]


class StageRun(BaseModel):
    index: int
    tool: str
    label: str
    produces: str = ""
    level: str = ""
    state: StageState = "pending"
    detail: str = ""
    jobId: str = ""
    command: list[str] = Field(default_factory=list)
    output: str = ""
    reused: bool = False
    startedAt: str = ""
    finishedAt: str = ""
    product: products.ProductInfo | None = None
    log: list[str] = Field(default_factory=list)


class RunStatus(BaseModel):
    id: str
    pipelineId: str = ""
    pipelineName: str = ""
    input: products.ProductInfo
    destination: str = ""
    project: str = ""
    state: Literal["running", "succeeded", "failed", "cancelled"] = "running"
    stages: list[StageRun] = Field(default_factory=list)
    createdAt: str = ""
    finishedAt: str = ""
    error: str = ""
    #: Every product it made, last first.
    outputs: list[products.ProductInfo] = Field(default_factory=list)


class _Run:
    def __init__(
        self, status: RunStatus, plan_: Plan, req: PlanRequest, context: GcpContext
    ):
        self.status = status
        self.plan = plan_
        self.req = req
        self.context = context
        self.cancel = False
        self.job = ""
        self.scratch = Path()


_runs: dict[str, _Run] = {}
_lock = threading.RLock()


def run_root() -> Path:
    from .baseline import run_root as baseline_root

    return baseline_root()


def start(req: PlanRequest) -> RunStatus:
    the_plan = plan(req)
    if the_plan.problems:
        raise HTTPException(status_code=409, detail=" ".join(the_plan.problems))
    context = gcp_current()
    run_id = uuid.uuid4().hex[:10]
    status = RunStatus(
        id=run_id,
        pipelineId=req.pipeline.id,
        pipelineName=req.pipeline.name,
        input=the_plan.input,
        destination=the_plan.destination,
        project=context.project,
        createdAt=_now(),
        stages=[
            StageRun(
                index=s.index,
                tool=s.tool,
                label=s.label,
                produces=s.produces,
                level=s.level,
                state="skipped" if s.action == "skip" else "pending",
                detail=s.reason,
                command=list(s.command),
            )
            for s in the_plan.stages
        ],
    )
    run = _Run(status, the_plan, req, context)
    run.scratch = run_root() / f"pipeline-{run_id}"
    with _lock:
        _runs[run_id] = run
        _evict()
    threading.Thread(
        target=_execute, args=(run,), daemon=True, name=f"pipeline-{run_id}"
    ).start()
    return snapshot(run)


def _evict() -> None:
    if len(_runs) <= _MAX_RUNS:
        return
    for run_id, run in list(_runs.items()):
        if len(_runs) <= _MAX_RUNS:
            break
        if run.status.state != "running":
            del _runs[run_id]


def snapshot(run: _Run) -> RunStatus:
    with _lock:
        status = run.status.model_copy(deep=True)
    for stage in status.stages:
        if stage.jobId and stage.state == "running":
            stage.log = jobs.tail_of(stage.jobId, 12)
    return status


def _finish(run: _Run, state: str, error: str = "") -> None:
    # The scratch folder only holds the tools' cache (inputs downloaded, outputs
    # staged before upload): nothing to keep, after any ending, and an EchoData
    # can be gigabytes. Removed before the run reads as ended, so an ended run
    # has nothing left behind. The logs stay with the run.
    shutil.rmtree(run.scratch, ignore_errors=True)
    with _lock:
        run.status.state = state  # type: ignore[assignment]
        run.status.error = error
        run.status.finishedAt = _now()
        for stage in run.status.stages:
            if stage.state == "pending":
                stage.state = "cancelled" if state == "cancelled" else "skipped"
                if state == "failed" and not stage.detail:
                    stage.detail = "Not run: an earlier stage failed."
    _persist(run)


# --------------------------------------------------------------------------- #
# Finished runs, kept across restarts
# --------------------------------------------------------------------------- #
_KEPT_RUNS = 40


def _runs_file() -> Path:
    return config_dir() / "pipeline-runs.json"


def _persisted() -> list[RunStatus]:
    try:
        data = json.loads(_runs_file().read_text())
    except (OSError, ValueError):
        return []
    out = []
    for item in data.get("runs", []) if isinstance(data, dict) else []:
        try:
            out.append(RunStatus.model_validate(item))
        except ValueError:
            continue
    return out


def _persist(run: _Run) -> None:
    """Keep a finished run (its stages, logs and products) for after a restart."""
    try:
        with _lock:
            status = run.status.model_copy(deep=True)
        with _store_lock:
            kept = [r for r in _persisted() if r.id != status.id]
            kept.insert(0, status)
            path = _runs_file()
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            tmp.write_text(
                json.dumps({"runs": [r.model_dump() for r in kept[:_KEPT_RUNS]]})
            )
            os.replace(tmp, path)
    except OSError:
        pass  # a run that is not remembered is still a run that happened


def _execute(run: _Run) -> None:
    try:
        _execute_stages(run)
    except Exception as exc:  # noqa: BLE001 - a run must always end
        detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
        with _lock:
            for stage in run.status.stages:
                if stage.state == "running":
                    stage.state = "failed"
        _finish(run, "failed", f"The runner stopped: {detail}")


def _execute_stages(run: _Run) -> None:
    cat = catalogue.get()
    run.scratch.mkdir(parents=True, exist_ok=True)
    env = {"AA_CACHE_DIR": str(run.scratch / "cache")}
    gcp_env = tool_env(run.context)
    current = run.plan.input.uri
    for planned, stage in zip(run.plan.stages, run.status.stages, strict=True):
        if run.cancel:
            _finish(run, "cancelled")
            return
        if planned.action == "skip":
            continue
        if planned.tool in OWN_STEPS:
            current = _run_own(run, planned, stage, current, env, gcp_env)
            if not current:
                return
            continue
        tool_def = catalogue.tool(cat, planned.tool)
        if tool_def is None:
            with _lock:
                stage.state = "failed"
                stage.detail = "No longer installed."
            _finish(run, "failed", f"{planned.tool} is no longer installed.")
            return
        args = catalogue.stage_argv(
            tool_def,
            planned.values,
            current,
            run.plan.destination,
            echodata=planned.echodata,
            force=run.req.force,
        )
        try:
            job = jobs.submit(
                jobs.JobRequest(
                    tool=planned.tool,
                    args=args,
                    cwd=str(run.scratch),
                    env=env,
                    label=f"{run.status.pipelineName} · {planned.label}",
                ),
                gcp_env=gcp_env,
            )
        except HTTPException as exc:
            with _lock:
                stage.state = "failed"
                stage.detail = str(exc.detail)
            _finish(run, "failed", f"{planned.label}: {exc.detail}")
            return
        with _lock:
            stage.state = "running"
            stage.jobId = job.id
            stage.command = [planned.tool, *args]
            stage.startedAt = _now()
            run.job = job.id
            cancel_now = run.cancel
        if cancel_now:
            try:
                jobs.cancel(job.id)
            except HTTPException:
                pass

        # Read through the job itself: with many runs at once, the jobs table
        # may evict a finished job before this loop next looks it up.
        while True:
            status = jobs.status_of_job(job)
            if status.state in jobs.FINAL_STATES:
                break
            time.sleep(POLL_SECONDS)

        log = jobs.tail_of_job(job, 200)
        with _lock:
            stage.finishedAt = _now()
            stage.log = log[-12:]
            run.job = ""
        if status is None or status.state != "succeeded":
            reason = ""
            if status is not None:
                reason = (
                    status.error
                    or status.verdict
                    or f"{status.state} (exit {status.exitCode})"
                )
            with _lock:
                stage.state = "cancelled" if run.cancel else "failed"
                stage.detail = reason
            if run.cancel:
                _finish(run, "cancelled")
            else:
                message = f"{planned.label} ({planned.tool}) stopped: {reason}"
                if log:
                    message += "\n" + "\n".join(log[-6:])
                _finish(run, "failed", message)
            return

        output = next(
            (line.strip() for line in reversed(status.stdout) if line.strip()), ""
        )
        if not output:
            with _lock:
                stage.state = "failed"
                stage.detail = "The tool printed no product."
            _finish(
                run, "failed", f"{planned.label} ({planned.tool}) printed no product."
            )
            return
        reused = any("reusing" in line for line in log)
        product = None
        if output.startswith("gs://"):
            try:
                product = products.info(output)
            except HTTPException:
                product = None
        with _lock:
            stage.state = "succeeded"
            stage.output = output
            stage.reused = reused
            stage.product = product
            stage.detail = (
                "Already in the bucket with the same inputs and settings: reused."
                if reused
                else ""
            )
            if product is not None:
                run.status.outputs.insert(0, product)
        current = output
    _finish(run, "succeeded")


def _wait(run: _Run, stage: StageRun, job: jobs._Job) -> tuple[Any, list[str]]:
    """Follow a stage's job to its end: (its status, its log)."""
    with _lock:
        stage.state = "running"
        stage.jobId = job.id
        stage.startedAt = _now()
        run.job = job.id
        cancel_now = run.cancel
    if cancel_now:
        try:
            jobs.cancel(job.id)
        except HTTPException:
            pass
    while True:
        status = jobs.status_of_job(job)
        if status.state in jobs.FINAL_STATES:
            break
        time.sleep(POLL_SECONDS)
    log = jobs.tail_of_job(job, 200)
    with _lock:
        stage.finishedAt = _now()
        stage.log = log[-12:]
        run.job = ""
    return status, log


def _run_own(
    run: _Run,
    planned: PlannedStage,
    stage: StageRun,
    current: str,
    env: dict[str, str],
    gcp_env: dict[str, str],
) -> str:
    """Run a step of one's own (Bash or Python) on *current*. What it passes
    on ('' : the run has ended)."""
    try:
        job = jobs.submit_step(
            planned.tool,
            planned.code,
            stdin_text=current + "\n",
            env={**env, "IN": current, "DEST": run.plan.destination},
            # The home folder, as in the Terminal: a `tee log.txt` lands
            # where the user expects to find it.
            cwd="",
            label=f"{run.status.pipelineName} · {planned.label}",
            gcp_env=gcp_env,
        )
    except HTTPException as exc:
        with _lock:
            stage.state = "failed"
            stage.detail = str(exc.detail)
        _finish(run, "failed", f"{planned.label}: {exc.detail}")
        return ""
    with _lock:
        stage.command = own_argv(planned.tool, planned.code)
    status, log = _wait(run, stage, job)
    if status.state != "succeeded":
        reason = status.error or f"{status.state} (exit {status.exitCode})"
        with _lock:
            stage.state = "cancelled" if run.cancel else "failed"
            stage.detail = reason
        if run.cancel:
            _finish(run, "cancelled")
        else:
            message = f"{planned.label} (your own step) stopped: {reason}"
            if log:
                message += "\n" + "\n".join(log[-6:])
            _finish(run, "failed", message)
        return ""
    output = own_output(status.stdout, current, Path.home())
    product = None
    if output != current and output.startswith("gs://"):
        try:
            product = products.info(output)
        except HTTPException:
            product = None
    with _lock:
        stage.state = "succeeded"
        stage.output = output
        stage.product = product
        stage.detail = "" if output != current else "Passed its input on."
        if product is not None:
            run.status.outputs.insert(0, product)
    return output


def get_run(run_id: str) -> _Run:
    with _lock:
        run = _runs.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="No such run.")
    return run


def run_status(run_id: str) -> RunStatus:
    """A run's status: running here, or finished (perhaps before a restart)."""
    with _lock:
        run = _runs.get(run_id)
    if run is not None:
        return snapshot(run)
    held = next((r for r in _persisted() if r.id == run_id), None)
    if held is None:
        raise HTTPException(status_code=404, detail="No such run.")
    return held


def cancel(run_id: str) -> RunStatus:
    with _lock:
        known = run_id in _runs
    if not known and any(r.id == run_id for r in _persisted()):
        raise HTTPException(status_code=409, detail="That run has finished.")
    run = get_run(run_id)
    with _lock:
        run.cancel = True
        job = run.job
    if job:
        try:
            jobs.cancel(job)
        except HTTPException:
            pass
    return snapshot(run)


def _reset_for_tests() -> None:
    with _lock:
        _runs.clear()


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@router.get("/tools", response_model=Catalogue)
def get_tools(refresh: bool = Query(False)) -> Catalogue:
    return catalogue.get(refresh=refresh and catalogue.age() > 10)


@router.get("", response_model=list[PipelineSpec])
def list_pipelines() -> list[PipelineSpec]:
    return all_pipelines()


@router.post("", response_model=PipelineSpec)
def post_pipeline(spec: PipelineSpec) -> PipelineSpec:
    return save(spec)


class DeleteRequest(BaseModel):
    id: str


@router.post("/delete")
def post_delete(body: DeleteRequest) -> dict:
    delete(body.id)
    return {"deleted": body.id}


@router.post("/plan", response_model=Plan)
def post_plan(req: PlanRequest) -> Plan:
    return plan(req)


@router.post("/runs", response_model=RunStatus)
def post_run(req: PlanRequest) -> RunStatus:
    return start(req)


@router.get("/runs", response_model=list[RunStatus])
def list_runs() -> list[RunStatus]:
    with _lock:
        runs = list(_runs.values())
    live = [snapshot(run) for run in reversed(runs)]
    ids = {r.id for r in live}
    earlier = [r for r in _persisted() if r.id not in ids]
    return live + earlier


@router.get("/runs/{run_id}", response_model=RunStatus)
def get_run_status(run_id: str) -> RunStatus:
    return run_status(run_id)


@router.post("/runs/{run_id}/cancel", response_model=RunStatus)
def post_cancel(run_id: str) -> RunStatus:
    return cancel(run_id)
