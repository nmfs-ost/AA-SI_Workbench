import { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import AddOutlined from '@mui/icons-material/AddOutlined';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import ArrowUpwardOutlined from '@mui/icons-material/ArrowUpwardOutlined';
import ArrowDownwardOutlined from '@mui/icons-material/ArrowDownwardOutlined';
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined';

import { toolCatalog, makeStage, type ToolTemplate } from './toolCatalog';
import { buildCommand, type PipelineDefinition } from './pipelineTypes';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; description: string; tools: ToolTemplate[] }) => void;
}

/**
 * Compose a new pipeline: name it, then click tools to append them in order.
 *
 * The tools come from the shared catalog, so the resulting pipeline gets real
 * parameters, a working Configuration panel, and a correct command preview
 * without any extra wiring. The live command at the bottom shows what is being
 * built as it is built.
 */
export function NewPipelineDialog({ open, onClose, onCreate }: Props) {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tools, setTools] = useState<ToolTemplate[]>([]);

  const reset = () => {
    setName('');
    setDescription('');
    setTools([]);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleCreate = () => {
    onCreate({ name, description, tools });
    reset();
  };

  const move = (index: number, delta: number) => {
    const next = [...tools];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setTools(next);
  };

  // Preview the command using the composed stages and their defaults.
  const previewPipeline: PipelineDefinition | null =
    tools.length > 0
      ? {
          id: 'preview',
          name: name || 'New pipeline',
          description: '',
          tags: [],
          inputKind: 'raw',
          author: '',
          updatedAt: '',
          stages: tools.map((t, i) => makeStage(t, i)),
        }
      : null;

  const command = previewPipeline
    ? buildCommand(
        previewPipeline,
        Object.fromEntries(
          previewPipeline.stages.map((stage) => [
            stage.id,
            Object.fromEntries(stage.params.map((p) => [p.id, p.default])),
          ]),
        ),
        null,
      ).join(' \\\n  | ')
    : '';

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

        <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 0.5 }}>
          Add tools, in order
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
          {toolCatalog
            .filter((template) => !template.freeform)
            .map((template) => (
            <Tooltip key={template.tool} title={template.description}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddOutlined sx={{ fontSize: 14 }} />}
                onClick={() => setTools((prev) => [...prev, template])}
                sx={{
                  fontFamily: theme.aa.font.mono,
                  fontSize: 11,
                  textTransform: 'none',
                  py: 0.25,
                }}
              >
                {template.tool}
              </Button>
            </Tooltip>
          ))}
        </Box>

        {/* The catalogue can never be complete — there are more aa-* tools than
            this lists, plus the entire Unix toolbox, which is genuinely useful
            in a pipe chain. Rather than enumerate them, offer one stage the user
            writes themselves. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          {toolCatalog
            .filter((template) => template.freeform)
            .map((template) => (
              <Tooltip key={template.tool} title={template.description}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AddOutlined sx={{ fontSize: 14 }} />}
                  onClick={() => setTools((prev) => [...prev, template])}
                  sx={{ fontSize: 11, textTransform: 'none', py: 0.25 }}
                >
                  {template.label}
                </Button>
              </Tooltip>
            ))}
          <Typography sx={{ fontSize: 10.5, color: theme.aa.color.text.muted }}>
            For any other tool, a pipe, or a shell filter — you write the command.
          </Typography>
        </Box>

        <Divider sx={{ mb: 1.5 }} />

        <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 0.75 }}>
          Pipeline steps
        </Typography>

        {tools.length === 0 ? (
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
            No steps yet — add a tool above to begin the chain.
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {tools.map((template, index) => (
              <Box
                key={`${template.tool}-${index}`}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
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
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    sx={{
                      fontFamily: theme.aa.font.mono,
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: theme.aa.color.accent.main,
                    }}
                  >
                    {template.tool}
                  </Typography>
                  <Typography sx={{ fontSize: 10.5, color: theme.aa.color.text.muted }}>
                    {template.label}
                    {index === 0 ? ' · receives the selected file' : ''}
                  </Typography>
                </Box>
                <IconButton
                  size="small"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUpwardOutlined sx={{ fontSize: 14 }} />
                </IconButton>
                <IconButton
                  size="small"
                  disabled={index === tools.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDownwardOutlined sx={{ fontSize: 14 }} />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={() => setTools((prev) => prev.filter((_, i) => i !== index))}
                >
                  <CloseOutlined sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>
            ))}
          </Box>
        )}

        {tools.length > 0 && (
          <>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 0.25,
                mt: 1.5,
              }}
            >
              {tools.map((template, index) => (
                <Box
                  key={`flow-${template.tool}-${index}`}
                  sx={{ display: 'flex', alignItems: 'center' }}
                >
                  <Typography
                    sx={{
                      fontFamily: theme.aa.font.mono,
                      fontSize: 10.5,
                      color: theme.aa.color.text.secondary,
                    }}
                  >
                    {template.tool}
                  </Typography>
                  {index < tools.length - 1 && (
                    <ChevronRightOutlined
                      sx={{ fontSize: 13, color: theme.aa.color.text.muted }}
                    />
                  )}
                </Box>
              ))}
            </Box>

            <Box
              sx={{
                mt: 1,
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
              {command}
            </Box>
          </>
        )}
      </DialogContent>

      <DialogActions>
        <Button size="small" onClick={handleClose}>
          Cancel
        </Button>
        <Tooltip title={tools.length === 0 ? 'Add at least one tool' : ''}>
          <span style={{ display: 'flex' }}>
            <Button
              size="small"
              variant="contained"
              disabled={tools.length === 0}
              onClick={handleCreate}
            >
              Create pipeline
            </Button>
          </span>
        </Tooltip>
      </DialogActions>
    </Dialog>
  );
}
