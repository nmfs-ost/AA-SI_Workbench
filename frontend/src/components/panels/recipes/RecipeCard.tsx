import { Box, Tooltip, Typography, useTheme } from '@mui/material';
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import InputOutlined from '@mui/icons-material/InputOutlined';
import MenuBookOutlined from '@mui/icons-material/MenuBookOutlined';

import type { RecipeSummary } from './recipeTypes';
import { recipeSummaryLine, stepLabel } from './recipeTypes';

interface Props {
  recipe: RecipeSummary;
  active: boolean;
  onActivate: () => void;
}

/**
 * One recipe as a card — the visual peer of `PipelineCard`, describing a
 * different kind of thing.
 *
 * A pipeline card pictures a *command chain*; this pictures a *file*: the
 * YAML's own name, description and step list, read from disk and shown as-is.
 * There is no checkbox because there is no multi-select run — `aa-recipe`
 * takes one recipe per invocation, and pretending otherwise would compose a
 * command his CLI doesn't accept. Clicking focuses the card, which opens its
 * configuration (the recipe's `inputs:` block) in the Configuration panel.
 *
 * Step chips distinguish op steps from `include:` steps — an include is
 * another whole recipe folded in, and his modular examples lean on that, so
 * flattening the two into identical chips would misdescribe the file.
 */
export function RecipeCard({ recipe, active, onActivate }: Props) {
  const theme = useTheme();
  const broken = Boolean(recipe.error);

  return (
    <Box
      onClick={onActivate}
      sx={{
        borderRadius: `${theme.aa.radius.md}px`,
        border: `1px solid ${
          active ? theme.aa.color.accent.main : theme.aa.color.border.subtle
        }`,
        backgroundColor: active ? theme.aa.color.bg.selected : theme.aa.color.bg.panel,
        p: 1.1,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
        transition: 'border-color 120ms, background-color 120ms',
        '&:hover': { borderColor: theme.aa.color.accent.main },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        {broken ? (
          <ErrorOutlineOutlined
            sx={{ fontSize: 15, color: theme.aa.color.status.error }}
          />
        ) : (
          <MenuBookOutlined sx={{ fontSize: 15, color: theme.aa.color.text.muted }} />
        )}
        <Typography
          sx={{
            fontSize: 12.5,
            fontWeight: 600,
            color: theme.aa.color.text.primary,
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {recipe.name}
        </Typography>
        {recipe.version && (
          <Typography sx={{ fontSize: 10.5, color: theme.aa.color.text.muted }}>
            v{recipe.version}
          </Typography>
        )}
      </Box>

      <Tooltip title={recipe.path}>
        <Typography
          sx={{
            fontSize: 10.5,
            fontFamily: theme.aa.font.mono,
            color: theme.aa.color.text.muted,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {recipe.fileName}
        </Typography>
      </Tooltip>

      {broken ? (
        <Typography sx={{ fontSize: 11.5, color: theme.aa.color.status.error }}>
          {recipe.error}
        </Typography>
      ) : (
        <>
          {recipe.description && (
            <Typography sx={{ fontSize: 11.5, color: theme.aa.color.text.secondary }}>
              {recipe.description}
            </Typography>
          )}

          {/* The DAG as a strip. YAML order — the author's order — not a
              topological sort: this is a picture of the file, and the executor
              is where ordering authority lives. */}
          {recipe.steps.length > 0 && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 0.25,
                p: 0.6,
                borderRadius: `${theme.aa.radius.sm}px`,
                backgroundColor: theme.aa.color.bg.base,
                border: `1px solid ${theme.aa.color.border.subtle}`,
              }}
            >
              {recipe.steps.map((step, index) => (
                <Box
                  key={`${stepLabel(step)}-${index}`}
                  sx={{ display: 'flex', alignItems: 'center' }}
                >
                  <Tooltip
                    title={
                      step.include
                        ? `Includes ${step.include} — a sub-recipe composed into this one.`
                        : step.description ?? step.id ?? ''
                    }
                  >
                    <Typography
                      sx={{
                        px: 0.6,
                        py: 0.3,
                        borderRadius: `${theme.aa.radius.sm}px`,
                        backgroundColor: theme.aa.color.bg.panel,
                        border: step.include
                          ? `1px dashed ${theme.aa.color.border.strong}`
                          : `1px solid ${theme.aa.color.border.subtle}`,
                        fontFamily: theme.aa.font.mono,
                        fontSize: 9.5,
                        fontStyle: step.include ? 'italic' : 'normal',
                        color: theme.aa.color.text.secondary,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {stepLabel(step)}
                    </Typography>
                  </Tooltip>
                  {index < recipe.steps.length - 1 && (
                    <ChevronRightOutlined
                      sx={{ fontSize: 12, color: theme.aa.color.text.disabled }}
                    />
                  )}
                </Box>
              ))}
            </Box>
          )}

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <InputOutlined sx={{ fontSize: 12, color: theme.aa.color.text.muted }} />
            <Typography sx={{ fontSize: 10.5, color: theme.aa.color.text.muted }}>
              {recipeSummaryLine(recipe)}
            </Typography>
          </Box>
        </>
      )}
    </Box>
  );
}
