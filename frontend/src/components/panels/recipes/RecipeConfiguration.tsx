import {
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import MenuBookOutlined from '@mui/icons-material/MenuBookOutlined';
import RestartAltOutlined from '@mui/icons-material/RestartAltOutlined';

import { PanelPlaceholder } from '../PanelPlaceholder';
import { openFile } from '../../../state/editors';
import {
  clearRecipeInputs,
  getRecipe,
  setRecipeExtraFlags,
  setRecipeInput,
  useRecipes,
} from '../../../state/recipes';
import type { RecipeInputDecl, RecipeSummary } from './recipeTypes';
import { controlKindFor } from './recipeTypes';
import { RecipeRunControls } from './RecipeRunControls';

/**
 * The configuration sub-widget for the focused recipe, mounted inside the
 * shared Configuration panel when the last-focused card was a recipe.
 *
 * What "configuration" means differs between the two systems, and this widget
 * keeps the difference: a pipeline's configuration is every flag of every
 * stage, owned by the app; a recipe's configuration is its **pipeline-level
 * `inputs:` block** — the surface its author declared — and the values become
 * `--input NAME=VALUE` overrides on the `aa-recipe` command line. Step
 * parameters inside the YAML are edited in the YAML (Open YAML below); this
 * form never writes the file.
 *
 * The controls are generated from the declarations, one per input type. A
 * separate control set from the pipelines' `ParamControl` on purpose: the two
 * schemas are different systems' schemas, and threading his types through the
 * pipelines' ParamDef would quietly couple the vocabularies this feature
 * exists to keep apart.
 */

function InputControl({
  decl,
  value,
  onChange,
}: {
  decl: RecipeInputDecl;
  value: string;
  onChange: (next: string) => void;
}) {
  const theme = useTheme();
  const kind = controlKindFor(decl.type);
  const defaultText =
    decl.default === null || decl.default === undefined
      ? ''
      : Array.isArray(decl.default)
        ? decl.default.join(',')
        : String(decl.default);

  const label = `${decl.name}${decl.required ? ' *' : ''}`;
  const fieldSx = { '& .MuiInputBase-root': { fontSize: 12 } };

  if (kind === 'wired') {
    return (
      <Tooltip title="Declared for composition: a parent recipe supplies this via input_overrides. It cannot be typed as --input name=value.">
        <Box
          sx={{
            px: 1,
            py: 0.6,
            borderRadius: `${theme.aa.radius.sm}px`,
            border: `1px dashed ${theme.aa.color.border.strong}`,
            display: 'flex',
            alignItems: 'baseline',
            gap: 0.75,
          }}
        >
          <Typography
            sx={{ fontSize: 11.5, fontFamily: theme.aa.font.mono, color: theme.aa.color.text.secondary }}
          >
            {decl.name}
          </Typography>
          <Typography sx={{ fontSize: 10.5, color: theme.aa.color.text.muted }}>
            {decl.type} · wired by a parent recipe
          </Typography>
        </Box>
      </Tooltip>
    );
  }

  if (kind === 'boolean') {
    // aa-recipe parses --input values itself; true/false are the words its
    // YAML would use, so they are the words this control emits.
    const checked = (value || defaultText).toLowerCase() === 'true';
    return (
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={checked}
            onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
          />
        }
        label={
          <Typography component="span" sx={{ fontSize: 12 }}>
            {label}
          </Typography>
        }
        sx={{ ml: 0 }}
      />
    );
  }

  return (
    <TextField
      size="small"
      fullWidth
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={defaultText || undefined}
      type={kind === 'number' ? 'number' : 'text'}
      helperText={
        decl.description ??
        (kind === 'list' ? 'Comma-separated values.' : undefined)
      }
      sx={fieldSx}
      InputProps={{
        sx:
          kind === 'path' || kind === 'list'
            ? { fontFamily: theme.aa.font.mono, fontSize: 11.5 }
            : undefined,
      }}
      FormHelperTextProps={{ sx: { fontSize: 10 } }}
    />
  );
}

function RecipeForm({ recipe }: { recipe: RecipeSummary }) {
  const theme = useTheme();
  const state = useRecipes();
  const values = state.inputValues[recipe.id] ?? {};
  const extraFlags = state.extraFlags[recipe.id] ?? '';
  const touched = Object.values(values).some((v) => v.trim() !== '');

  return (
    <Box
      sx={{
        height: '100%',
        overflowY: 'auto',
        p: 1.25,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
      }}
    >
      {/* Identity — read from the YAML, shown as-is. */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <MenuBookOutlined sx={{ fontSize: 15, color: theme.aa.color.text.muted }} />
          <Typography sx={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
            {recipe.name}
          </Typography>
          {recipe.version && (
            <Typography sx={{ fontSize: 10.5, color: theme.aa.color.text.muted }}>
              v{recipe.version}
            </Typography>
          )}
        </Box>
        {recipe.description && (
          <Typography sx={{ fontSize: 11.5, color: theme.aa.color.text.secondary, mt: 0.5 }}>
            {recipe.description}
          </Typography>
        )}
        <Typography
          sx={{
            fontSize: 10.5,
            fontFamily: theme.aa.font.mono,
            color: theme.aa.color.text.muted,
            mt: 0.5,
            overflowWrap: 'anywhere',
          }}
        >
          {recipe.path}
        </Typography>
      </Box>

      <RecipeRunControls recipe={recipe} />

      <Divider />

      {/* The recipe's declared inputs. */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 600 }}>Inputs</Typography>
        <Typography sx={{ fontSize: 10.5, color: theme.aa.color.text.muted }}>
          become --input overrides · empty fields use the recipe's defaults
        </Typography>
      </Box>

      {recipe.inputs.length === 0 && (
        <Typography sx={{ fontSize: 11.5, color: theme.aa.color.text.muted }}>
          This recipe declares no inputs.
        </Typography>
      )}

      {recipe.inputs.map((decl) => (
        <InputControl
          key={decl.name}
          decl={decl}
          value={values[decl.name] ?? ''}
          onChange={(next) => setRecipeInput(recipe.id, decl.name, next)}
        />
      ))}

      <TextField
        size="small"
        fullWidth
        label="Additional flags"
        value={extraFlags}
        onChange={(e) => setRecipeExtraFlags(recipe.id, e.target.value)}
        placeholder="--output-dir ./recipe_cache --checkpoint-mode explicit"
        helperText="Appended verbatim — the full aa-recipe flag surface stays reachable."
        sx={{ '& .MuiInputBase-root': { fontSize: 12 } }}
        InputProps={{ sx: { fontFamily: theme.aa.font.mono, fontSize: 11.5 } }}
        FormHelperTextProps={{ sx: { fontSize: 10 } }}
      />

      <Box sx={{ display: 'flex', gap: 0.75 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<RestartAltOutlined sx={{ fontSize: 14 }} />}
          disabled={!touched}
          onClick={() => clearRecipeInputs(recipe.id)}
          sx={{ fontSize: 11, textTransform: 'none' }}
        >
          Clear overrides
        </Button>
        {/* Step params live in the YAML; the editor is where YAML is edited.
            Only offered when the path is a real file on this machine. */}
        {state.filesOnDisk && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<DescriptionOutlined sx={{ fontSize: 14 }} />}
            onClick={() => openFile(recipe.path, recipe.fileName)}
            sx={{ fontSize: 11, textTransform: 'none' }}
          >
            Open YAML
          </Button>
        )}
      </Box>
    </Box>
  );
}

/** The branch the shared Configuration panel renders when focus is recipes. */
export function RecipeConfiguration() {
  const state = useRecipes();
  const recipe = getRecipe(state, state.activeRecipeId);

  if (!recipe) {
    return (
      <PanelPlaceholder
        icon={MenuBookOutlined}
        title="Configuration"
        description="Select a recipe in the Recipes panel to configure it."
      />
    );
  }

  if (recipe.error) {
    return (
      <PanelPlaceholder
        icon={MenuBookOutlined}
        title={recipe.fileName}
        description={`This file could not be read as a recipe: ${recipe.error}`}
      />
    );
  }

  return <RecipeForm recipe={recipe} />;
}
