import {
  Box,
  Button,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import TerminalOutlined from '@mui/icons-material/TerminalOutlined';

import { useLayout } from '../../../context/LayoutContext';
import { sendToTerminal } from '../../../state/terminal';
import {
  setRecipeVerb,
  useRecipes,
} from '../../../state/recipes';
import type { RecipeSummary } from './recipeTypes';
import type { RecipeVerb } from './recipeCommand';
import {
  RECIPE_VERBS,
  buildRecipeCommand,
  missingRequiredInputs,
  wiredOnlyInputs,
} from './recipeCommand';

interface Props {
  recipe: RecipeSummary;
}

/**
 * The action strip for the focused recipe: pick a verb, see the exact command,
 * send it to the terminal.
 *
 * Differences from `PipelineRunControls`, each following from what `aa-recipe`
 * actually is rather than from taste:
 *
 *  - **One recipe, not a selection.** The CLI takes one recipe per invocation.
 *  - **Three verbs, Validate first.** `dry-run` is his system's validator and
 *    the honest first thing to run against a file this panel has only *read* —
 *    the Workbench deliberately does not re-implement his validation.
 *  - **The terminal handoff is a convenience, not a constraint.** `aa-recipe`
 *    is a real batch CLI (no prompts, meaningful exit codes) — unlike
 *    `aa-fetch` it COULD be driven by a background job runner, and should be
 *    once one exists. The terminal is simply where output is visible today.
 */
export function RecipeRunControls({ recipe }: Props) {
  const theme = useTheme();
  const { openPanel } = useLayout();
  const state = useRecipes();

  const verb: RecipeVerb = state.verbs[recipe.id] ?? 'dry-run';
  const values = state.inputValues[recipe.id] ?? {};
  const extraFlags = state.extraFlags[recipe.id] ?? '';
  const command = buildRecipeCommand(recipe, verb, values, extraFlags);

  const missing = missingRequiredInputs(recipe, values);
  const wiredOnly = wiredOnlyInputs(recipe);
  // A sub-recipe (required dataset/echodata inputs) can be validated and
  // generated on its own, but running it directly cannot work: nothing can
  // supply those inputs from a command line.
  const subRecipeBlocked = verb === 'run' && wiredOnly.length > 0;
  const blocked = Boolean(recipe.error) || subRecipeBlocked || (verb === 'run' && missing.length > 0);

  const blockedReason = recipe.error
    ? 'This file could not be read as a recipe.'
    : subRecipeBlocked
      ? `Sub-recipe: ${wiredOnly.map((d) => d.name).join(', ')} can only be wired by a parent recipe (input_overrides). Validate or generate it here; run its parent.`
      : missing.length > 0
        ? `Required inputs not set: ${missing.map((d) => d.name).join(', ')}`
        : null;

  const activeVerb = RECIPE_VERBS.find((v) => v.id === verb);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <ToggleButtonGroup
        size="small"
        exclusive
        fullWidth
        value={verb}
        onChange={(_, next: RecipeVerb | null) => next && setRecipeVerb(recipe.id, next)}
      >
        {RECIPE_VERBS.map((entry) => (
          <ToggleButton
            key={entry.id}
            value={entry.id}
            sx={{ fontSize: 11, textTransform: 'none' }}
          >
            {entry.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {activeVerb && (
        <Typography sx={{ fontSize: 10.5, color: theme.aa.color.text.muted }}>
          {activeVerb.description}
        </Typography>
      )}

      {/* The command, exactly as it will be typed. */}
      <Box
        sx={{
          p: 0.85,
          borderRadius: `${theme.aa.radius.sm}px`,
          backgroundColor: theme.aa.color.bg.base,
          border: `1px solid ${theme.aa.color.border.subtle}`,
          fontFamily: theme.aa.font.mono,
          fontSize: 11,
          color: theme.aa.color.text.secondary,
          overflowWrap: 'anywhere',
        }}
      >
        {command}
      </Box>

      {blockedReason && (
        <Typography sx={{ fontSize: 10.5, color: theme.aa.color.status.warning }}>
          {blockedReason}
        </Typography>
      )}

      <Tooltip
        title={
          state.filesOnDisk
            ? 'Types the command into the Terminal panel. aa-recipe runs without prompts; its output appears there.'
            : 'Mock data — these recipe files are not on this machine, so the command is a preview. Run with the backend (VITE_AASI_USE_API) against a real recipes folder.'
        }
      >
        <span>
          <Button
            size="small"
            fullWidth
            variant="outlined"
            disabled={blocked || !state.filesOnDisk}
            startIcon={<TerminalOutlined sx={{ fontSize: 14 }} />}
            onClick={() => {
              openPanel('terminal');
              sendToTerminal(command, { origin: 'Recipes', execute: true });
            }}
            sx={{ fontSize: 11.5, textTransform: 'none' }}
          >
            Run in Terminal
          </Button>
        </span>
      </Tooltip>
    </Box>
  );
}
