import { useSyncExternalStore } from 'react';

import type {
  RecipeInputValues,
  RecipeVerb,
} from '../components/panels/recipes/recipeCommand';
import { recipesSource } from '../components/panels/recipes/recipeService';
import type { RecipeSummary } from '../components/panels/recipes/recipeTypes';

/**
 * Recipe state shared across docks — the recipes analogue of
 * `state/pipelines.ts`, and deliberately smaller.
 *
 * The pipelines store owns definitions, drafts, and named saved
 * configurations, because for pipelines the store IS the source of truth.
 * For recipes the YAML file is the source of truth and `aa-recipe` is the
 * authority, so this store holds only what the *session* adds on top: which
 * recipes were discovered, which card is focused, and the `--input` overrides
 * typed so far. There is nothing to "save" here — saving a recipe means
 * editing its YAML, which is the editor's job, not this store's.
 *
 * Module store rather than context for the same reason as every other store:
 * Dockview mounts panels through portals, and this state is read from the
 * centre (cards), the right dock (configuration) and the chrome (DockLayout
 * fronting Configuration).
 */

export type RecipesStatus = 'idle' | 'loading' | 'ready' | 'error';

interface RecipesState {
  status: RecipesStatus;
  root: string | null;
  /** The listing came from the snapshot bundled with the Workbench. */
  builtin: boolean;
  recipes: RecipeSummary[];
  /** A listing-level problem (no directory, endpoint refused, …). */
  listError: string | null;
  activeRecipeId: string | null;
  /** recipeId → `--input` override values typed by the user. */
  inputValues: Record<string, RecipeInputValues>;
  /** recipeId → the verb its run controls are set to. */
  verbs: Record<string, RecipeVerb>;
  /** recipeId → extra flags appended verbatim. */
  extraFlags: Record<string, string>;
  /** Whether recipe paths are real files on this machine (API mode). */
  filesOnDisk: boolean;
}

let state: RecipesState = {
  status: 'idle',
  root: null,
  builtin: false,
  recipes: [],
  listError: null,
  activeRecipeId: null,
  inputValues: {},
  verbs: {},
  extraFlags: {},
  filesOnDisk: recipesSource.capabilities.filesOnDisk,
};

const listeners = new Set<() => void>();

function emit(next: RecipesState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

export function getRecipesState(): RecipesState {
  return state;
}

export function subscribeRecipes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useRecipes(): RecipesState {
  return useSyncExternalStore(subscribeRecipes, getRecipesState, getRecipesState);
}

export function getRecipe(
  current: RecipesState,
  id: string | null,
): RecipeSummary | undefined {
  return id ? current.recipes.find((recipe) => recipe.id === id) : undefined;
}

/** Load (or reload) the listing. Concurrent calls collapse onto one flight. */
export async function loadRecipes(): Promise<void> {
  if (state.status === 'loading') return;
  emit({ ...state, status: 'loading', listError: null });
  try {
    const listing = await recipesSource.list();
    emit({
      ...state,
      status: 'ready',
      root: listing.root,
      builtin: listing.builtin ?? false,
      recipes: listing.recipes,
      listError: listing.error,
      // A vanished recipe should not leave a dangling focus.
      activeRecipeId: listing.recipes.some((r) => r.id === state.activeRecipeId)
        ? state.activeRecipeId
        : null,
    });
  } catch (error) {
    emit({
      ...state,
      status: 'error',
      listError: error instanceof Error ? error.message : String(error),
    });
  }
}

export function setActiveRecipe(id: string | null): void {
  if (state.activeRecipeId === id) return;
  emit({ ...state, activeRecipeId: id });
}

export function setRecipeInput(recipeId: string, name: string, value: string): void {
  const current = state.inputValues[recipeId] ?? {};
  emit({
    ...state,
    inputValues: {
      ...state.inputValues,
      [recipeId]: { ...current, [name]: value },
    },
  });
}

export function clearRecipeInputs(recipeId: string): void {
  const next = { ...state.inputValues };
  delete next[recipeId];
  emit({ ...state, inputValues: next });
}

export function setRecipeVerb(recipeId: string, verb: RecipeVerb): void {
  emit({ ...state, verbs: { ...state.verbs, [recipeId]: verb } });
}

export function setRecipeExtraFlags(recipeId: string, flags: string): void {
  emit({ ...state, extraFlags: { ...state.extraFlags, [recipeId]: flags } });
}
