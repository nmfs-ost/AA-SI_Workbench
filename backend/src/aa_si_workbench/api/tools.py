"""Automatic discovery of every `aa-*` console tool in this environment.

The problem this replaces
------------------------
Discovery used to mean "run ``--describe`` and hope". Of the tools in a real
environment, one answers it. So discovery returned *unknown* for almost
everything, and the UI rendered a badge asking the user to run ``--help`` by
hand and correct a TypeScript file — a to-do list wearing a badge, not a
discovery system.

Every one of these tools is an argparse program. The flags are in the source,
stated exactly once, and they can be read.

Four layers, best answer wins
-----------------------------
1. ``--describe`` — the tool's own structured account of itself. Authoritative
   when present, and the only layer carrying curated labels and roles.

2. **Static read of the source.** The console script's entry point names a
   module; the module's file is located through the distribution's own file
   list and parsed with ``ast``. Every ``add_argument`` call is read for its
   flag strings, ``dest``, ``default``, ``choices``, ``action`` and ``nargs``.

   Nothing is imported and nothing is executed — this is a parse, not a run. It
   works whether the parser lives in a tidy ``build_parser()`` or is built
   inline halfway down ``main()``, which matters because most of them do the
   latter.

3. ``--help`` **text.** The house style writes help by hand, so it holds the
   prose and the section grouping argparse never sees — several tools pass no
   ``help=`` at all and their entire documentation is that string. Laid over the
   flags layer 2 found, and used alone when layer 2 could not reach the source.

4. **The hand-written catalogue** in the frontend, for a tool none of the above
   could reach.

Each parameter records which layer produced it, so the UI can say where a fact
came from instead of asserting a confidence it has not earned.

Cost
----
Layer 2 is a file read and an AST walk — no subprocess. Layer 3 is one
interpreter start per tool, so the scan is cached in-process and refreshed on
request.
"""

from __future__ import annotations

import ast
import json
import os
import re
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from importlib.metadata import Distribution, distributions
from pathlib import Path

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/tools", tags=["tools"])

TOOL_PREFIX = "aa-"
HELP_TIMEOUT_SECONDS = 15

#: Flags describing how a tool talks rather than what it does. Every tool has
#: them, and listing them buries the ones that matter.
NOISE_DESTS = {"help", "quiet", "debug", "describe", "version"}

KNOWN_DESCRIBE_SCHEMAS = {"aa/describe/1", "aa/describe/2"}


class ParamInfo(BaseModel):
    """One flag, as the tool itself defines it."""

    #: argparse `dest`, or derived from the longest flag.
    id: str
    #: Every spelling, e.g. ["--chunk-pings", "--chunk_pings"].
    flags: list[str] = Field(default_factory=list)
    positional: bool = False
    #: boolean | number | string | enum — from action, type and choices.
    type: str = "string"
    default: str | int | float | bool | None = None
    choices: list[str] = Field(default_factory=list)
    required: bool = False
    nargs: str = ""
    help: str = ""
    #: The `--help` section this appeared under, when there was one.
    section: str = ""
    #: describe | source | help
    origin: str = "source"


class ToolInfo(BaseModel):
    name: str
    version: str = ""
    distribution: str = ""
    path: str = ""
    #: describe | source | help | none — the best layer that answered.
    discovery: str = "none"
    #: Where the source was read, when layer 2 answered.
    sourceFile: str = ""
    params: list[ParamInfo] = Field(default_factory=list)
    #: Opening prose of `--help`, when there was any.
    summary: str = ""
    #: Verbatim `--describe` payload, when the tool has one.
    describe: dict | None = None
    #: What went wrong, phrased as what it means rather than as a trace.
    detail: str = ""


class ToolCatalog(BaseModel):
    tools: list[ToolInfo] = Field(default_factory=list)
    total: int = 0
    #: How many yielded at least one parameter from any layer.
    discovered: int = 0
    #: layer -> count, for a one-glance summary.
    byLayer: dict[str, int] = Field(default_factory=dict)
    generatedAt: str = ""


# --------------------------------------------------------------------------- #
# Locating a tool's source without importing it
# --------------------------------------------------------------------------- #
def _module_file(dist: Distribution, module: str) -> Path | None:
    """The file defining `module`, via the distribution's own file list.

    Deliberately not ``importlib.util.find_spec``: resolving a spec imports the
    parent packages, and importing a package to find out what flags it takes is
    a side effect nobody asked for. The distribution already knows every file it
    installed, so this is a lookup.
    """
    wanted = module.replace(".", "/")
    candidates = (f"{wanted}.py", f"{wanted}/__init__.py")
    try:
        files = dist.files or []
    except Exception:  # noqa: BLE001 - a broken dist must not stop the scan
        files = []
    for entry in files:
        text = str(entry).replace("\\", "/")
        if text in candidates or text.endswith(f"/{candidates[0]}"):
            try:
                located = Path(str(dist.locate_file(entry)))
            except Exception:  # noqa: BLE001
                continue
            if located.is_file():
                return located

    # Editable installs record a `__editable__` finder rather than the real
    # files, so the list above comes back without them and the tool would fall
    # through to a subprocess. The source directory is on sys.path either way,
    # so look there — still a filesystem lookup, still no import.
    for root in sys.path:
        if not root:
            continue
        for candidate in candidates:
            found = Path(root) / candidate
            if found.is_file():
                return found
    return None


# --------------------------------------------------------------------------- #
# Layer 2 — read the flags out of the source
# --------------------------------------------------------------------------- #
def _literal(node: ast.AST):
    try:
        return ast.literal_eval(node)
    except Exception:  # noqa: BLE001 - a computed default is simply not a literal
        return None


def _type_name(node: ast.AST | None) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def _type_of(action: str | None, type_name: str | None, choices) -> str:
    if action in {"store_true", "store_false"}:
        return "boolean"
    if choices:
        return "enum"
    if type_name in {"int", "float"}:
        return "number"
    return "string"


def params_from_source(path: Path) -> list[ParamInfo]:
    """Every `add_argument` call in a file, as parameters.

    A static walk, so it finds them wherever they live — inside
    ``build_parser()``, inline in ``main()``, or in a helper. Nothing runs.
    """
    try:
        tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
    except (OSError, SyntaxError):
        return []

    found: list[ParamInfo] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not (isinstance(func, ast.Attribute) and func.attr == "add_argument"):
            continue

        names = [
            value
            for value in (_literal(arg) for arg in node.args)
            if isinstance(value, str)
        ]
        if not names:
            continue
        keywords = {kw.arg: kw.value for kw in node.keywords if kw.arg}

        def lit(key: str, _kw=keywords):
            node_ = _kw.get(key)
            return _literal(node_) if node_ is not None else None

        dest = lit("dest")
        action = lit("action")
        choices = lit("choices") or []
        nargs = lit("nargs")
        default = lit("default")
        help_text = " ".join(str(lit("help") or "").split())
        type_name = _type_name(keywords.get("type"))

        positional = not names[0].startswith("-")
        if positional:
            identifier = names[0]
        else:
            longest = max(names, key=len).lstrip("-")
            identifier = str(dest or longest.replace("-", "_"))

        if identifier in NOISE_DESTS:
            continue

        found.append(
            ParamInfo(
                id=identifier,
                flags=[] if positional else names,
                positional=positional,
                type=_type_of(
                    action if isinstance(action, str) else None, type_name, choices
                ),
                default=default
                if isinstance(default, (str, int, float, bool))
                else None,
                choices=[str(c) for c in choices] if isinstance(choices, list) else [],
                required=bool(lit("required")),
                nargs=str(nargs) if nargs is not None else "",
                help=help_text,
                origin="source",
            )
        )

    # A tool naming the same dest twice (`--consolidated` / `--no-consolidated`)
    # is one parameter with two spellings, not two parameters.
    merged: dict[str, ParamInfo] = {}
    for param in found:
        existing = merged.get(param.id)
        if existing is None:
            merged[param.id] = param
            continue
        for flag in param.flags:
            if flag not in existing.flags:
                existing.flags.append(flag)
        if not existing.help and param.help:
            existing.help = param.help
    return list(merged.values())


def help_text_from_source(path: Path) -> str:
    """The tool's own help string, read out of the file.

    The house style is a hand-written ``print_help()`` holding one long literal.
    That literal is right there in the source, so reading it costs a file read
    instead of an interpreter start — and `aa-nc` imports echopype at module
    level, so *its* interpreter start is an echopype import. Multiply that by
    every tool in the environment and the scan is the slowest thing the panel
    does.

    Picks the longest string literal that looks like help: long, and mentioning
    a usage line, a section heading, or a flag. Wrong-guess risk is low and the
    cost of a wrong guess is a description that does not match, so the test for
    "looks like help" is deliberately narrow.
    """
    try:
        tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
    except (OSError, SyntaxError):
        return ""
    best = ""
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Constant) and isinstance(node.value, str)):
            continue
        text = node.value
        # 120 rather than something rounder: aa-nc's whole help is 912 chars
        # and a terser tool could reasonably be a fifth of that. The length is
        # a cheap pre-filter; `looks_like_help` below is what actually decides,
        # and it is specific enough that a docstring will not pass it.
        if len(text) < 120 or len(text) <= len(best):
            continue
        looks_like_help = (
            "sage:" in text or "Options:" in text or "\n  --" in text
        )
        if looks_like_help:
            best = text
    return best


def supports_describe(path: Path) -> bool:
    """Whether the tool declares a ``--describe`` flag.

    Read statically so the probe is only ever run against a tool that has one.
    Firing ``--describe`` at the twenty-odd that do not is twenty-odd
    interpreter starts to be told "unrecognised argument".
    """
    try:
        tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
    except (OSError, SyntaxError):
        return False
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not (isinstance(func, ast.Attribute) and func.attr == "add_argument"):
            continue
        for arg in node.args:
            if _literal(arg) == "--describe":
                return True
    return False


# --------------------------------------------------------------------------- #
# Layer 3 — the hand-written help text
# --------------------------------------------------------------------------- #
_SECTION = re.compile(r"^\s{0,6}([A-Z][A-Za-z /&]{2,40}):\s*$")
_ENTRY = re.compile(
    r"^\s+(-{1,2}[A-Za-z0-9][^\s,]*(?:,\s*-{1,2}[^\s,]+)*)"
    r"(?:\s+[A-Z_.{|}\[\]]+)?\s{2,}(\S.*)$"
)


def parse_help(text: str) -> tuple[str, dict[str, tuple[str, str]]]:
    """Return (summary, flag -> (section, description)).

    Parsed leniently: anything unrecognised is skipped rather than guessed at,
    because a wrong description is worse than an absent one.
    """
    section = ""
    entries: dict[str, tuple[str, str]] = {}
    last_flags: list[str] = []
    summary_lines: list[str] = []
    seen_entry = False

    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip():
            last_flags = []
            continue

        heading = _SECTION.match(line)
        if heading:
            section = heading.group(1).strip()
            last_flags = []
            continue

        entry = _ENTRY.match(line)
        if entry:
            seen_entry = True
            flags = [part.strip() for part in entry.group(1).split(",")]
            description = entry.group(2).strip()
            for flag in flags:
                entries[flag] = (section, description)
            last_flags = flags
            continue

        if last_flags and line.startswith("       "):
            for flag in last_flags:
                sec, description = entries[flag]
                entries[flag] = (sec, f"{description} {line.strip()}")
            continue

        if not seen_entry and not line.lstrip().lower().startswith("usage:"):
            summary_lines.append(line.strip())

    return " ".join(summary_lines).strip()[:400], entries


def _run(path: str, args: list[str], timeout: int) -> tuple[int, str, str]:
    completed = subprocess.run(  # noqa: S603 - path comes from the console-script scan
        [path, *args],
        # Several of these read stdin when given no positionals, and this is
        # exactly the flags-only invocation that blocks on an inherited pipe.
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=str(Path.home()),
        env={**os.environ, "NO_COLOR": "1", "TERM": "dumb"},
    )
    return completed.returncode, completed.stdout, completed.stderr


# --------------------------------------------------------------------------- #
# Assembling one tool
# --------------------------------------------------------------------------- #
def discover_tool(
    name: str,
    path: str,
    dist_name: str,
    version: str,
    module: str,
    dist: Distribution | None,
) -> ToolInfo:
    """Everything knowable about one tool, preferring reads over runs.

    Ordered by cost, not by authority. A file read is microseconds; an
    interpreter start is tens of milliseconds at best and, for a tool that
    imports echopype at module level, seconds. So the source answers first and
    a subprocess runs only when the source could not.
    """
    info = ToolInfo(name=name, path=path, distribution=dist_name, version=version)
    source = _module_file(dist, module) if (dist is not None and module) else None

    # Layers 2 and 3, both static.
    help_text = ""
    if source is not None:
        info.sourceFile = str(source)
        params = params_from_source(source)
        if params:
            info.params = params
            info.discovery = "source"
        help_text = help_text_from_source(source)

    # Fall back to running --help only when the source could not be reached or
    # held no help string. On a normal install this never happens.
    if not help_text:
        try:
            _, out, err = _run(path, ["--help"], HELP_TIMEOUT_SECONDS)
            # Help goes to stdout in most of these and stderr in at least one,
            # so take whichever is longer rather than picking one and being
            # wrong.
            help_text = out if len(out) >= len(err) else err
        except (subprocess.TimeoutExpired, OSError) as exc:
            info.detail = f"--help did not return ({type(exc).__name__})."

    if help_text.strip():
        summary, entries = parse_help(help_text)
        info.summary = summary
        if info.params:
            for param in info.params:
                for flag in param.flags:
                    hit = entries.get(flag)
                    if hit:
                        param.section = param.section or hit[0]
                        if not param.help:
                            param.help = hit[1]
                            param.origin = "help"
                        break
        else:
            for flag, (section, description) in entries.items():
                if not flag.startswith("--"):
                    continue
                info.params.append(
                    ParamInfo(
                        id=flag.lstrip("-").replace("-", "_"),
                        flags=[flag],
                        section=section,
                        help=description,
                        origin="help",
                    )
                )
            if info.params:
                info.discovery = "help"

    # Layer 1 — authoritative, so it goes on top. The only subprocess this
    # function normally runs, and only for a tool the source says has the flag.
    if source is None or supports_describe(source):
        try:
            code, out, _ = _run(path, ["--describe"], HELP_TIMEOUT_SECONDS)
            if code == 0 and out.strip().startswith("{"):
                payload = json.loads(out)
                if isinstance(payload, dict):
                    info.describe = payload
                    info.discovery = "describe"
                    schema = str(payload.get("schema") or "")
                    if schema not in KNOWN_DESCRIBE_SCHEMAS:
                        info.detail = (
                            f"reports schema {schema or '(none)'}, which this "
                            "build does not know; the source read stands."
                        )
        except Exception:  # noqa: BLE001 - no --describe is the normal case
            pass

    if not info.params and not info.describe and not info.detail:
        info.detail = (
            "No flags could be read from this tool's source or help output. "
            "The hand-written catalogue entry is the fallback."
        )
    return info


def build_catalog() -> ToolCatalog:
    """Scan the whole environment.

    Discovery is static for every tool that can be read, so this is normally a
    few dozen file reads. The stragglers — a tool with no readable source, or
    one that really does have `--describe` — are probed in parallel, because
    the slow part of a probe is waiting for someone else's imports.
    """
    jobs: list[tuple] = []
    bin_dir = Path(sys.executable).parent

    for dist in distributions():
        try:
            dist_name = dist.metadata["Name"] or ""
            version = dist.version or ""
            entries = list(dist.entry_points)
        except Exception:  # noqa: BLE001
            continue
        for entry in entries:
            if entry.group != "console_scripts":
                continue
            if not entry.name.startswith(TOOL_PREFIX):
                continue
            path = bin_dir / entry.name
            module = getattr(entry, "module", "") or entry.value.split(":")[0]
            jobs.append(
                (
                    entry.name,
                    str(path) if path.exists() else entry.name,
                    dist_name,
                    version,
                    module,
                    dist,
                )
            )

    # One console script can be exposed by more than one installed
    # distribution — a stale copy alongside an editable one, most often. The
    # name is what gets run, so it is one tool, and probing it three times is
    # three interpreter starts for one answer.
    unique: dict[str, tuple] = {}
    for job in jobs:
        unique.setdefault(job[0], job)

    if unique:
        with ThreadPoolExecutor(max_workers=min(8, len(unique))) as pool:
            tools = list(pool.map(lambda args: discover_tool(*args), unique.values()))
    else:
        tools = []

    tools.sort(key=lambda tool: tool.name)
    by_layer: dict[str, int] = {}
    for tool in tools:
        by_layer[tool.discovery] = by_layer.get(tool.discovery, 0) + 1

    return ToolCatalog(
        tools=tools,
        total=len(tools),
        discovered=sum(1 for tool in tools if tool.params or tool.describe),
        byLayer=by_layer,
        generatedAt=datetime.now(UTC)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
    )


_cache: ToolCatalog | None = None
_lock = threading.Lock()


def _reset_for_tests() -> None:
    global _cache
    with _lock:
        _cache = None


@router.get("/describe", response_model=ToolCatalog)
def describe_all(refresh: bool = Query(False)) -> ToolCatalog:
    """Every `aa-*` tool in this environment, with the flags it really takes."""
    global _cache
    with _lock:
        if _cache is None or refresh:
            _cache = build_catalog()
        return _cache
