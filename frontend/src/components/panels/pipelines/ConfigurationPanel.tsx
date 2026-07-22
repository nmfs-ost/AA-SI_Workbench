import { useState } from 'react';
import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Snackbar,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import SaveOutlined from '@mui/icons-material/SaveOutlined';
import SaveAsOutlined from '@mui/icons-material/SaveAsOutlined';
import RestartAltOutlined from '@mui/icons-material/RestartAltOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';

import { PanelPlaceholder } from '../PanelPlaceholder';
import { RecipeConfiguration } from '../recipes/RecipeConfiguration';
import { useConfigurationFocus } from '../../../state/configurationFocus';
import { useActiveAsset } from '../../../state/activeAsset';
import {
  currentConfig,
  deleteConfig,
  getPipeline,
  isDirty,
  revertDraft,
  saveAsNew,
  saveOverwrite,
  selectConfig,
  setParam,
  usePipelines,
} from '../../../state/pipelines';
import { ParamControl } from './ParamControl';
import type { PipelineValues, StageDef } from './pipelineTypes';
import {
  COMMAND_OVERRIDE,
  INPUT_TOKEN,
  buildCommand,
  defaultValues,
  templateFrom,
} from './pipelineTypes';

/**
 * Configuration panel — appears (and fronts itself) whenever a pipeline card is
 * focused in the Pipelines panel.
 *
 * The form is generated from the pipeline definition: every stage, every
 * parameter, each rendered as the control its type calls for. Edits update the
 * shared draft, so the card's compact widget and this panel always agree. A
 * modified configuration can be saved over the current one or saved as a new
 * named configuration; built-in defaults are protected from overwriting.
 */
/**
 * Lets the user take over a stage's command line.
 *
 * The two requirements pull against each other: hand-written commands need
 * total freedom (any tool, any pipe, any flag the catalogue never heard of),
 * but the workspace must still be able to swap the input file underneath them.
 *
 * A template reconciles them. The command is stored with `{input}` standing in
 * for the selected file, and the token is substituted every time the command is
 * built — so clicking a different file in the workspace re-targets a
 * hand-written command exactly as it re-targets a generated one. The editor
 * seeds itself with the real generated command so the token is discovered by
 * example rather than by reading help text.
 */
function StageCommandEditor({
  stage,
  values,
  injectedInput,
  onChange,
}: {
  stage: StageDef;
  values: PipelineValues;
  injectedInput: string | null;
  onChange: (next: string) => void;
}) {
  const theme = useTheme();
  const stored = values[stage.id]?.[COMMAND_OVERRIDE];
  const override = typeof stored === 'string' ? stored : '';
  const editing = stage.freeform || override.length > 0;

  const start = () => onChange(templateFrom(stage, values, injectedInput));

  if (!editing) {
    return (
      <Button
        size="small"
        startIcon={<EditOutlined sx={{ fontSize: 14 }} />}
        onClick={start}
        sx={{ mt: 1, alignSelf: 'flex-start', fontSize: 11, textTransform: 'none' }}
      >
        Edit command
      </Button>
    );
  }

  const missingToken = Boolean(injectedInput) && !override.includes(INPUT_TOKEN);

  return (
    <Box sx={{ mt: 1.25 }}>
      <TextField
        fullWidth
        multiline
        minRows={2}
        size="small"
        value={override}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`aa-sv ${INPUT_TOKEN} | grep -v WARNING`}
        InputProps={{
          sx: { fontFamily: theme.aa.font.mono, fontSize: 11.5 },
        }}
      />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
        <Typography sx={{ fontSize: 10.5, color: theme.aa.color.text.muted }}>
          {INPUT_TOKEN} is replaced by the selected file, so swapping files still
          works. Pipes and any other tool are fine here.
        </Typography>
        <Box sx={{ flex: 1 }} />
        {!stage.freeform && (
          <Button
            size="small"
            onClick={() => onChange('')}
            sx={{ fontSize: 10.5, textTransform: 'none', flexShrink: 0 }}
          >
            Use form
          </Button>
        )}
      </Box>
      {missingToken && (
        <Typography sx={{ fontSize: 10.5, color: theme.aa.color.status.warning }}>
          No {INPUT_TOKEN} in this command — it will ignore the selected file and
          read from the previous stage instead.
        </Typography>
      )}
    </Box>
  );
}

export const ConfigurationPanel: FunctionComponent<IDockviewPanelProps> = () => {
  /* One Configuration tab, two independent systems behind it. The focus store
     (written only by DockLayout, from whichever card was activated last) picks
     which branch renders. The recipe branch is a separate component with its
     own store and schema — the two systems share this window, not a model. */
  const focus = useConfigurationFocus();
  if (focus === 'recipes') return <RecipeConfiguration />;
  return <PipelineConfiguration />;
};

const PipelineConfiguration: FunctionComponent = () => {
  const theme = useTheme();
  const state = usePipelines();
  const asset = useActiveAsset();

  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const pipelineId = state.activePipelineId;
  const pipeline = pipelineId ? getPipeline(state, pipelineId) : undefined;

  if (!pipeline || !pipelineId) {
    return (
      <PanelPlaceholder
        icon={SettingsOutlined}
        title="Configuration"
        description="Select a pipeline in the Pipelines panel to configure it."
      />
    );
  }

  const values = state.drafts[pipelineId] ?? defaultValues(pipeline);
  const config = currentConfig(state, pipelineId);
  const dirty = isDirty(state, pipelineId);
  const injectedInput = asset?.fileName ?? null;
  const configs = state.configs[pipelineId] ?? [];
  const isBuiltin = config?.builtin === true;

  const handleSave = () => {
    if (saveOverwrite(pipelineId)) {
      setToast(`Saved “${config?.name}”.`);
    } else {
      // Built-in configurations can't be overwritten — steer to Save as new.
      setNewName(`${config?.name ?? 'Configuration'} (copy)`);
      setSaveAsOpen(true);
    }
  };

  const handleSaveAs = () => {
    saveAsNew(pipelineId, newName);
    setSaveAsOpen(false);
    setToast(`Saved new configuration “${newName.trim() || 'Untitled configuration'}”.`);
  };

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: theme.aa.color.bg.panel,
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
        <SettingsOutlined sx={{ fontSize: 16 }} />
        <Typography sx={{ fontSize: 12, fontWeight: 600, flex: 1, minWidth: 0 }} noWrap>
          {pipeline.name}
        </Typography>
        {dirty && (
          <Chip
            label="modified"
            size="small"
            sx={{
              height: 17,
              fontSize: 10,
              backgroundColor: theme.aa.color.accent.soft,
              color: theme.aa.color.accent.main,
            }}
          />
        )}
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 1.25 }}>
        <Typography
          sx={{ fontSize: 11.5, color: theme.aa.color.text.secondary, mb: 1.25 }}
        >
          {pipeline.description}
        </Typography>

        {/* Configuration selector */}
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-start', mb: 1.5 }}>
          <TextField
            select
            size="small"
            fullWidth
            label="Configuration"
            value={config?.id ?? ''}
            onChange={(e) => selectConfig(pipelineId, e.target.value)}
            sx={{ '& .MuiInputBase-root': { fontSize: 12.5 } }}
          >
            {configs.map((c) => (
              <MenuItem key={c.id} value={c.id} sx={{ fontSize: 12.5 }}>
                {c.name}
                {c.builtin ? ' (built-in)' : ''}
              </MenuItem>
            ))}
          </TextField>
          {config && !config.builtin && (
            <Tooltip title="Delete this configuration">
              <IconButton
                size="small"
                onClick={() => {
                  deleteConfig(pipelineId, config.id);
                  setToast(`Deleted “${config.name}”.`);
                }}
                sx={{ mt: 0.5 }}
              >
                <DeleteOutlineOutlined sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>

        {/* Stages — every parameter, generated from the definition */}
        {pipeline.stages.map((stage) => (
          <Box key={stage.id} sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, mb: 0.25 }}>
              <Typography
                sx={{
                  fontFamily: theme.aa.font.mono,
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: theme.aa.color.accent.main,
                }}
              >
                {stage.tool}
              </Typography>
              <Typography sx={{ fontSize: 11, color: theme.aa.color.text.muted }}>
                {stage.label}
              </Typography>
            </Box>
            <Typography
              sx={{ fontSize: 11, color: theme.aa.color.text.muted, mb: 1 }}
            >
              {stage.description}
            </Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              {stage.params.map((param) => (
                <ParamControl
                  key={param.id}
                  param={param}
                  value={values[stage.id]?.[param.id] ?? param.default}
                  onChange={(next) => setParam(pipelineId, stage.id, param.id, next)}
                  injectedInput={param.role === 'input' ? injectedInput : null}
                />
              ))}
            </Box>

            <StageCommandEditor
              stage={stage}
              values={values}
              injectedInput={injectedInput}
              onChange={(next) =>
                setParam(pipelineId, stage.id, COMMAND_OVERRIDE, next)
              }
            />

            <Divider sx={{ mt: 1.75 }} />
          </Box>
        ))}

        {/* Command preview */}
        <Typography sx={{ fontSize: 11.5, fontWeight: 600, mb: 0.5 }}>
          Equivalent command
        </Typography>
        <Box
          sx={{
            p: 1,
            borderRadius: `${theme.aa.radius.sm}px`,
            backgroundColor: theme.aa.color.bg.base,
            border: `1px solid ${theme.aa.color.border.subtle}`,
            fontFamily: theme.aa.font.mono,
            fontSize: 11,
            color: theme.aa.color.text.secondary,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {buildCommand(pipeline, values, injectedInput).join(' \\\n  | ')}
        </Box>
      </Box>

      {/* Save actions */}
      <Box
        sx={{
          borderTop: `1px solid ${theme.aa.color.border.subtle}`,
          backgroundColor: theme.aa.color.bg.chrome,
          p: 1,
          display: 'flex',
          gap: 0.75,
          flexWrap: 'wrap',
        }}
      >
        <Tooltip title={dirty ? '' : 'No changes to revert'}>
          <span style={{ display: 'flex' }}>
            <Button
              size="small"
              startIcon={<RestartAltOutlined />}
              disabled={!dirty}
              onClick={() => revertDraft(pipelineId)}
              sx={{ fontSize: 11.5 }}
            >
              Revert
            </Button>
          </span>
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant="outlined"
          startIcon={<SaveAsOutlined />}
          onClick={() => {
            setNewName(`${config?.name ?? 'Configuration'} (copy)`);
            setSaveAsOpen(true);
          }}
          sx={{ fontSize: 11.5 }}
        >
          Save as new
        </Button>
        <Tooltip
          title={
            isBuiltin
              ? 'Built-in configurations can’t be overwritten — save as new instead'
              : ''
          }
        >
          <span style={{ display: 'flex' }}>
            <Button
              size="small"
              variant="contained"
              startIcon={<SaveOutlined />}
              disabled={!dirty}
              onClick={handleSave}
              sx={{ fontSize: 11.5 }}
            >
              Save
            </Button>
          </span>
        </Tooltip>
      </Box>

      {/* Save-as dialog */}
      <Dialog open={saveAsOpen} onClose={() => setSaveAsOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 15, fontWeight: 600 }}>
          Save as new configuration
        </DialogTitle>
        <DialogContent dividers>
          <Typography sx={{ fontSize: 12.5, mb: 1.5 }}>
            Saves the current settings for <b>{pipeline.name}</b> under a new name,
            leaving “{config?.name}” unchanged.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Configuration name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setSaveAsOpen(false)}>
            Cancel
          </Button>
          <Button size="small" variant="contained" onClick={handleSaveAs}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={toast !== null}
        autoHideDuration={3500}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity="success"
          variant="filled"
          onClose={() => setToast(null)}
          sx={{ fontSize: 12.5 }}
        >
          {toast}
        </Alert>
      </Snackbar>
    </Box>
  );
};
