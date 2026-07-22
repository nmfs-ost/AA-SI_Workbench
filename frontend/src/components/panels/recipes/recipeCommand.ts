import { quote } from '../shellQuote';
import type { RecipeInputDecl, RecipeSummary } from './recipeTypes';
import { controlKindFor } from './recipeTypes';

/**
 * Compose an `aa-recipe` command line — the recipes analogue of the pipelines
 * feature's `buildCommand()`, built for a different contract.
 *
 * Where `buildCommand()` *is* the pipeline (the chain exists nowhere else),
 * this function is only an *invocation*: the recipe lives in its YAML file and
 * `aa-recipe` owns everything about it. All this emits is the verb, the file,
 * and `--input NAME=VALUE` overrides — precisely the surface his CLI declares.
 *
 * Unlike `aa-fetch`/`aa-get`, `aa-recipe` is a genuine batch CLI (click-based,
 * meaningful exit codes, errors to stderr, no prompts — verified by running
 * it). Handing it to the terminal is a v1 convenience while the Workbench has
 * no job runner, **not** the hard interactivity constraint the NCEI actions
 * carry. Do not extend the "never headless" rule to this tool; it is the first
 * candidate for the environment.py job-runner pattern.
 */

/** The three verbs a scientist reaches for, in the order they reach for them. */
export const RECIPE_VERBS = [
  {
    id: 'dry-run',
    label: 'Validate',
    description:
      'Check the recipe without executing anything — aa-recipe is the authority on what is valid.',
  },
  {
    id: 'generate',
    label: 'Generate notebook',
    description: 'Produce a runnable Jupyter notebook from the recipe.',
  },
  {
    id: 'run',
    label: 'Run',
    description: 'Execute the DAG in-process with checkpoint/resume.',
  },
] as const;

export type RecipeVerb = (typeof RECIPE_VERBS)[number]['id'];

export type RecipeInputValues = Record<string, string>;

/** Inputs the user must supply for a run to mean anything: required, no
    default, and actually expressible as `--input name=value`. */
export function missingRequiredInputs(
  recipe: RecipeSummary,
  values: RecipeInputValues,
): RecipeInputDecl[] {
  return recipe.inputs.filter(
    (decl) =>
      decl.required &&
      controlKindFor(decl.type) !== 'wired' &&
      !(values[decl.name] ?? '').trim(),
  );
}

/** Sub-recipe inputs (dataset/echodata/…) that only a parent recipe can wire.
    When every required input is of this kind, the file is a component, not a
    thing to run directly — the UI says so instead of failing cryptically. */
export function wiredOnlyInputs(recipe: RecipeSummary): RecipeInputDecl[] {
  return recipe.inputs.filter(
    (decl) => decl.required && controlKindFor(decl.type) === 'wired',
  );
}

function defaultAsString(decl: RecipeInputDecl): string {
  const value = decl.default;
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(',');
  return String(value);
}

/**
 * Build the exact command the Send-to-Terminal button types.
 *
 * `--input` is emitted only for values the user actually set that differ from
 * the recipe's own default: the recipe file already carries its defaults, and
 * repeating them on the command line would claim this invocation overrode
 * things it didn't. An untouched form therefore produces the shortest true
 * command — `aa-recipe run file.yaml`.
 */
export function buildRecipeCommand(
  recipe: RecipeSummary,
  verb: RecipeVerb,
  values: RecipeInputValues,
  extraFlags = '',
): string {
  const parts = ['aa-recipe', verb, quote(recipe.path)];
  for (const decl of recipe.inputs) {
    if (controlKindFor(decl.type) === 'wired') continue;
    const value = (values[decl.name] ?? '').trim();
    if (!value) continue;
    if (value === defaultAsString(decl).trim()) continue;
    parts.push('--input', quote(`${decl.name}=${value}`));
  }
  const extra = extraFlags.trim();
  if (extra) parts.push(extra);
  return parts.join(' ');
}
