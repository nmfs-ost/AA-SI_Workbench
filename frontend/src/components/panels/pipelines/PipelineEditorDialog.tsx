import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  ListSubheader,
  Menu,
  MenuItem,
  TextField,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  AccountTreeOutlined,
  AddRounded,
  ArrowDownwardRounded,
  ArrowUpwardRounded,
  CodeRounded,
  DeleteOutlineRounded,
  ExpandMoreRounded,
  TerminalRounded,
} from '@mui/icons-material';

import type { Catalogue, PipelineSpec, StageSpec } from '../../../services/pipelinesApi';
import { savePipeline } from '../../../state/pipelines';
import { LevelChip } from '../prepare/ui';
import { Flow } from './PipelineCard';
import { OwnStepEditor } from './OwnStepEditor';
import { commandPreview, isOwn, kindLabel, ownStep, stageLabel, toolOf, walk } from './chain';

/**
 * Make a pipeline, or change one's stages: a name, and the console tools in
 * order. Only tools that read what the stage before writes can be added after
 * it; the others are listed, greyed, with what they read. Settings are edited
 * on the card afterwards (Configuration), where each tool's own defaults show.
 *
 * Not every stage is a console tool: a Bash command (tee, grep, gsutil, a
 * script) or Python code can go anywhere in the chain, written here.
 */
export function PipelineEditorDialog({
  open,
  initial,
  catalogue,
  onClose,
}: {
  open: boolean;
  /** The pipeline to edit (a saved one), a starting point (a copy), or null. */
  initial: PipelineSpec | null;
  catalogue: Catalogue | null;
  onClose: () => void;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [stages, setStages] = useState<StageSpec[]>([]);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  /** The step of your own whose command is open for editing. */
  const [openStep, setOpenStep] = useState(-1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setDescription(initial?.description ?? '');
    setStages(
      initial?.stages.map((s) =>
        isOwn(s)
          ? { tool: s.tool, params: {}, command: s.command ?? '', label: s.label ?? '', produces: s.produces ?? '' }
          : { tool: s.tool, params: { ...s.params } },
      ) ?? [],
    );
    setOpenStep(-1);
    setError('');
  }, [open, initial]);

  const steps = useMemo(() => (catalogue ? walk(stages, catalogue) : []), [stages, catalogue]);
  const lastKind = steps.length ? steps[steps.length - 1].writes : '';
  const mismatches = steps.map((s) => s.mismatch).filter(Boolean);
  const editing = Boolean(initial?.id && !initial.builtin);
  const why = !name.trim()
    ? 'Name it.'
    : stages.length === 0
      ? 'Add at least one stage.'
      : mismatches.length
        ? mismatches[0]
        : '';

  const move = (i: number, by: number) => {
    const next = [...stages];
    const [item] = next.splice(i, 1);
    next.splice(i + by, 0, item);
    setStages(next);
    if (openStep === i) setOpenStep(i + by);
    else if (openStep === i + by) setOpenStep(i);
  };
  const remove = (i: number) => {
    setStages(stages.filter((_, j) => j !== i));
    setOpenStep(openStep === i ? -1 : openStep > i ? openStep - 1 : openStep);
  };
  const addOwn = (tool: 'bash' | 'python') => {
    setStages([...stages, ownStep(tool)]);
    setOpenStep(stages.length);
    setMenu(null);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await savePipeline({
        id: editing ? initial!.id : '',
        name: name.trim(),
        description: description.trim(),
        stages,
        builtin: false,
        updatedAt: '',
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 0.5 }}>
        <AccountTreeOutlined sx={{ fontSize: 20, color: c.accent.main }} />
        {editing ? 'Edit pipeline' : 'New pipeline'}
      </DialogTitle>
      <DialogContent sx={{ pt: '8px !important' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <TextField
            size="small"
            label="Name"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            InputLabelProps={{ shrink: true }}
            inputProps={{ maxLength: 80 }}
          />
          <TextField
            size="small"
            label="What it does (optional)"
            value={description}
            multiline
            minRows={2}
            onChange={(e) => setDescription(e.target.value)}
            InputLabelProps={{ shrink: true }}
            inputProps={{ maxLength: 600 }}
          />

          {catalogue && stages.length > 0 && (
            <Box
              sx={{
                p: 1,
                borderRadius: `${theme.aa.radius.md}px`,
                backgroundColor: c.bg.editor,
                border: `1px solid ${c.border.subtle}`,
              }}
            >
              <Flow
                pipeline={{ id: '', name, description, stages, builtin: false, updatedAt: '' }}
                catalogue={catalogue}
                inputKind=""
              />
            </Box>
          )}

          <Box
            sx={{
              borderRadius: `${theme.aa.radius.md}px`,
              border: `1px solid ${c.border.subtle}`,
              overflow: 'hidden',
            }}
          >
            {stages.length === 0 && (
              <Typography sx={{ p: 1.5, fontSize: 12, color: c.text.muted }}>
                No stages yet. The first console tool decides what the pipeline starts from (EchoData
                for aa-sv, Sv for most others). Steps of your own (Bash, Python) can go anywhere.
              </Typography>
            )}
            {stages.map((stage, i) => {
              const tool = toolOf(catalogue, stage.tool);
              const step = steps[i];
              const own = isOwn(stage);
              return (
                <Box key={`${stage.tool}-${i}`} sx={{ '& + &': { borderTop: `1px solid ${c.border.subtle}` } }}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1.25,
                    minHeight: 40,
                    backgroundColor: step?.mismatch ? alpha(c.status.error, 0.06) : 'transparent',
                  }}
                >
                  <Typography sx={{ width: 16, fontSize: 11, fontWeight: 700, color: c.text.muted }}>{i + 1}</Typography>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: c.text.primary }} noWrap>
                      {own && (
                        <TerminalRounded sx={{ fontSize: 13, mr: 0.5, verticalAlign: '-2px', color: c.text.muted }} />
                      )}
                      {stageLabel(stage, catalogue)}{' '}
                      <Box
                        component="span"
                        sx={{
                          fontWeight: 400,
                          fontSize: 11,
                          color: c.text.muted,
                          fontFamily: own ? theme.aa.font.mono : undefined,
                        }}
                      >
                        {own
                          ? commandPreview(stage) || '(no command yet)'
                          : stage.tool}
                        {!own && Object.keys(stage.params).length
                          ? ` · ${Object.keys(stage.params).length} settings changed`
                          : ''}
                      </Box>
                    </Typography>
                    {step?.mismatch && (
                      <Typography sx={{ fontSize: 11, color: c.status.error }}>{step.mismatch}</Typography>
                    )}
                  </Box>
                  {tool && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <LevelChip level={tool.level} />
                      <Typography sx={{ fontSize: 10.5, color: c.text.muted }}>
                        {kindLabel(step?.writes || tool.produces, catalogue)}
                      </Typography>
                    </Box>
                  )}
                  {own && (
                    <IconButton
                      size="small"
                      onClick={() => setOpenStep(openStep === i ? -1 : i)}
                      aria-label={openStep === i ? 'Close the command' : 'Edit the command'}
                      aria-expanded={openStep === i}
                    >
                      <ExpandMoreRounded
                        sx={{ fontSize: 16, transform: openStep === i ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
                      />
                    </IconButton>
                  )}
                  <IconButton size="small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                    <ArrowUpwardRounded sx={{ fontSize: 15 }} />
                  </IconButton>
                  <IconButton
                    size="small"
                    disabled={i === stages.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label="Move down"
                  >
                    <ArrowDownwardRounded sx={{ fontSize: 15 }} />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => remove(i)}
                    aria-label={`Remove ${own ? stageLabel(stage, catalogue) : stage.tool}`}
                  >
                    <DeleteOutlineRounded sx={{ fontSize: 15 }} />
                  </IconButton>
                </Box>
                {own && openStep === i && (
                  <Box sx={{ px: 1.25, pt: 0.5, pb: 1.25, backgroundColor: c.bg.editor }}>
                    <OwnStepEditor
                      stage={stage}
                      catalogue={catalogue}
                      autoFocus
                      onChange={(patch) => setStages(stages.map((s, j) => (j === i ? { ...s, ...patch } : s)))}
                    />
                  </Box>
                )}
                </Box>
              );
            })}
          </Box>
          <Box>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddRounded />}
              disabled={!catalogue || stages.length >= 12}
              onClick={(e) => setMenu(e.currentTarget)}
              sx={{ textTransform: 'none' }}
            >
              Add a stage
            </Button>
            {lastKind && (
              <Typography component="span" sx={{ ml: 1.25, fontSize: 11, color: c.text.muted }}>
                after {kindLabel(lastKind, catalogue)}
              </Typography>
            )}
          </Box>
          {error && (
            <Alert severity="error" sx={{ fontSize: 12, py: 0 }}>
              {error}
            </Alert>
          )}
        </Box>

        <Menu
          anchorEl={menu}
          open={Boolean(menu)}
          onClose={() => setMenu(null)}
          slotProps={{ paper: { sx: { maxHeight: 440, minWidth: 320 } } }}
        >
          <ListSubheader sx={{ lineHeight: '28px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Your own
          </ListSubheader>
          <MenuItem dense onClick={() => addOwn('bash')} sx={{ gap: 1 }}>
            <TerminalRounded sx={{ fontSize: 16, color: c.text.muted }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: 12.5 }}>Shell command</Typography>
              <Typography sx={{ fontSize: 10.5, color: c.text.muted }}>Bash: tee, grep, gsutil, a script of yours</Typography>
            </Box>
          </MenuItem>
          <MenuItem dense onClick={() => addOwn('python')} sx={{ gap: 1 }}>
            <CodeRounded sx={{ fontSize: 16, color: c.text.muted }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: 12.5 }}>Python step</Typography>
              <Typography sx={{ fontSize: 10.5, color: c.text.muted }}>Code run with aalibrary’s Python</Typography>
            </Box>
          </MenuItem>
          {(catalogue?.groups ?? []).flatMap((group) => {
            const tools = (catalogue?.tools ?? []).filter((t) => t.group === group);
            if (!tools.length) return [];
            return [
              <ListSubheader key={`h-${group}`} sx={{ lineHeight: '28px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                {group}
              </ListSubheader>,
              ...tools.map((tool) => {
                const fits = !lastKind || tool.consumes.includes(lastKind);
                return (
                  <MenuItem
                    key={tool.name}
                    dense
                    disabled={!fits}
                    title={tool.summary || tool.name}
                    onClick={() => {
                      setStages([...stages, { tool: tool.name, params: {} }]);
                      setMenu(null);
                    }}
                    sx={{ gap: 1 }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: 12.5 }}>{tool.label}</Typography>
                      <Typography sx={{ fontSize: 10.5, color: c.text.muted }}>
                        {tool.name} · reads {tool.consumes.map((k) => kindLabel(k, catalogue)).join(' or ')}
                      </Typography>
                    </Box>
                    <LevelChip level={tool.level} />
                  </MenuItem>
                );
              }),
            ];
          })}
        </Menu>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Typography sx={{ flex: 1, fontSize: 11.5, color: c.text.muted }}>{why}</Typography>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disableElevation
          disabled={Boolean(why) || saving}
          onClick={() => void save()}
          sx={{ textTransform: 'none' }}
        >
          {saving ? 'Saving…' : editing ? 'Save' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
