"""The console tools a pipeline can chain, read from the installed aalibrary.

The old pipeline cards carried a hand-written copy of every tool's flags in the
frontend, and the copy had drifted: flags the tools do not have, tools that do
not exist, defaults sent as if chosen. Here the flags come from the tools:

* **What each tool accepts** is asked of the aalibrary the tools run under
  (the interpreter on their ``#!`` line, as workspace.py does): every console
  module declares ``SPEC`` (role, the kind of product it writes, which options
  are scientific) and ``HELP`` (the curated text), and builds its argparse
  parser in ``_build_parser()``. One subprocess imports them all and reports
  them, in a few seconds; the answer is kept until aalibrary changes.
* **How tools chain** is the part no parser states, so it is written down
  here (:data:`TRAITS`): which kinds of product a tool reads, what it adds to
  its input (depth, position, split-beam angles), and what it needs. Only
  tools listed here are offered, and only the flags the installed tool has.

The argv of a stage is built here too (:func:`stage_argv`), from the same
parameter descriptions the cards edit, so what the card shows is what runs.
"""

from __future__ import annotations

import json
import math
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from typing import Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field

from . import jobs

# --------------------------------------------------------------------------- #
# Kinds of product, and the levels the Workbench names them by
# --------------------------------------------------------------------------- #
#: What flows between stages. A tool reads some of these and writes one.
KINDS = (
    "raw",
    "echodata",
    "sv",
    "ts",
    "mask",
    "seafloor",
    "noise",
    "mvbs",
    "nasc",
    "integration",
    "echometric",
    "lines",
    "regions",
    "calibration",
    "echogram",
    "html",
    "tiles",
)

#: The data level each kind is at (L0 raw, L1 EchoData, L2A calibrated, L2B
#: derived from calibrated, L3 gridded, L4 metrics). Renderings have none.
LEVELS: dict[str, str] = {
    "raw": "L0",
    "echodata": "L1",
    "sv": "L2A",
    "ts": "L2A",
    "mask": "L2B",
    "seafloor": "L2B",
    "noise": "L2B",
    "mvbs": "L3",
    "nasc": "L3",
    "integration": "L3",
    "echometric": "L4",
    "lines": "",
    "regions": "",
    "calibration": "",
    "echogram": "",
    "html": "",
    "tiles": "",
}

KIND_LABELS: dict[str, str] = {
    "raw": "Raw",
    "echodata": "EchoData",
    "sv": "Sv",
    "ts": "TS",
    "mask": "Mask",
    "seafloor": "Seafloor line",
    "noise": "Noise",
    "mvbs": "MVBS",
    "nasc": "NASC",
    "integration": "Integration",
    "echometric": "Echometric",
    "lines": "Lines",
    "regions": "Regions",
    "calibration": "Calibration",
    "echogram": "Echogram",
    "html": "Interactive plot",
    "tiles": "Echogram tiles",
}

#: Variables a product can carry that some tools need.
FEATURES = ("depth", "location", "angles")
FEATURE_LABELS = {
    "depth": "depth",
    "location": "latitude and longitude",
    "angles": "split-beam angles",
}
#: The tool that adds each one.
FEATURE_TOOL = {
    "depth": "aa-depth",
    "location": "aa-location",
    "angles": "aa-splitbeam-angle",
}


@dataclass(frozen=True)
class Traits:
    """What argparse cannot say: how a tool fits in a chain."""

    group: str
    label: str
    consumes: tuple[str, ...]
    produces: str
    #: Variables the input must have.
    needs: tuple[str, ...] = ()
    #: Needs depth only when this parameter's value is "depth".
    depth_param: str = ""
    #: Variables this tool adds (it passes its input's on).
    adds: tuple[str, ...] = ()
    #: The flag that takes the EchoData the input was made from, and whether
    #: the tool cannot do its job without it.
    echodata_flag: str = ""
    echodata_required: bool = False
    #: Otherwise the EchoData is passed only when one of these is on.
    echodata_when: tuple[str, ...] = ()
    #: Parameters shown first, in this order.
    primary: tuple[str, ...] = ()
    #: Writes the same kind of product it reads (a correction, not a new kind).
    passthrough: bool = False
    #: Passes the EchoData when it is known, and does without (a track).
    echodata_optional: bool = False
    #: Options that take another product, and the kinds they take.
    inputs: tuple[tuple[str, tuple[str, ...]], ...] = ()
    #: Of those, the ones the tool cannot run without.
    required_inputs: tuple[str, ...] = ()

    @classmethod
    def from_table(cls, item: dict) -> Traits:
        """From aalibrary's chaining table (console/_core/chaining.py)."""

        def tup(key: str) -> tuple:
            return tuple(item.get(key) or ())

        return cls(
            group=str(item.get("group") or ""),
            label=str(item.get("label") or ""),
            consumes=tup("consumes"),
            produces=str(item.get("produces") or ""),
            needs=tup("needs"),
            depth_param=str(item.get("depth_param") or ""),
            adds=tup("adds"),
            echodata_flag=str(item.get("echodata_flag") or ""),
            echodata_required=bool(item.get("echodata_required")),
            echodata_when=tup("echodata_when"),
            primary=tup("primary"),
            passthrough=bool(item.get("passthrough")),
            echodata_optional=bool(item.get("echodata_optional")),
            inputs=tuple(
                (str(k), tuple(v or ())) for k, v in (item.get("inputs") or {}).items()
            ),
            required_inputs=tup("required_inputs"),
        )


GROUPS = (
    "Calibrate",
    "Clean and correct",
    "Select and mask",
    "Add variables",
    "Grid and integrate",
    "Masks and detection",
    "Lines and regions",
    "Echometrics",
    "Render",
)

SV_LIKE = ("sv",)
TRAITS: dict[str, Traits] = {
    # Calibrate
    "aa-sv": Traits(
        "Calibrate",
        "Sv",
        ("echodata",),
        "sv",
        primary=("waveform_mode", "encode_mode", "ecs"),
        inputs=(("ecs", ("calibration",)),),
    ),
    "aa-ts": Traits(
        "Calibrate",
        "TS",
        ("echodata",),
        "ts",
        primary=("waveform_mode", "encode_mode", "ecs"),
        inputs=(("ecs", ("calibration",)),),
    ),
    # Clean and correct
    "aa-clean": Traits(
        "Clean and correct",
        "Remove noise",
        SV_LIKE,
        "sv",
        primary=("snr_threshold", "ping_num", "range_sample_num"),
    ),
    "aa-coerce-time": Traits(
        "Clean and correct", "Fix time order", ("sv", "mvbs"), "sv", passthrough=True
    ),
    "aa-swap-freq": Traits(
        "Clean and correct",
        "Index by frequency",
        ("sv", "mvbs"),
        "sv",
        passthrough=True,
    ),
    # Select and mask
    "aa-crop": Traits(
        "Select and mask",
        "Crop",
        ("sv", "mvbs", "ts", "mask"),
        "sv",
        passthrough=True,
        primary=("start", "end", "min_range", "max_range", "frequency"),
    ),
    "aa-threshold": Traits(
        "Select and mask",
        "Threshold",
        ("sv", "mvbs", "ts"),
        "sv",
        passthrough=True,
        primary=("min", "max", "below", "above"),
    ),
    "aa-mask": Traits(
        "Select and mask",
        "Apply masks",
        ("sv", "mvbs", "ts"),
        "sv",
        passthrough=True,
        primary=("remove", "keep", "mask"),
        inputs=(("remove", ("mask",)), ("keep", ("mask",)), ("mask", ("mask",))),
    ),
    "aa-evl": Traits(
        "Select and mask",
        "Exclude by lines",
        ("sv", "mvbs"),
        "sv",
        passthrough=True,
        primary=("evl", "keep", "depth_offset"),
        inputs=(("evl", ("lines",)),),
        required_inputs=("evl",),
    ),
    "aa-evr": Traits(
        "Select and mask",
        "Keep regions",
        ("sv", "mvbs"),
        "sv",
        passthrough=True,
        primary=("evr",),
        inputs=(("evr", ("regions",)),),
        required_inputs=("evr",),
    ),
    # Add variables
    "aa-depth": Traits(
        "Add variables",
        "Depth",
        SV_LIKE,
        "sv",
        adds=("depth",),
        echodata_flag="--echodata",
        echodata_when=(
            "use_platform_vertical_offsets",
            "use_platform_angles",
            "use_beam_angles",
        ),
        primary=("depth_offset", "tilt", "downward"),
    ),
    "aa-location": Traits(
        "Add variables",
        "Position",
        SV_LIKE,
        "sv",
        adds=("location",),
        echodata_flag="--echodata",
        echodata_required=True,
    ),
    "aa-splitbeam-angle": Traits(
        "Add variables",
        "Split-beam angles",
        SV_LIKE,
        "sv",
        adds=("angles",),
        echodata_flag="--echodata",
        echodata_required=True,
        primary=("waveform_mode", "encode_mode"),
    ),
    # Grid and integrate
    "aa-mvbs": Traits(
        "Grid and integrate",
        "MVBS",
        SV_LIKE,
        "mvbs",
        depth_param="range_var",
        primary=("range_bin", "ping_time_bin", "range_var", "method"),
    ),
    "aa-mvbs-index": Traits(
        "Grid and integrate",
        "MVBS by index",
        ("sv", "echodata"),
        "mvbs",
        primary=("range_sample_num", "ping_num"),
    ),
    "aa-nasc": Traits(
        "Grid and integrate",
        "NASC",
        SV_LIKE,
        "nasc",
        needs=("depth", "location"),
        primary=("range_bin", "dist_bin"),
    ),
    "aa-integrate": Traits(
        "Grid and integrate",
        "Integrate (Echoview)",
        SV_LIKE,
        "integration",
        echodata_flag="--echodata",
        echodata_optional=True,
        primary=(
            "by",
            "interval",
            "layer",
            "min_sv",
            "bottom",
            "bottom_offset",
            "surface_depth",
            "regions",
            "bad",
        ),
        inputs=(
            ("surface", ("lines",)),
            ("bottom", ("lines", "seafloor")),
            ("bad", ("regions",)),
            ("regions", ("regions",)),
        ),
    ),
    # Masks and detection
    "aa-impulse": Traits(
        "Masks and detection",
        "Impulse noise",
        SV_LIKE,
        "mask",
        depth_param="range_var",
        primary=("impulse_noise_threshold", "depth_bin", "range_var"),
    ),
    "aa-min": Traits(
        "Masks and detection",
        "Impulse noise (min)",
        SV_LIKE,
        "mask",
        depth_param="range_var",
    ),
    "aa-transient": Traits(
        "Masks and detection",
        "Transient noise",
        SV_LIKE,
        "mask",
        depth_param="range_var",
    ),
    "aa-attenuated": Traits(
        "Masks and detection",
        "Attenuated signal",
        SV_LIKE,
        "mask",
        depth_param="range_var",
    ),
    "aa-freqdiff": Traits(
        "Masks and detection",
        "Frequency difference",
        ("sv", "mvbs"),
        "mask",
        primary=("freqABEq", "chanABEq"),
    ),
    "aa-noise-est": Traits(
        "Masks and detection", "Noise estimate", ("sv", "echodata"), "noise"
    ),
    "aa-detect-seafloor": Traits(
        "Masks and detection",
        "Seafloor",
        SV_LIKE,
        "seafloor",
        needs=("depth",),
        primary=("method", "param"),
    ),
    "aa-detect-shoal": Traits(
        "Masks and detection", "Shoals", SV_LIKE, "mask", primary=("method", "param")
    ),
    "aa-detect-transient": Traits(
        "Masks and detection",
        "Transient (detector)",
        SV_LIKE,
        "mask",
        depth_param="range_var",
        primary=("method", "param"),
    ),
    # Lines and regions
    "aa-annotate": Traits(
        "Lines and regions",
        "Bottom as a line",
        ("seafloor",),
        "lines",
        primary=("name", "tolerance"),
    ),
    # Echometrics
    "aa-abundance": Traits("Echometrics", "Abundance (Sa)", SV_LIKE, "echometric"),
    "aa-aggregation": Traits("Echometrics", "Aggregation", SV_LIKE, "echometric"),
    "aa-center-of-mass": Traits("Echometrics", "Center of mass", SV_LIKE, "echometric"),
    "aa-dispersion": Traits("Echometrics", "Dispersion", SV_LIKE, "echometric"),
    "aa-evenness": Traits("Echometrics", "Evenness", SV_LIKE, "echometric"),
    # Render
    "aa-graph": Traits(
        "Render",
        "Echogram",
        ("sv", "mvbs", "nasc", "mask", "noise", "ts"),
        "echogram",
        primary=("var", "vmin", "vmax", "cmap", "decimate"),
    ),
    "aa-plot": Traits(
        "Render",
        "Interactive plot",
        ("sv", "mvbs", "mask", "noise"),
        "html",
        primary=("var", "vmin", "vmax", "cmap"),
    ),
    "aa-tiles": Traits(
        "Render",
        "Echogram tiles",
        ("sv", "mvbs", "mask", "noise", "ts"),
        "tiles",
        echodata_flag="--echodata",
        echodata_optional=True,
        primary=("var", "y", "reduce"),
    ),
}

#: The kind each product-writing tool records (aa-tool metadata), including
#: the EchoData builders, which start chains rather than sit in them.
TOOL_KIND: dict[str, str] = {
    "aa-nc": "echodata",
    "aa-ed": "echodata",
    "aa-combine": "echodata",
    "aa-ecs": "calibration",
    **{name: traits.produces for name, traits in TRAITS.items()},
}

#: Options a stage never shows: the Workbench decides them for every stage.
HIDDEN = {
    "input_path",
    "input_paths",
    "inputs",
    "output_path",
    "dest",
    "base",
    "force",
    "quiet",
    "debug",
    "no_overwrite",
    "help",
    "version",
    "json",
    "tee",
    "echodata",
}


# --------------------------------------------------------------------------- #
# Wire models
# --------------------------------------------------------------------------- #
ParamType = Literal["bool", "number", "integer", "text", "choice", "list"]


class ToolParam(BaseModel):
    id: str
    label: str
    type: ParamType
    default: Any = None
    choices: list[str] = Field(default_factory=list)
    #: The flag a value is given with (``--range_bin``).
    flag: str = ""
    #: For a bool: the flag that sets True, and the one that sets False.
    trueFlag: str = ""
    falseFlag: str = ""
    help: str = ""
    #: Changes the product, so its hash and its name's <hash8>.
    science: bool = False
    required: bool = False
    #: Shown before the rest.
    primary: bool = False
    #: A list given by repeating the flag (argparse "append"); otherwise a
    #: list is one flag followed by its values (nargs="*").
    repeat: bool = False
    #: Takes products in the bucket (gs:// URIs) of these kinds: a line file,
    #: an ECS, a mask. Empty for an ordinary option.
    productKinds: list[str] = Field(default_factory=list)


class ToolDef(BaseModel):
    name: str
    label: str
    group: str
    summary: str = ""
    consumes: list[str]
    produces: str
    level: str = ""
    needs: list[str] = Field(default_factory=list)
    depthParam: str = ""
    adds: list[str] = Field(default_factory=list)
    echodataFlag: str = ""
    echodataRequired: bool = False
    echodataWhen: list[str] = Field(default_factory=list)
    echodataOptional: bool = False
    passthrough: bool = False
    params: list[ToolParam] = Field(default_factory=list)
    #: The tool's own words on what it reads and how it chains.
    reads: str = ""
    chaining: str = ""
    examples: list[str] = Field(default_factory=list)


class Catalogue(BaseModel):
    tools: list[ToolDef] = Field(default_factory=list)
    kinds: dict[str, str] = Field(default_factory=lambda: dict(KIND_LABELS))
    levels: dict[str, str] = Field(default_factory=lambda: dict(LEVELS))
    groups: list[str] = Field(default_factory=lambda: list(GROUPS))
    aalibraryVersion: str = ""
    #: Tools this Workbench knows how to chain that the installed aalibrary lacks.
    missing: list[str] = Field(default_factory=list)
    #: Where how the tools chain came from: "aalibrary" (its chaining table)
    #: or "workbench" (this module's own copy, for an older aalibrary).
    traitsSource: str = "workbench"
    problem: str = ""
    checkedAt: str = ""


# --------------------------------------------------------------------------- #
# Asking the installed aalibrary
# --------------------------------------------------------------------------- #
INTROSPECT = r"""
import argparse, contextlib, importlib, io, json, pkgutil, re, sys
import aalibrary.console as console
try:
    from importlib.metadata import version
    aal = version("aalibrary")
except Exception:
    aal = ""
wanted = set(json.loads(sys.argv[1]))
try:
    from aalibrary.console._core import chaining
    table = chaining.table()
    wanted |= set(table.get("tools") or {})
except Exception:
    table = None
out = {"aalibrary": aal, "tools": {}, "chaining": table}
for info in pkgutil.iter_modules(console.__path__):
    if not info.name.startswith("aa_"):
        continue
    name = "aa-" + info.name[3:].replace("_", "-")
    if name not in wanted:
        continue
    try:
        quiet = io.StringIO()
        with contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
            module = importlib.import_module("aalibrary.console." + info.name)
            build = getattr(module, "_build_parser", None)
            parser = (build or getattr(module, "build_parser"))()
    except Exception as exc:
        out["tools"][name] = {"error": f"{type(exc).__name__}: {exc}"}
        continue
    spec = getattr(module, "SPEC", None)
    help_ = getattr(module, "HELP", None)
    actions = []
    for action in parser._actions:
        if isinstance(action, argparse._HelpAction):
            continue
        default = action.default
        if isinstance(default, float) and default != default:
            default = None  # NaN: "not given"
        if not isinstance(default, (str, int, float, bool, list, type(None))):
            default = None
        actions.append({
            "dest": action.dest,
            "flags": list(action.option_strings),
            "kind": type(action).__name__,
            "nargs": action.nargs if isinstance(action.nargs, (str, int)) else None,
            "type": getattr(action.type, "__name__", None) if action.type else None,
            "default": default,
            "choices": [str(c) for c in action.choices] if action.choices else [],
            "help": "" if action.help == argparse.SUPPRESS else (action.help or ""),
            "required": bool(action.required),
        })
    options = {}
    for entry in (getattr(help_, "options", None) or []):
        try:
            flags, text = entry
        except (TypeError, ValueError):
            continue
        for flag in re.findall(r"--?[A-Za-z][\w-]*", flags):
            options.setdefault(flag, text)
    out["tools"][name] = {
        "role": getattr(spec, "role", ""),
        "kind": getattr(spec, "kind", ""),
        "science": sorted((getattr(spec, "params", None) or {}).keys()),
        "summary": getattr(help_, "summary", "") or "",
        "reads": getattr(help_, "stdin", "") or "",
        "chaining": getattr(help_, "pipeline", "") or "",
        "examples": list(getattr(help_, "examples", None) or []),
        "scienceText": dict(getattr(help_, "science", None) or {}),
        "options": options,
        "actions": actions,
    }
print(json.dumps(out))
"""

#: How long an answer is kept; an aalibrary update is noticed after this.
CACHE_SECONDS = 600

_lock = threading.Lock()
_cached: tuple[float, Catalogue] | None = None


def _interpreter() -> str:
    """The Python the console tools run under, else this one."""
    from .workspace import _interpreter as of_script

    try:
        tool = jobs.resolve_tool("aa-sv")
    except HTTPException:
        return sys.executable
    return of_script(tool) or sys.executable


def _introspect() -> dict:
    """Ask the installed aalibrary about the tools in :data:`TRAITS`."""
    done = subprocess.run(  # noqa: S603 - our own script, argv only
        [_interpreter(), "-c", INTROSPECT, json.dumps(sorted(TRAITS))],
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
        stdin=subprocess.DEVNULL,
    )
    lines = [line for line in done.stdout.splitlines() if line.startswith("{")]
    if done.returncode != 0 or not lines:
        tail = (done.stderr.strip().splitlines() or ["no output"])[-1]
        raise RuntimeError(f"could not read the installed console tools: {tail}")
    return json.loads(lines[-1])


#: Words the tools' option names abbreviate, as a reader would write them.
_WORDS = {
    "snr": "SNR",
    "sv": "Sv",
    "ts": "TS",
    "dpi": "DPI",
    "nmea": "NMEA",
    "cmap": "colour map",
    "vmin": "lowest value",
    "vmax": "highest value",
    "ymin": "top",
    "ymax": "bottom",
    "num": "count",
    "freqabeq": "frequency difference",
    "chanabeq": "channel difference",
    "sl": "(sound layer)",
    "kwargs": "options",
    "env": "environment",
    "cal": "calibration",
    "ph": "pH",
}


def _label(dest: str) -> str:
    words = dest.replace("_", " ").replace("-", " ").split()
    text = " ".join(_WORDS.get(word.lower(), word) for word in words)
    return text[:1].upper() + text[1:] if text else dest


def _long(flags: list[str]) -> str:
    """The flag to write: the first long one, as the tool's help spells it."""
    longs = [flag for flag in flags if flag.startswith("--")]
    return longs[0] if longs else (flags[0] if flags else "")


def _params(name: str, info: dict, traits: Traits) -> list[ToolParam]:
    science = set(info.get("science") or [])
    options: dict[str, str] = info.get("options") or {}
    science_text: dict[str, str] = info.get("scienceText") or {}
    by_dest: dict[str, list[dict]] = {}
    order: list[str] = []
    for action in info.get("actions") or []:
        dest = action.get("dest", "")
        if not action.get("flags") or dest in HIDDEN:
            continue
        if dest not in by_dest:
            order.append(dest)
        by_dest.setdefault(dest, []).append(action)

    params: list[ToolParam] = []
    for dest in order:
        group = by_dest[dest]
        kinds = {a["kind"] for a in group}
        help_text = next((a["help"] for a in group if a["help"]), "")
        flag_help = next(
            (options[f] for a in group for f in a["flags"] if f in options), ""
        )
        text = help_text or flag_help or science_text.get(dest, "")
        first = group[0]
        product_kinds = dict(traits.inputs).get(dest, ())
        param = ToolParam(
            id=dest,
            label=_label(dest),
            type="text",
            help=text,
            science=dest in science or bool(product_kinds),
            required=any(a["required"] for a in group)
            or dest in traits.required_inputs,
            primary=dest in traits.primary,
            productKinds=list(product_kinds),
        )
        if kinds & {"_StoreTrueAction", "_StoreFalseAction", "BooleanOptionalAction"}:
            param.type = "bool"
            true_flags = [a for a in group if a["kind"] == "_StoreTrueAction"]
            false_flags = [a for a in group if a["kind"] == "_StoreFalseAction"]
            optional = [a for a in group if a["kind"] == "BooleanOptionalAction"]
            default = first.get("default")
            param.default = bool(default) if default is not None else False
            if optional:
                flags = optional[0]["flags"]
                param.trueFlag = next(
                    (f for f in flags if not f.startswith("--no-")), ""
                )
                param.falseFlag = next((f for f in flags if f.startswith("--no-")), "")
            else:
                if true_flags:
                    param.trueFlag = _long(true_flags[0]["flags"])
                if false_flags:
                    param.falseFlag = _long(false_flags[0]["flags"])
            if not param.trueFlag and not param.falseFlag:
                continue
        elif kinds & {"_AppendAction"} or first.get("nargs") in ("*", "+"):
            param.type = "list"
            param.flag = _long(first["flags"])
            param.repeat = "_AppendAction" in kinds
            default = first.get("default")
            param.default = (
                [str(v) for v in default] if isinstance(default, list) else []
            )
        else:
            param.flag = _long(first["flags"])
            default = first.get("default")
            if first.get("choices"):
                param.type = "choice"
                param.choices = list(first["choices"])
            elif first.get("type") == "int":
                param.type = "integer"
            elif first.get("type") == "float":
                param.type = "number"
            if isinstance(default, float) and math.isnan(default):
                default = None
            param.default = default
        params.append(param)
    params.sort(
        key=lambda p: (not p.primary, traits.primary.index(p.id) if p.primary else 0)
    )
    return params


def traits_from(raw: dict) -> tuple[dict[str, Traits], str]:
    """How the tools chain: aalibrary's own table when the installed aalibrary
    has one (it knows its tools; a new tool needs no Workbench change), else
    this module's copy. Also brings the kinds and levels it names here."""
    table = raw.get("chaining") or {}
    items = table.get("tools") if isinstance(table, dict) else None
    if not items:
        return dict(TRAITS), "workbench"
    traits: dict[str, Traits] = {}
    for name, item in items.items():
        if isinstance(item, dict) and TOOL_RE_NAME.fullmatch(str(name)):
            try:
                traits[name] = Traits.from_table(item)
            except (TypeError, ValueError):
                continue
    for name, local in TRAITS.items():
        traits.setdefault(name, local)
    for kind, about in (table.get("kinds") or {}).items():
        if isinstance(about, dict) and isinstance(kind, str):
            LEVELS.setdefault(kind, str(about.get("level") or ""))
            KIND_LABELS.setdefault(kind, str(about.get("label") or kind))
    for tool_name, kind in (table.get("toolKind") or {}).items():
        if isinstance(kind, str):
            TOOL_KIND.setdefault(str(tool_name), kind)
    return traits, "aalibrary"


TOOL_RE_NAME = __import__("re").compile(r"aa-[a-z][a-z0-9-]{1,40}")


def build(raw: dict) -> Catalogue:
    """The catalogue from an introspection answer (separate, for the tests)."""
    tools: list[ToolDef] = []
    missing: list[str] = []
    traits_map, source = traits_from(raw)
    for name, traits in traits_map.items():
        info = (raw.get("tools") or {}).get(name)
        if not info or info.get("error"):
            missing.append(name)
            continue
        tools.append(
            ToolDef(
                name=name,
                label=traits.label,
                group=traits.group,
                summary=info.get("summary", ""),
                consumes=list(traits.consumes),
                produces=traits.produces,
                level=LEVELS.get(traits.produces, ""),
                needs=list(traits.needs),
                depthParam=traits.depth_param,
                adds=list(traits.adds),
                echodataFlag=traits.echodata_flag,
                echodataRequired=traits.echodata_required,
                echodataWhen=list(traits.echodata_when),
                echodataOptional=traits.echodata_optional,
                passthrough=traits.passthrough,
                params=_params(name, info, traits),
                reads=info.get("reads", ""),
                chaining=info.get("chaining", ""),
                examples=list(info.get("examples") or []),
            )
        )
    return Catalogue(
        tools=tools,
        aalibraryVersion=str(raw.get("aalibrary", "")),
        missing=missing,
        traitsSource=source,
        groups=[g for g in GROUPS],
        kinds=dict(KIND_LABELS),
        levels=dict(LEVELS),
        checkedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )


def get(*, refresh: bool = False) -> Catalogue:
    """The catalogue, asked of aalibrary at most every few minutes."""
    global _cached
    with _lock:
        if _cached and not refresh and time.monotonic() - _cached[0] < CACHE_SECONDS:
            return _cached[1]
        try:
            catalogue = build(_introspect())
        except (OSError, subprocess.SubprocessError, RuntimeError, ValueError) as exc:
            catalogue = Catalogue(
                problem=(
                    f"The console tools could not be read ({exc}). Is aalibrary "
                    "installed in the Workbench's environment?"
                ),
                missing=list(TRAITS),
            )
            # Asked again soon, not in ten minutes.
            _cached = (time.monotonic() - CACHE_SECONDS + 30, catalogue)
            return catalogue
        _cached = (time.monotonic(), catalogue)
        return catalogue


def age() -> float:
    """Seconds since the tools were last read (a refresh is not repeated
    within seconds: it is a subprocess importing every tool)."""
    with _lock:
        return time.monotonic() - _cached[0] if _cached else float("inf")


def _reset_for_tests(raw: dict | None = None) -> None:
    global _cached
    with _lock:
        _cached = (time.monotonic(), build(raw)) if raw is not None else None


def tool(catalogue: Catalogue, name: str) -> ToolDef | None:
    return next((t for t in catalogue.tools if t.name == name), None)


# --------------------------------------------------------------------------- #
# Values and argv
# --------------------------------------------------------------------------- #
def coerce(param: ToolParam, value: Any) -> Any:
    """*value* as the parameter's type; ValueError says why not."""
    if param.type == "bool":
        if isinstance(value, bool):
            return value
        if isinstance(value, str) and value.lower() in ("true", "false"):
            return value.lower() == "true"
        raise ValueError(f"{param.label}: on or off, not {value!r}")
    if param.type == "list":
        if isinstance(value, str):
            value = value.split()
        if not isinstance(value, list):
            raise ValueError(f"{param.label}: a list, not {value!r}")
        items = [str(item).strip() for item in value if str(item).strip()]
        if any("\x00" in item or "\n" in item for item in items):
            raise ValueError(
                f"{param.label}: one value per line, no control characters"
            )
        if param.productKinds:
            for item in items:
                _product_uri(param, item)
        return items
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if param.type == "integer":
        try:
            number = float(value)
        except (TypeError, ValueError):
            raise ValueError(f"{param.label}: a whole number, not {value!r}") from None
        if not number.is_integer():
            raise ValueError(f"{param.label}: a whole number, not {value!r}")
        return int(number)
    if param.type == "number":
        try:
            number = float(value)
        except (TypeError, ValueError):
            raise ValueError(f"{param.label}: a number, not {value!r}") from None
        if math.isnan(number) or math.isinf(number):
            raise ValueError(f"{param.label}: a finite number")
        return (
            int(number)
            if number.is_integer() and not isinstance(value, float)
            else number
        )
    text = str(value).strip()
    if "\x00" in text or "\n" in text:
        raise ValueError(f"{param.label}: one line, no control characters")
    if param.productKinds:
        _product_uri(param, text)
    if param.type == "choice" and text not in param.choices:
        raise ValueError(
            f"{param.label}: one of {', '.join(param.choices)}, not {text!r}"
        )
    return text


def _product_uri(param: ToolParam, text: str) -> None:
    """A product option takes a product in a bucket: one gs:// URI."""
    from .gcp import BUCKET_RE

    if not text.startswith("gs://"):
        raise ValueError(
            f"{param.label}: a product in the bucket (gs://...), not {text!r}"
        )
    bucket, _, key = text[len("gs://") :].partition("/")
    if (
        not BUCKET_RE.fullmatch(bucket)
        or not key.strip("/")
        or ".." in key.split("/")
        or any(ord(ch) < 32 or ord(ch) == 127 for ch in text)
    ):
        raise ValueError(f"{param.label}: not a product URI: {text!r}")


def effective(tool_def: ToolDef, values: dict[str, Any]) -> dict[str, Any]:
    """Every parameter's value: the chosen one, else the tool's default."""
    out: dict[str, Any] = {}
    for param in tool_def.params:
        out[param.id] = values.get(param.id, param.default)
    return out


def clean_values(
    tool_def: ToolDef, values: dict[str, Any]
) -> tuple[dict[str, Any], list[str]]:
    """The values that differ from the tool's defaults, and what was wrong."""
    by_id = {p.id: p for p in tool_def.params}
    kept: dict[str, Any] = {}
    problems: list[str] = []
    for key, raw in (values or {}).items():
        param = by_id.get(key)
        if param is None:
            problems.append(f"{tool_def.name} has no setting {key!r} (any more?).")
            continue
        try:
            value = coerce(param, raw)
        except ValueError as exc:
            problems.append(f"{tool_def.name}: {exc}")
            continue
        if _same(value, param.default):
            continue
        kept[key] = value
    for param in tool_def.params:
        if (
            param.required
            and kept.get(param.id) in (None, "", [])
            and param.default
            in (
                None,
                "",
                [],
            )
        ):
            problems.append(
                f"{tool_def.name} needs {param.flag or param.id} ({param.label})."
            )
    return kept, problems


def _same(value: Any, default: Any) -> bool:
    if value is None or value == [] or value == "":
        return default in (None, [], "")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            return float(value) == float(default)
        except (TypeError, ValueError):
            return False
    return value == default


def _text(value: Any) -> str:
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def option_args(tool_def: ToolDef, values: dict[str, Any]) -> list[str]:
    """The flags for the values that differ from the defaults, in the tool's order.

    Valued options are written ``--flag=value``, so a negative number (``--vmin
    -80``) is never read as a flag.
    """
    args: list[str] = []
    for param in tool_def.params:
        if param.id not in values:
            continue
        value = values[param.id]
        if param.type == "bool":
            flag = param.trueFlag if value else param.falseFlag
            if flag:
                args.append(flag)
        elif param.type == "list":
            if param.flag and value:
                if param.repeat:
                    args.extend(f"{param.flag}={item}" for item in value)
                else:
                    # nargs="*": one flag, then its values (a repeated flag
                    # would keep only the last).
                    args.extend([param.flag, *value])
        elif value is not None and param.flag:
            args.append(f"{param.flag}={_text(value)}")
    return args


def stage_argv(
    tool_def: ToolDef,
    values: dict[str, Any],
    input_uri: str,
    dest: str,
    *,
    echodata: str = "",
    force: bool = False,
) -> list[str]:
    """The argv after the tool's name: input, options, where it goes."""
    args = [input_uri, *option_args(tool_def, values)]
    if echodata and tool_def.echodataFlag:
        args.append(f"{tool_def.echodataFlag}={echodata}")
    args.append(f"--dest={dest}")
    if force:
        args.append("--force")
    return args
