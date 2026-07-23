# Bundled example recipes

**These files are not part of the AA-SI Workbench.** They are copied **verbatim**
from Brett Layman's `aa-recipe-manager`:

- Source: https://github.com/BLayman-NOAA/AA-SI_recipe_manager
- Path in source: `example_recipes/`
- Snapshot: `60fcb662338f2a3f719b38b60b3a0013cc3a16a5` (main, 2026-07-20)
- License: Apache-2.0 — see `LICENSE` and `NOTICE` in this folder, copied from
  that repository as the license requires.

They exist so a fresh Workbench install has real recipes to show: the
`/api/recipes` endpoint falls back to this folder when no user recipes
directory is found. The moment `~/AA-SI_recipe_manager` is cloned (or
`AASI_RECIPES_DIR` is set), discovery prefers that instead — the live checkout
supersedes this snapshot.

## Rules for this folder

- **Do not edit these files here.** They are his, under his license, and edits
  would silently fork his examples. To update: re-copy from the source repo and
  record the new commit hash above. To change a recipe's behavior for a run,
  override its inputs in the Recipes panel or copy it to your own folder.
- The Workbench reads these for *display*; `aa-recipe` (his CLI) is the
  authority on validating and executing them.

## What was included, and what wasn't

Included: every recipe YAML, `run_gcs.sh`, the per-recipe run-config example
(`processing_levels_pipeline_gcs.config.yaml` — his CLI auto-discovers it next
to its recipe), `calibration_files/` and `line_files/` (the HB1603 recipes'
input defaults point at these as relative siblings, so without them the
examples would name data that isn't there).

Excluded: `raw_file_inputs/` (~120 KB of `.bot`/`.idx` companions). Those are
*outputs* of the recipes' own `query_ncei_data` → `download_ncei_data` steps —
running an HB1603 example recreates them — so bundling them would ship data the
workflow exists to fetch.
