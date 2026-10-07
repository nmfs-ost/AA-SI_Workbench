import { useState } from 'react';
import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import {
  Box,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import { ExpandMoreRounded, TerminalRounded, TuneOutlined } from '@mui/icons-material';

import type { Catalogue, PipelineSpec, Plan } from '../../../services/pipelinesApi';
import {
  discardEdits,
  effective,
  isEdited,
  resetStage,
  saveEdits,
  setOwnStep,
  setStageParam,
  usePipelines,
} from '../../../state/pipelines';
import { useConfigurationFocus } from '../../../state/configurationFocus';
import { PanelHeader } from '../PanelHeader';
import { PanelPlaceholder } from '../PanelPlaceholder';
import { RecipeConfiguration } from '../recipes/RecipeConfiguration';
import { LevelChip, Note } from '../prepare/ui';
import { OwnStepEditor } from './OwnStepEditor';
import { ParamField } from './ParamField';
import { isOwn, kindLabel, stageLabel, toolOf } from './chain';

/**
 * The Configuration panel: the settings of the open pipeline's stages, or of
 * the open recipe. One tab, two independent systems; `configurationFocus` says
 * whose item it shows.
 */
export const ConfigurationPanel: FunctionComponent<IDockviewPanelProps> = () => {
  const focus = useConfigurationFocus();
  if (focus === 'recipes') return <RecipeConfiguration />;
  return <PipelineConfiguration />;
};

/**
 * Every setting of every stage, from the installed tools: their flags, their
 * defaults, their own help. Changes apply to the card at once (the plan and the
 * next run use them) and are kept until saved or discarded; a built-in
 * pipeline is saved as the user's own copy.
 */
function PipelineConfiguration() {
  const theme = useTheme();
  const c = theme.aa.color;
  const s = usePipelines();
  const spec = effective(s, s.activePipelineId);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  if (!spec) {
    return (
      <PanelPlaceholder
        icon={TuneOutlined}
        panelTitle="Configuration"
        title="Pipeline settings"
        description="Open a pipeline in Pipelines and its stages' settings appear here, read from the installed console tools."
      />
    );
  }
  const edited = isEdited(s, spec.id);
  const save = async (asName?: string) => {
    setError('');
    try {
      await saveEdits(spec.id, asName);
      setNaming(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: c.bg.panel, minHeight: 0 }}>
      <PanelHeader
        icon={<TuneOutlined className="panel-header-icon" />}
        title="Configuration"
        subtitle={spec.name}
        actions={
          edited ? (
            <>
              <Button size="small" onClick={() => discardEdits(spec.id)} sx={{ textTransform: 'none', fontSize: 11.5 }}>
                Discard
              </Button>
              <Button
                size="small"
                variant="contained"
                disableElevation
                onClick={() => {
                  if (spec.builtin) {
                    setName(`${spec.name} (mine)`);
                    setNaming(true);
                  } else void save();
                }}
                sx={{ textTransform: 'none', fontSize: 11.5, py: 0.2 }}
              >
                {spec.builtin ? 'Save as mine…' : 'Save'}
              </Button>
            </>
          ) : undefined
        }
      />
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 1.5, py: 1.25 }}>
        {edited && (
          <Box sx={{ mb: 1.25 }}>
            <Note tone="info">
              Changed settings apply to this card’s plan and runs now.{' '}
              {spec.builtin ? 'Save as your own pipeline to keep them.' : 'Save to keep them.'}
            </Note>
          </Box>
        )}
        {error && (
          <Box sx={{ mb: 1.25 }}>
            <Note tone="error">{error}</Note>
          </Box>
        )}
        {spec.stages.map((stage, i) => (
          <StageSettings key={`${stage.tool}-${i}`} spec={spec} index={i} catalogue={s.catalogue} plan={s.plan} near={s.inputs[0]?.uri ?? ''} />
        ))}
      </Box>

      <Dialog open={naming} onClose={() => setNaming(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 15 }}>Save as your own pipeline</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNaming(false)} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disableElevation
            disabled={!name.trim()}
            onClick={() => void save(name.trim())}
            sx={{ textTransform: 'none' }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function StageSettings({
  spec,
  index,
  catalogue,
  plan,
  near,
}: {
  spec: PipelineSpec;
  index: number;
  catalogue: Catalogue | null;
  plan: Plan | null;
  /** The pipeline's input: where product options look for their choices. */
  near: string;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  const stage = spec.stages[index];
  const tool = toolOf(catalogue, stage.tool);
  const [more, setMore] = useState(false);
  const planned = plan && plan.pipelineId === spec.id ? plan.stages[index] : undefined;
  const changed = Object.keys(stage.params).length;

  if (isOwn(stage)) {
    return (
      <Box
        sx={{
          mb: 1.25,
          borderRadius: `${theme.aa.radius.md}px`,
          border: `1px dashed ${c.border.strong}`,
          backgroundColor: c.bg.editor,
          opacity: planned?.action === 'skip' ? 0.7 : 1,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            px: 1.25,
            height: 34,
            borderBottom: `1px solid ${c.border.subtle}`,
            backgroundColor: alpha(c.accent.main, 0.04),
          }}
        >
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: c.accent.main, width: 14 }}>{index + 1}</Typography>
          <TerminalRounded sx={{ fontSize: 14, color: c.text.muted }} />
          <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: c.text.primary }} noWrap>
            {stageLabel(stage, catalogue)}
          </Typography>
          <Typography sx={{ fontSize: 11, color: c.text.muted }}>
            {stage.tool === 'bash' ? 'your Bash command' : 'your Python'}
          </Typography>
        </Box>
        <Box sx={{ px: 1.25, py: 1.25 }}>
          {planned?.action === 'skip' && (
            <Typography sx={{ fontSize: 11, color: c.text.muted, mb: 1 }}>{planned.reason}</Typography>
          )}
          <OwnStepEditor stage={stage} catalogue={catalogue} onChange={(patch) => setOwnStep(spec.id, index, patch)} />
        </Box>
      </Box>
    );
  }

  if (!tool) {
    return (
      <Box sx={{ mb: 1.5 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
          {index + 1}. {stage.tool}
        </Typography>
        <Typography sx={{ fontSize: 11.5, color: c.status.error }}>Not installed: its settings cannot be read.</Typography>
      </Box>
    );
  }
  const primary = tool.params.filter((p) => p.primary || p.required || p.id in stage.params);
  const rest = tool.params.filter((p) => !primary.includes(p));

  return (
    <Box
      sx={{
        mb: 1.25,
        borderRadius: `${theme.aa.radius.md}px`,
        border: `1px solid ${c.border.subtle}`,
        backgroundColor: c.bg.editor,
        opacity: planned?.action === 'skip' ? 0.7 : 1,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.25,
          height: 34,
          borderBottom: `1px solid ${c.border.subtle}`,
          backgroundColor: alpha(c.accent.main, 0.04),
        }}
      >
        <Typography sx={{ fontSize: 11, fontWeight: 700, color: c.accent.main, width: 14 }}>{index + 1}</Typography>
        <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: c.text.primary }}>{tool.label}</Typography>
        <Typography sx={{ fontSize: 11, color: c.text.muted }}>{tool.name}</Typography>
        <Box sx={{ flex: 1 }} />
        <LevelChip level={tool.level} />
        <Typography sx={{ fontSize: 10.5, color: c.text.muted }}>{kindLabel(tool.produces, catalogue)}</Typography>
        {changed > 0 && (
          <Button size="small" onClick={() => resetStage(spec.id, index)} sx={{ fontSize: 10.5, textTransform: 'none', minWidth: 0, py: 0 }}>
            Defaults
          </Button>
        )}
      </Box>
      <Box sx={{ px: 1.25, py: 1, display: 'flex', flexDirection: 'column', gap: 1.1 }}>
        {tool.summary && <Typography sx={{ fontSize: 11.5, color: c.text.secondary, lineHeight: 1.5 }}>{tool.summary}</Typography>}
        {planned?.action === 'skip' && (
          <Typography sx={{ fontSize: 11, color: c.text.muted }}>{planned.reason}</Typography>
        )}
        {tool.params.length === 0 && (
          <Typography sx={{ fontSize: 11, color: c.text.muted }}>No settings: it does one thing.</Typography>
        )}
        {primary.map((p) => (
          <ParamField
            key={p.id}
            param={p}
            value={stage.params[p.id]}
            near={near}
            onChange={(v) => setStageParam(spec.id, index, p, v)}
          />
        ))}
        {rest.length > 0 && (
          <Box>
            <Button
              size="small"
              onClick={() => setMore((v) => !v)}
              endIcon={<ExpandMoreRounded sx={{ transform: more ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />}
              sx={{ fontSize: 11, textTransform: 'none', px: 0.5, ml: -0.5, color: c.text.secondary }}
            >
              {more ? 'Fewer settings' : `${rest.length} more settings`}
            </Button>
            <Collapse in={more} unmountOnExit>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, pt: 0.5 }}>
                {rest.map((p) => (
                  <ParamField
                    key={p.id}
                    param={p}
                    value={stage.params[p.id]}
                    near={near}
                    onChange={(v) => setStageParam(spec.id, index, p, v)}
                  />
                ))}
              </Box>
            </Collapse>
          </Box>
        )}
      </Box>
    </Box>
  );
}
