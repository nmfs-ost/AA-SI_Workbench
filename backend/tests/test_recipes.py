# SPDX-License-Identifier: Apache-2.0
"""Tests for the recipe discovery endpoint.

The parsing target is aa-recipe-manager's on-disk format, so the fixtures here
are shaped like its real files: the `recipe:` metadata block beside top-level
`inputs:`/`steps:`, `${...}` references, `include:` steps from the modular
examples — and, just as importantly, the YAML that lives *next to* recipes and
must be skipped: per-user run configs, the older section-style workshop
configs, and registry spec files.
"""

from __future__ import annotations

import pytest

from aa_si_workbench.api import recipes

# A faithful miniature of example_recipes/processing_lvl_1.yaml.
RECIPE_YAML = """\
# Processing Level 1
recipe:
  name: "processing_lvl_1"
  description: "Initial setup through calibration parameter extraction."
  version: "1.0"
  author: "<Your Name>"
  schema_version: "1"

inputs:
  raw_input_folder:
    type: path
    description: "Folder containing the raw acoustic files."
  cruise_id:
    type: str
  sonar_model:
    type: str
    default: "EK60"
  raw_file_names:
    type: list
    default: []

steps:
  - id: initial_setup
    op: initial_setup
    params:
      raw_input_folder: ${inputs.raw_input_folder}
  - id: read_raw
    op: read_raw_files
    inputs:
      raw_file_paths: ${initial_setup.raw_file_paths}
    params:
      sonar_model: ${inputs.sonar_model}
"""

# The composed shape from hb1603_survey_pipeline_modular.yaml: include steps
# have no id/op of their own.
MODULAR_YAML = """\
recipe:
  name: "modular"
  version: "1.0"
  schema_version: "1"

steps:
  - id: query_ncei
    op: query_ncei_data
  - include: processing_lvls_1_to_3.yaml
    input_overrides:
      cruise_id: "HB1603"
  - include: visualization.yaml
"""

# A per-user run config (the *.config.yaml convention): flat keys, no recipe
# block. Lives beside recipes and must not be listed.
RUN_CONFIG_YAML = """\
output_dir: gs://bucket/surveys/HB1603/recipe_cache
inputs:
  raw_input_folder: /data/raw
"""

# The older section-style config from AA-SI_Full_Pipeline_Example
# (workshop_recipe.yaml): also not an aa-recipe recipe.
WORKSHOP_STYLE_YAML = """\
data_retrieval:
  file_time_start: "2016-07-25T20:58"
masking:
  remove_surface_from_mask:
    surface_depth_m: 10.0
"""

# A registry spec file (op: at top level), the third YAML species in his repo.
SPEC_YAML = """\
op: compute_mvbs
description: Compute MVBS.
params:
  range_bin:
    type: str
"""


@pytest.fixture()
def recipe_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AASI_RECIPES_DIR", str(tmp_path))
    monkeypatch.delenv("AASI_BIND_HOST", raising=False)
    return tmp_path


def test_parses_recipe_header_inputs_and_steps(recipe_dir):
    (recipe_dir / "processing_lvl_1.yaml").write_text(RECIPE_YAML)
    result = recipes.list_recipes()
    assert result.error is None
    assert len(result.recipes) == 1
    recipe = result.recipes[0]
    assert recipe.name == "processing_lvl_1"
    assert recipe.version == "1.0"
    assert recipe.schemaVersion == "1"
    assert recipe.author == "<Your Name>"
    assert [s.op for s in recipe.steps] == ["initial_setup", "read_raw_files"]

    by_name = {i.name: i for i in recipe.inputs}
    assert by_name["raw_input_folder"].type == "path"
    assert by_name["raw_input_folder"].required is True
    # A declared default makes the input optional, mirroring his
    # InputDeclaration.set_required_from_default.
    assert by_name["sonar_model"].required is False
    assert by_name["sonar_model"].default == "EK60"
    assert by_name["raw_file_names"].default == []


def test_include_steps_are_shown_not_resolved(recipe_dir):
    (recipe_dir / "modular.yaml").write_text(MODULAR_YAML)
    [recipe] = recipes.list_recipes().recipes
    kinds = [(s.op, s.include) for s in recipe.steps]
    assert kinds == [
        ("query_ncei_data", None),
        (None, "processing_lvls_1_to_3.yaml"),
        (None, "visualization.yaml"),
    ]


def test_non_recipe_yaml_is_skipped_silently(recipe_dir):
    (recipe_dir / "real.yaml").write_text(RECIPE_YAML)
    (recipe_dir / "real.config.yaml").write_text(RUN_CONFIG_YAML)
    (recipe_dir / "workshop_recipe.yaml").write_text(WORKSHOP_STYLE_YAML)
    (recipe_dir / "compute_mvbs.yaml").write_text(SPEC_YAML)
    (recipe_dir / "notes.txt").write_text("not yaml at all")
    result = recipes.list_recipes()
    assert [r.name for r in result.recipes] == ["processing_lvl_1"]


def test_broken_yaml_surfaces_only_when_it_names_itself_a_recipe(recipe_dir):
    # Broken AND carries a top-level `recipe:` key → the author meant it as a
    # recipe, so the failure is listed for the card to render.
    (recipe_dir / "broken_recipe.yaml").write_text("recipe:\n  name: [unclosed\n")
    # Broken without that key → someone else's YAML, none of our business.
    (recipe_dir / "other_broken.yaml").write_text("a: [unclosed\n")
    result = recipes.list_recipes()
    assert len(result.recipes) == 1
    entry = result.recipes[0]
    assert entry.fileName == "broken_recipe.yaml"
    assert entry.error is not None and "parse error" in entry.error.lower()


def test_scan_depth_is_bounded_and_hidden_dirs_skipped(recipe_dir):
    (recipe_dir / "top.yaml").write_text(RECIPE_YAML)
    one = recipe_dir / "sub"
    one.mkdir()
    (one / "one_deep.yaml").write_text(MODULAR_YAML)
    three = recipe_dir / "a" / "b" / "c"
    three.mkdir(parents=True)
    (three / "too_deep.yaml").write_text(RECIPE_YAML)
    hidden = recipe_dir / ".git"
    hidden.mkdir()
    (hidden / "hidden.yaml").write_text(RECIPE_YAML)
    names = {r.fileName for r in recipes.list_recipes().recipes}
    assert names == {"top.yaml", "one_deep.yaml"}


def test_missing_directory_reports_instead_of_raising(tmp_path, monkeypatch):
    monkeypatch.setenv("AASI_RECIPES_DIR", str(tmp_path / "nope"))
    result = recipes.list_recipes()
    assert result.recipes == []
    assert result.error is not None and "does not exist" in result.error


def test_no_user_directory_falls_back_to_the_bundled_snapshot(monkeypatch, tmp_path):
    monkeypatch.setenv("AASI_RECIPES_DIR", "")
    monkeypatch.setenv("HOME", str(tmp_path))  # no user candidates exist
    result = recipes.list_recipes()
    assert result.error is None
    assert result.builtin is True
    assert result.root == str(recipes.builtin_recipes_root())
    # The bundled snapshot is aa-recipe-manager's example_recipes, verbatim:
    # 18 recipes parse and the per-recipe run config beside them is skipped.
    names = {r.fileName for r in result.recipes}
    assert len(result.recipes) == 18
    assert "processing_lvl_1.yaml" in names
    assert "hb1603_survey_pipeline_modular.yaml" in names
    assert "processing_levels_pipeline_gcs.config.yaml" not in names
    # The include graph survived the copy — the modular example still names
    # its three sub-recipes, and each of those files is itself in the bundle.
    modular = next(
        r for r in result.recipes if r.fileName == "hb1603_survey_pipeline_modular.yaml"
    )
    included = {s.include for s in modular.steps if s.include}
    assert included == {
        "processing_lvls_1_to_3.yaml",
        "visualization.yaml",
        "machine_learning.yaml",
    }
    assert included <= names
    # The HB1603 recipes' relative-path defaults point at data that is
    # actually bundled beside them.
    root = recipes.builtin_recipes_root()
    assert (root / "calibration_files" / "HB201607_cal").is_dir()
    assert any((root / "line_files").iterdir())


def test_user_directory_wins_over_the_bundled_snapshot(monkeypatch, tmp_path):
    monkeypatch.setenv("AASI_RECIPES_DIR", "")
    monkeypatch.setenv("HOME", str(tmp_path))
    user_dir = tmp_path / "AA-SI_recipe_manager" / "example_recipes"
    user_dir.mkdir(parents=True)
    (user_dir / "mine.yaml").write_text(RECIPE_YAML)
    result = recipes.list_recipes()
    assert result.builtin is False
    assert result.root == str(user_dir)
    assert [r.fileName for r in result.recipes] == ["mine.yaml"]


def test_explicit_override_never_falls_back(monkeypatch, tmp_path):
    # An override pointing somewhere broken must error loudly, not quietly
    # serve the bundle — silent fallback would hide the misconfiguration.
    monkeypatch.setenv("AASI_RECIPES_DIR", str(tmp_path / "nope"))
    result = recipes.list_recipes()
    assert result.recipes == []
    assert result.builtin is False
    assert result.error is not None and "does not exist" in result.error


def test_oversized_file_is_skipped(recipe_dir):
    big = RECIPE_YAML + ("# pad\n" * 200_000)
    assert len(big) > recipes.MAX_RECIPE_BYTES
    (recipe_dir / "huge.yaml").write_text(big)
    (recipe_dir / "ok.yaml").write_text(RECIPE_YAML)
    names = {r.fileName for r in recipes.list_recipes().recipes}
    assert names == {"ok.yaml"}


def test_remote_bind_is_refused_without_override(monkeypatch):
    monkeypatch.setenv("AASI_BIND_HOST", "0.0.0.0")
    monkeypatch.delenv("AASI_ALLOW_REMOTE_RECIPES", raising=False)
    assert recipes._remote_blocked() is True
    monkeypatch.setenv("AASI_ALLOW_REMOTE_RECIPES", "true")
    assert recipes._remote_blocked() is False
    monkeypatch.setenv("AASI_BIND_HOST", "127.0.0.1")
    monkeypatch.delenv("AASI_ALLOW_REMOTE_RECIPES", raising=False)
    assert recipes._remote_blocked() is False
