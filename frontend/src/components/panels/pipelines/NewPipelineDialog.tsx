import { useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import AddOutlined from '@mui/icons-material/AddOutlined';
import CheckCircleOutlineOutlined from '@mui/icons-material/CheckCircleOutlineOutlined';
import TerminalOutlined from '@mui/icons-material/TerminalOutlined';

import { toolCatalog } from './toolCatalog';
import { buildPipeline, parseCommand } from './commandParser';
import { INPUT_TOKEN, type PipelineValues, type StageDef } from './pipelineTypes';
import { chainIssues, layerLabel, type LayerKind } from '../../../types/layers';

/**
 * Compose a new pipeline by writing the command.
 *
 * ## Why this is a text box and not a row of buttons
 *
 * It used to be a row of buttons: click `aa-fetch`, click `aa-raw`, get a
 * pipeline. That works for the tools the catalogue lists and for nothing else —
 * not the `aa-*` tools that ship after it was written, and not the Unix
 * toolbox, which is genuinely useful in a pipe chain. The escape hatch was a
 * single "Custom command" button producing an opaque stage, so the real choice
 * on offer was: structure for a handful of tools, or a text box with no
 * structure at all.
 *
 * Both, then. A command line is already the notation everyone here types, reads
 * in the docs and pastes from a colleague, so **the command is the input** and
 * the structure is recovered from it by `commandParser`. A segment whose tool
 * is known, and all of whose flags are known, becomes a real stage with real
 * parameters and a working Configuration panel. Anything else keeps its text
 * verbatim and runs as a freeform stage.
 *
 * The tool chips are still here and are now *insertions into the command*
 * rather than a parallel way to build a pipeline. That is what makes this the
 * better of the two rather than a replacement: someone who does not know the
 * tool names can still find them, and what they get back is a command they can
 * edit — a starting point rather than a black box.
 *
 * The steps list is a live read-out of what the parser made of what is typed,
 * so a stage becoming configurable — and, more importantly, any *demotion* away
 * from that — is visible as it happens rather than discovered later.
 */

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (input: {
    name: string;
    description: string;
    stages: StageDef[];
    values: PipelineValues;
  }) => void;
}

/** A hand-written stage constrains nothing, so it must not raise a composition
    warning wherever it is put. Same `any`/`any` the catalogue's escape-hatch
    entry declares, for the same reason. */
const FREEFORM_LAYERS = { consumes: 'any' as LayerKind, produces: 'any' as LayerKind };

export function NewPipelineDialog({ open, onClose, onCreate }: Props) {
  const theme = useTheme();
  const commandRef = useRef<HTMLTextAreaElement | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [command, setCommand] = useState('');

  const reset = () => {
    setName('');
    setDescription('');
    setCommand('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const parsed = useMemo(() => parseCommand(command), [command]);
  const built = useMemo(() => buildPipeline(parsed), [parsed]);

  /**
   * Insert a tool at the caret.
   *
   * At the caret rather than at the end, because the gesture after typing `| `
   * is to reach for a name, and appending to the end would put it after a pipe
   * the user has not typed yet. The separating pipe is added only when the
   * caret sits at the end of an existing command, which is the one case where
   * the intent is unambiguous.
   */
  const insertTool = (tool: string) => {
    const input = commandRef.current;
    const at = input?.selectionStart ?? command.length;
    const before = command.slice(0, at);
    const after = command.slice(at);

    const trailing = before.trim() === '' ? '' : /[|\s]\s*$/.test(before) ? ' ' : ' | ';
    const fragment = `${trailing}${tool} `;
    setCommand(`${before}${fragment}${after}`);

    // Restore the caret after the re-render, or it jumps to the end and the
    // next insertion lands somewhere the user did not point at.
    requestAnimationFrame(() => {
      const position = before.length + fragment.length;
      input?.focus();
      input?.setSelectionRange(position, position);
    });
  };

  /* Does each step's input come from somewhere?
     Reported, never enforced. Several catalogue entries are unverified
     proposals, so a composition this flags may well be right — and a dialog
     that refused to build it would be wrong in a way the user could not work
     around. */
  const issues = chainIssues(
    parsed.map((stage) =>
      stage.structured && stage.template
        ? stage.template
        : { tool: stage.tool || 'command', ...FREEFORM_LAYERS },
    ),
    'any',
  );

  const unverified = parsed
    .map((stage) => stage.template)
    .filter((template) => template !== undefined && template.verified !== true);

  const structuredCount = parsed.filter((stage) => stage.structured).length;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 15, fontWeight: 600 }}>New pipeline</DialogTitle>
      <DialogContent dividers>
        <TextField
          autoFocus
          fullWidth
          size="small"
          label="Pipeline name"
          placeholder="e.g. Bigelow nightly transect"
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ mb: 1.5 }}
        />
        <TextField
          fullWidth
          size="small"
          label="Description"
          placeholder="What does this pipeline produce?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          sx={{ mb: 2 }}
        />

        <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 0.5 }}>Command</Typography>
        <TextField
          fullWidth
          multiline
          minRows={2}
          maxRows={8}
          size="small"
          value={command}
          inputRef={commandRef}
          onChange={(e) => setCommand(e.target.value)}
          placeholder={`aa-fetch -o ./downloads ${INPUT_TOKEN} | aa-raw --sonar-model EK60 | aa-combine -o combined.zarr`}
          InputProps={{ sx: { fontFamily: theme.aa.font.mono, fontSize: 11.5 } }}
        />
        <Typography sx={{ mt: 0.5, fontSize: 10.5, color: theme.aa.color.text.muted }}>
          Pipes separate steps. Put{' '}
          <Box component="code" sx={{ fontFamily: theme.aa.font.mono }}>
            {INPUT_TOKEN}
          </Box>{' '}
          where the selected file should go; a step that names no input reads
          the pipe, which is what a filter should do.
        </Typography>

        {/* The catalogue, as insertions rather than as a parallel builder. */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1.25, mb: 2 }}>
          {toolCatalog
            .filter((template) => !template.freeform)
            .map((template) => (
              <Tooltip key={template.tool} title={template.description}>
                <Chip
                  size="small"
                  variant="outlined"
                  label={template.tool}
                  icon={<AddOutlined sx={{ fontSize: 13 }} />}
                  onClick={() => insertTool(template.tool)}
                  sx={{
                    fontFamily: theme.aa.font.mono,
                    fontSize: 10.5,
                    height: 22,
                    cursor: 'pointer',
                  }}
                />
              </Tooltip>
            ))}
        </Box>

        <Divider sx={{ mb: 1.5 }} />

        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.75 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600 }}>Steps</Typography>
          {parsed.length > 0 && (
            <Typography sx={{ fontSize: 10.5, color: theme.aa.color.text.muted }}>
              {structuredCount} of {parsed.length} configurable
            </Typography>
          )}
        </Box>

        {parsed.length === 0 ? (
          <Box
            sx={{
              p: 2,
              textAlign: 'center',
              border: `1px dashed ${theme.aa.color.border.subtle}`,
              borderRadius: `${theme.aa.radius.sm}px`,
              color: theme.aa.color.text.muted,
              fontSize: 12,
            }}
          >
            Write a command above, or click a tool to insert it.
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {parsed.map((stage, index) => (
              <Box
                key={`${stage.tool}-${index}`}
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 0.75,
                  p: 0.75,
                  borderRadius: `${theme.aa.radius.sm}px`,
                  border: `1px solid ${theme.aa.color.border.subtle}`,
                  backgroundColor: theme.aa.color.bg.base,
                }}
              >
                <Typography
                  sx={{ fontSize: 11, color: theme.aa.color.text.muted, minWidth: 16 }}
                >
                  {index + 1}
                </Typography>

                <Box sx={{ flexShrink: 0, pt: '1px', display: 'flex' }}>
                  {stage.structured ? (
                    <Tooltip title="Recognised — this step gets real parameters and a Configuration panel">
                      <CheckCircleOutlineOutlined
                        sx={{ fontSize: 14, color: theme.aa.color.status.success }}
                      />
                    </Tooltip>
                  ) : (
                    <Tooltip title="Runs verbatim, as a shell command">
                      <TerminalOutlined
                        sx={{ fontSize: 14, color: theme.aa.color.text.muted }}
                      />
                    </Tooltip>
                  )}
                </Box>

                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    sx={{
                      fontFamily: theme.aa.font.mono,
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: stage.structured
                        ? theme.aa.color.accent.main
                        : theme.aa.color.text.primary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {stage.raw}
                  </Typography>

                  <Typography sx={{ fontSize: 10.5, color: theme.aa.color.text.muted }}>
                    {stage.template ? stage.template.label : 'Custom command'}
                    {stage.structured && stage.template && (
                      <Box component="span" sx={{ fontFamily: theme.aa.font.mono }}>
                        {' · '}
                        {layerLabel(stage.template.consumes)} →{' '}
                        {layerLabel(stage.template.produces)}
                      </Box>
                    )}
                    {stage.template && stage.template.verified !== true && ' · unverified'}
                  </Typography>

                  {/* Why a known tool did not become a configurable step. Said
                      out loud, because a silent demotion is indistinguishable
                      from the parser simply not working. */}
                  {stage.unmapped.length > 0 && (
                    <Typography
                      sx={{
                        fontSize: 10.5,
                        color: theme.aa.color.status.warning,
                        mt: 0.25,
                      }}
                    >
                      Runs as written —{' '}
                      <Box component="span" sx={{ fontFamily: theme.aa.font.mono }}>
                        {stage.unmapped.join(' ')}
                      </Box>{' '}
                      {stage.unmapped.length === 1 ? 'is' : 'are'} not in the
                      catalogue for {stage.tool}.
                    </Typography>
                  )}
                </Box>
              </Box>
            ))}
          </Box>
        )}

        {issues.length > 0 && (
          <Box
            sx={{
              mt: 1.5,
              p: 1,
              borderRadius: `${theme.aa.radius.sm}px`,
              border: `1px dashed ${theme.aa.color.status.warning}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.5,
            }}
          >
            <Typography sx={{ fontSize: 11, color: theme.aa.color.status.warning }}>
              {issues.length === 1
                ? 'One step has no source for its input.'
                : `${issues.length} steps have no source for their input.`}{' '}
              The pipeline can still be created — the catalogue is incomplete, so
              this may be the catalogue being wrong rather than the chain.
            </Typography>
            {issues.map((issue) => (
              <Typography
                key={`${issue.tool}-${issue.index}`}
                sx={{
                  fontSize: 10.5,
                  fontFamily: theme.aa.font.mono,
                  color: theme.aa.color.text.secondary,
                }}
              >
                {issue.index + 1}. {issue.message}
              </Typography>
            ))}
          </Box>
        )}

        {unverified.length > 0 && (
          <Typography sx={{ mt: 1, fontSize: 10.5, color: theme.aa.color.text.muted }}>
            Unverified against an installed environment:{' '}
            <Box component="span" sx={{ fontFamily: theme.aa.font.mono }}>
              {[...new Set(unverified.map((template) => template!.tool))].join(', ')}
            </Box>
            . Confirm with <code>ls $VIRTUAL_ENV/bin/aa-*</code>, then correct
            toolCatalog.ts.
          </Typography>
        )}
      </DialogContent>

      <DialogActions>
        <Button size="small" onClick={handleClose}>
          Cancel
        </Button>
        <Tooltip title={parsed.length === 0 ? 'Write a command first' : ''}>
          <span style={{ display: 'flex' }}>
            <Button
              size="small"
              variant="contained"
              disabled={parsed.length === 0}
              onClick={() => {
                onCreate({
                  name,
                  description,
                  stages: built.stages,
                  values: built.values,
                });
                reset();
              }}
            >
              Create pipeline
            </Button>
          </span>
        </Tooltip>
      </DialogActions>
    </Dialog>
  );
}
