import { useEffect } from 'react';
import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { Box, CircularProgress, Tooltip, Typography, useTheme } from '@mui/material';
import MenuBookOutlined from '@mui/icons-material/MenuBookOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';

import {
  getRecipesState,
  loadRecipes,
  setActiveRecipe,
  useRecipes,
} from '../../../state/recipes';
import { RecipeCard } from './RecipeCard';

/**
 * Recipes panel — aa-recipe-manager's YAML recipes, as cards.
 *
 * The centre-tab peer of Pipelines, deliberately integrating a *different*
 * system rather than a second flavour of the same one. A pipeline is composed
 * inside this app and the app is its source of truth; a recipe is a YAML file
 * on disk, discovered here, configured through its own `inputs:` block, and
 * validated/executed by the `aa-recipe` CLI — the Workbench reads recipes but
 * never rewrites, re-encodes, or re-validates them.
 *
 * That is why there is no "Create new recipe" card where Pipelines has one:
 * creating a recipe means writing YAML against his schema, and a half-faithful
 * builder would fork the format. The file editor already edits YAML; the
 * honest affordance is Open YAML on the focused recipe (in the Configuration
 * panel), not a parallel authoring UI.
 *
 * Clicking a card focuses it; DockLayout notices the store change and fronts
 * the Configuration panel, exactly as it does for pipeline cards. This panel
 * never calls openPanel itself — the chrome owns that translation.
 */
export const RecipesPanel: FunctionComponent<IDockviewPanelProps> = () => {
  const theme = useTheme();
  const state = useRecipes();

  /* First mount loads the listing; a reopened panel reuses what it has.
     Deliberately mount-only ([]): the guard reads status at mount, and
     re-running on status changes would turn every error into a retry loop. */
  useEffect(() => {
    if (getRecipesState().status === 'idle') void loadRecipes();
  }, []);

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: theme.aa.color.bg.editor,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.25,
          minHeight: 30,
          borderBottom: `1px solid ${theme.aa.color.border.subtle}`,
          color: theme.aa.color.text.secondary,
        }}
      >
        <MenuBookOutlined sx={{ fontSize: 16 }} />
        <Typography sx={{ fontSize: 12, fontWeight: 600, flex: 1 }}>Recipes</Typography>
        <Typography sx={{ fontSize: 11, color: theme.aa.color.text.muted }}>
          {state.status === 'ready' ? `${state.recipes.length} found` : ''}
        </Typography>
        <Tooltip title="Re-scan the recipes folder">
          <Box
            component="button"
            onClick={() => void loadRecipes()}
            sx={{
              display: 'flex',
              alignItems: 'center',
              background: 'none',
              border: `1px solid ${theme.aa.color.border.subtle}`,
              borderRadius: `${theme.aa.radius.sm}px`,
              color: theme.aa.color.text.secondary,
              cursor: 'pointer',
              px: 0.5,
              py: 0.2,
              '&:hover': {
                borderColor: theme.aa.color.accent.main,
                color: theme.aa.color.accent.main,
              },
            }}
          >
            <RefreshOutlined sx={{ fontSize: 14 }} />
          </Box>
        </Tooltip>
      </Box>

      {/* Where these came from */}
      {state.root && (
        <Typography
          sx={{
            px: 1.25,
            py: 0.5,
            fontSize: 10.5,
            fontFamily: theme.aa.font.mono,
            color: theme.aa.color.text.muted,
            borderBottom: `1px solid ${theme.aa.color.border.subtle}`,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {state.root}
          {!state.filesOnDisk && ' · mock data'}
        </Typography>
      )}

      {/* Cards */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          p: 1.25,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
        }}
      >
        {state.status === 'loading' && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={18} />
          </Box>
        )}

        {state.listError && (
          <Typography sx={{ fontSize: 11.5, color: theme.aa.color.status.warning }}>
            {state.listError}
          </Typography>
        )}

        {state.status === 'ready' && state.recipes.length === 0 && !state.listError && (
          <Typography sx={{ fontSize: 11.5, color: theme.aa.color.text.muted }}>
            No recipes found. Recipes are YAML files with a `recipe:` block and
            a `steps:` list — set AASI_RECIPES_DIR to point at a folder of
            them.
          </Typography>
        )}

        {state.recipes.map((recipe) => (
          <RecipeCard
            key={recipe.id}
            recipe={recipe}
            active={state.activeRecipeId === recipe.id}
            // Focusing is all that happens here: DockLayout's subscription
            // notices the store change, fronts Configuration, and sets the
            // focus arbiter — one path, shared with the pipelines feature.
            onActivate={() => setActiveRecipe(recipe.id)}
          />
        ))}
      </Box>
    </Box>
  );
};
