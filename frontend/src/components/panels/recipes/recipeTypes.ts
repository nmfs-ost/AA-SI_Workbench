/**
 * Types for the Recipes feature — the Workbench's view of **aa-recipe-manager**
 * (Brett Layman's system), integrated as a peer of the Pipelines feature, not
 * a variant of it.
 *
 * The two systems answer the same question — "how do I run a workflow?" — with
 * different primitives, and this module is where the difference is kept
 * visible rather than papered over:
 *
 *   Pipelines (this repo)              Recipes (aa-recipe-manager)
 *   ─────────────────────              ───────────────────────────
 *   source of truth: TS definitions    source of truth: YAML files on disk
 *   unit: a console-tool chain         unit: a declarative DAG of ops
 *   configure: per-stage flags         configure: pipeline-level `inputs:`
 *   compose: buildCommand() → shell    compose: `aa-recipe <verb> file.yaml`
 *   authority: the definitions here    authority: the `aa-recipe` CLI
 *
 * So a RecipeSummary is deliberately *shallow*: name, description, the
 * `inputs:` block (which is what a user configures), and the step list as a
 * picture. The Workbench never re-encodes a recipe into its own schema and
 * never validates one — `aa-recipe dry-run` is the validator, offered as a
 * first-class verb.
 */

/** One entry of a recipe's `inputs:` block. Mirrors the backend model. */
export interface RecipeInputDecl {
  name: string;
  /** aa-recipe-manager types seen in the wild: path, str, list, int, float,
      bool — plus dataset/echodata on sub-recipes, which a parent recipe wires
      and a user cannot supply. */
  type: string;
  description?: string | null;
  default?: unknown;
  required: boolean;
}

/** One entry of `steps:` — an op step, or an `include:` of another recipe. */
export interface RecipeStepSummary {
  id?: string | null;
  op?: string | null;
  description?: string | null;
  include?: string | null;
}

export interface RecipeSummary {
  /** Path relative to the recipes root; stable across refreshes. */
  id: string;
  /** Absolute path — what `aa-recipe` is handed. */
  path: string;
  fileName: string;
  name: string;
  version?: string | null;
  description?: string | null;
  author?: string | null;
  schemaVersion?: string | null;
  inputs: RecipeInputDecl[];
  steps: RecipeStepSummary[];
  /** Set when the file names itself a recipe but could not be read as one. */
  error?: string | null;
}

export interface RecipesListing {
  root: string | null;
  recipes: RecipeSummary[];
  error: string | null;
}

/** What a recipe input renders as in the configuration form. */
export type RecipeControlKind = 'path' | 'string' | 'number' | 'boolean' | 'list' | 'wired';

/**
 * Map an aa-recipe-manager input type onto a form control.
 *
 * `dataset`/`echodata` (and anything else unrecognised that looks like an
 * object) come from sub-recipes meant to be composed by a parent via
 * `input_overrides` — a user cannot type one into a text field, and
 * `--input name=value` cannot express one. Those render as a read-only
 * "wired by a parent recipe" row instead of a control that would lie.
 */
export function controlKindFor(type: string): RecipeControlKind {
  switch (type.toLowerCase()) {
    case 'path':
      return 'path';
    case 'str':
    case 'string':
      return 'string';
    case 'int':
    case 'integer':
    case 'float':
    case 'number':
      return 'number';
    case 'bool':
    case 'boolean':
      return 'boolean';
    case 'list':
      return 'list';
    default:
      return 'wired';
  }
}

/** The label a step chip shows: the op for op steps, the file for includes. */
export function stepLabel(step: RecipeStepSummary): string {
  if (step.include) return step.include;
  return step.op ?? step.id ?? '?';
}

/** A short "N steps · M inputs" line for the card. */
export function recipeSummaryLine(recipe: RecipeSummary): string {
  const steps = recipe.steps.length;
  const includes = recipe.steps.filter((s) => s.include).length;
  const inputs = recipe.inputs.length;
  const parts = [`${steps} step${steps === 1 ? '' : 's'}`];
  if (includes > 0) parts.push(`${includes} include${includes === 1 ? '' : 's'}`);
  parts.push(`${inputs} input${inputs === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
