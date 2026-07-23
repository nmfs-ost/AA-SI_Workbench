# SPDX-License-Identifier: Apache-2.0
"""Recipe discovery for the Recipes panel.

Lists and summarises the YAML recipes of **aa-recipe-manager** (Brett Layman's
system, https://github.com/BLayman-NOAA/AA-SI_recipe_manager) so the frontend
can show them as cards and generate a configuration form from each recipe's
`inputs:` block.

── The boundary this module keeps ──────────────────────────────────────────────
aa-recipe-manager is a separate system with its own philosophy: a recipe is a
declarative DAG in a YAML file, validated and executed by the `aa-recipe` CLI.
This module deliberately does NOT import that library and does NOT validate
recipes. It reads just enough of each file for *display* — name, description,
inputs, step list — and everything authoritative (validation, DAG resolution,
include expansion, execution) stays with `aa-recipe`, which the UI invokes.

Two reasons, both load-bearing:
  1. The library may not be importable here. Its own README installs it into a
     dedicated Conda env (`recipe-manager`); the Workbench runs in `venv313`.
     The one thing both arrangements share is the `aa-recipe` command on a
     shell's PATH — so the command, not the import, is the integration point.
  2. Re-implementing his validation would fork it. A recipe this module calls
     valid and `aa-recipe` calls broken (or vice versa) is worse than showing
     the file and letting his tool be the judge. `dry-run` exists for exactly
     this and the UI offers it as a first-class action.

The parsing here mirrors only the *shape* his `yaml_reader._flatten_recipe_yaml`
accepts — a `recipe:` metadata block beside top-level `inputs:`/`steps:` — and
treats everything else as opaque.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/recipes", tags=["recipes"])

# Only this many directory levels below the root are scanned. Recipe folders
# are shallow (aa-recipe-manager's own example_recipes is flat, with data in
# subfolders); an unbounded walk under $HOME would be the real cost.
MAX_SCAN_DEPTH = 2

# A file larger than this is not a recipe someone hand-wrote; skip rather than
# parse. (The largest shipped example is ~14 kB.)
MAX_RECIPE_BYTES = 512 * 1024

# Stop after this many recipes so a pathological directory cannot flood the
# panel. Generous: the whole shipped example set is ~20 files.
MAX_RECIPES = 200


class RecipeInputModel(BaseModel):
    """One entry of a recipe's `inputs:` block, as the form needs it."""

    name: str
    type: str = "str"
    description: str | None = None
    default: Any = None
    required: bool = True


class RecipeStepModel(BaseModel):
    """One entry of `steps:` — either an op step or an `include:` of another
    recipe. Includes are shown, not resolved; resolution is `aa-recipe`'s job."""

    id: str | None = None
    op: str | None = None
    description: str | None = None
    include: str | None = None


class RecipeModel(BaseModel):
    id: str
    path: str
    fileName: str
    name: str
    version: str | None = None
    description: str | None = None
    author: str | None = None
    schemaVersion: str | None = None
    inputs: list[RecipeInputModel] = []
    steps: list[RecipeStepModel] = []
    """Set when the file names itself a recipe but could not be read as one.
    The card renders the reason instead of the file silently vanishing."""
    error: str | None = None


class RecipesResponse(BaseModel):
    root: str | None = None
    """True when `root` is the bundled snapshot rather than a user folder —
    the panel labels it so nobody edits "their" recipes inside site-packages."""
    builtin: bool = False
    recipes: list[RecipeModel] = []
    """A reason the listing itself is unavailable (no directory, unreadable).
    Like /api/derived, this endpoint never raises: the panel needs something
    to render, and a 502 leaves it with nothing."""
    error: str | None = None


def builtin_recipes_root() -> Path:
    """The example recipes bundled with the Workbench.

    Verbatim copies of aa-recipe-manager's example_recipes (see the README,
    LICENSE and NOTICE in that folder for provenance and terms), shipped as
    package data so a fresh install has real recipes to show. A snapshot, not
    a source: the live checkout supersedes it the moment one exists.
    """
    return Path(__file__).resolve().parent.parent / "builtin_recipes"


def recipes_root() -> tuple[Path, bool] | None:
    """The directory recipes are discovered in, and whether it is the bundled
    snapshot.

    `AASI_RECIPES_DIR` wins when set — including when it points somewhere
    broken, because an explicit override that silently fell back to the bundle
    would hide the misconfiguration. Otherwise the first existing of the places
    recipes actually land on a workstation: the example_recipes folder of a
    home-directory clone of aa-recipe-manager (where its README installs it),
    then `~/recipes` for a user's own files, then the bundled snapshot so the
    panel is never empty out of the box.
    """
    override = os.environ.get("AASI_RECIPES_DIR", "").strip()
    if override:
        return Path(override).expanduser(), False
    home = Path.home()
    for candidate in (
        home / "AA-SI_recipe_manager" / "example_recipes",
        home / "recipes",
    ):
        if candidate.is_dir():
            return candidate, False
    builtin = builtin_recipes_root()
    if builtin.is_dir():
        return builtin, True
    return None


def _iter_yaml_files(root: Path) -> list[Path]:
    """Every .yaml/.yml under root, at most MAX_SCAN_DEPTH levels down,
    sorted for a stable listing. Symlinked directories are not followed —
    the same escape `files.py` refuses, refused the same way."""
    found: list[Path] = []

    def walk(directory: Path, depth: int) -> None:
        try:
            entries = sorted(directory.iterdir())
        except OSError:
            return
        for entry in entries:
            if entry.name.startswith("."):
                continue
            if entry.is_dir() and not entry.is_symlink():
                if depth < MAX_SCAN_DEPTH:
                    walk(entry, depth + 1)
            elif entry.suffix.lower() in (".yaml", ".yml") and entry.is_file():
                found.append(entry)

    walk(root, 0)
    return found


def _as_str(value: Any) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


def _parse_inputs(raw: Any) -> list[RecipeInputModel]:
    if not isinstance(raw, dict):
        return []
    inputs: list[RecipeInputModel] = []
    for name, decl in raw.items():
        if not isinstance(name, str):
            continue
        if not isinstance(decl, dict):
            inputs.append(RecipeInputModel(name=name))
            continue
        default = decl.get("default")
        # Mirrors InputDeclaration.set_required_from_default in his model: a
        # declared default makes the input optional whatever `required` says.
        required = bool(decl.get("required", True)) and default is None
        inputs.append(
            RecipeInputModel(
                name=name,
                type=_as_str(decl.get("type")) or "str",
                description=_as_str(decl.get("description")),
                default=default,
                required=required,
            )
        )
    return inputs


def _parse_steps(raw: Any) -> list[RecipeStepModel]:
    if not isinstance(raw, list):
        return []
    steps: list[RecipeStepModel] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        steps.append(
            RecipeStepModel(
                id=_as_str(entry.get("id")),
                op=_as_str(entry.get("op")),
                description=_as_str(entry.get("description")),
                include=_as_str(entry.get("include")),
            )
        )
    return steps


def _looks_like_recipe(raw: Any) -> bool:
    """The filter that keeps non-recipe YAML out of the panel.

    A recipe file has a `recipe:` metadata mapping AND a `steps:` list — the
    shape `yaml_reader._flatten_recipe_yaml` merges. This is what excludes the
    *other* YAML that lives beside recipes in the wild: per-user run configs
    (`*.config.yaml`, flat keys like `output_dir:`), the older section-style
    workshop configs in AA-SI_Full_Pipeline_Example (`data_retrieval:`,
    `masking:` …), and his registry spec files (`op:` at top level). Those are
    all legitimate files that are simply not recipes, so they are skipped
    silently rather than listed as errors.
    """
    return (
        isinstance(raw, dict)
        and isinstance(raw.get("recipe"), dict)
        and isinstance(raw.get("steps"), list)
    )


def _names_itself_a_recipe(text: str) -> bool:
    """Cheap check used only when YAML parsing fails: does the raw text carry a
    top-level `recipe:` key? If so the author meant it as a recipe and the
    parse failure is worth surfacing; if not, it is just someone else's broken
    YAML and none of this panel's business."""
    return any(line.rstrip() == "recipe:" for line in text.splitlines())


def summarize_recipe(path: Path, root: Path) -> RecipeModel | None:
    """One file → one card, or None when the file is not a recipe at all."""
    rel = path.relative_to(root).as_posix()
    base = RecipeModel(
        id=rel,
        path=str(path),
        fileName=path.name,
        name=path.stem,
    )

    try:
        if path.stat().st_size > MAX_RECIPE_BYTES:
            return None
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        base.error = f"Could not read file: {exc}"
        return base

    try:
        raw = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        if _names_itself_a_recipe(text):
            base.error = f"YAML parse error: {exc}"
            return base
        return None

    if not _looks_like_recipe(raw):
        return None

    meta = raw["recipe"]
    base.name = _as_str(meta.get("name")) or path.stem
    base.version = _as_str(meta.get("version"))
    base.description = _as_str(meta.get("description"))
    base.author = _as_str(meta.get("author"))
    base.schemaVersion = _as_str(str(meta.get("schema_version", "")) or None)
    base.inputs = _parse_inputs(raw.get("inputs"))
    base.steps = _parse_steps(raw.get("steps"))
    return base


def list_recipes() -> RecipesResponse:
    resolved = recipes_root()
    if resolved is None:
        return RecipesResponse(
            error=(
                "No recipes directory found. Set AASI_RECIPES_DIR, or clone "
                "AA-SI_recipe_manager into your home directory (its "
                "example_recipes folder is discovered automatically)."
            )
        )
    root, builtin = resolved
    if not root.is_dir():
        return RecipesResponse(
            root=str(root),
            error=f"Recipes directory does not exist: {root}",
        )

    recipes: list[RecipeModel] = []
    for path in _iter_yaml_files(root):
        summary = summarize_recipe(path, root)
        if summary is not None:
            recipes.append(summary)
            if len(recipes) >= MAX_RECIPES:
                break
    return RecipesResponse(root=str(root), builtin=builtin, recipes=recipes)


def _remote_blocked() -> bool:
    """The same loopback rule every route that touches the machine keeps: a
    non-loopback bind exposes the filesystem listing, so it is refused unless
    explicitly allowed. Mirrors AASI_ALLOW_REMOTE_FS et al."""
    if os.environ.get("AASI_ALLOW_REMOTE_RECIPES", "").lower() == "true":
        return False
    bind_host = os.environ.get("AASI_BIND_HOST", "127.0.0.1")
    return bind_host not in ("127.0.0.1", "localhost", "::1")


@router.get("", response_model=RecipesResponse)
def get_recipes() -> RecipesResponse | JSONResponse:
    if _remote_blocked():
        return JSONResponse(
            status_code=403,
            content={
                "detail": (
                    "Recipe listing is disabled when the server is bound to a "
                    "non-loopback address. Set AASI_ALLOW_REMOTE_RECIPES=true "
                    "to allow it."
                )
            },
        )
    return list_recipes()
