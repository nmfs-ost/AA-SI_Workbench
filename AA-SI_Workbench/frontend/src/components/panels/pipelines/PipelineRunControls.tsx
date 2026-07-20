import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Collapse,
  Snackbar,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import PlayArrowOutlined from '@mui/icons-material/PlayArrowOutlined';
import InputOutlined from '@mui/icons-material/InputOutlined';
import TerminalOutlined from '@mui/icons-material/TerminalOutlined';

import { buildCommand, type PipelineDefinition, type PipelineValues } from './pipelineTypes';

interface Props {
  selectedPipelines: PipelineDefinition[];
  draftsFor: (pipelineId: string) => PipelineValues;
  injectedInput: string | null;
  injectedSource: string | null;
  onClearSelection: () => void;
}

/**
 * Run controls for the pipelines panel.
 *
 * Shows what will run, what file is being injected as the input (from the
 * left-window selection), and the exact commands the run would issue. Execution
 * is deferred to the backend — staging is honest about that.
 */
export function PipelineRunControls({
  selectedPipelines,
  draftsFor,
  injectedInput,
  injectedSource,
  onClearSelection,
}: Props) {
  const theme = useTheme();
  const [showCommands, setShowCommands] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const count = selectedPipelines.length;
  const canRun = count > 0 && Boolean(injectedInput);

  const runLabel =
    count === 0
      ? 'Run'
      : `Run ${count} pipeline${count === 1 ? '' : 's'}`;

  const disabledReason = !count
    ? 'Select at least one pipeline card'
    : !injectedInput
      ? 'Select a file in the NCEI panel to supply the input'
      : '';

  return (
    <Box
      sx={{
        borderTop: `1px solid ${theme.aa.color.border.subtle}`,
        backgroundColor: theme.aa.color.bg.chrome,
        p: 1.25,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
      }}
    >
      {/* Injected input */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        <InputOutlined
          sx={{
            fontSize: 15,
            color: injectedInput
              ? theme.aa.color.accent.main
              : theme.aa.color.text.muted,
          }}
        />
        {injectedInput ? (
          <Typography
            sx={{
              fontSize: 11.5,
              color: theme.aa.color.text.secondary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            Input{' '}
            <Box
              component="span"
              sx={{
                fontFamily: theme.aa.font.mono,
                color: theme.aa.color.accent.main,
              }}
            >
              {injectedInput}
            </Box>
            {injectedSource ? ` · ${injectedSource}` : ''}
          </Typography>
        ) : (
          <Typography sx={{ fontSize: 11.5, color: theme.aa.color.text.muted }}>
            No input file — select one in the NCEI panel and it is injected automatically.
          </Typography>
        )}
      </Box>

      {/* Summary + actions */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: 12, color: theme.aa.color.text.secondary, flex: 1 }}>
          {count > 0
            ? `${count} pipeline${count === 1 ? '' : 's'} selected`
            : 'No pipelines selected'}
        </Typography>

        {count > 0 && (
          <Button size="small" onClick={onClearSelection} sx={{ fontSize: 11.5 }}>
            Clear
          </Button>
        )}

        <Button
          size="small"
          variant="outlined"
          startIcon={<TerminalOutlined />}
          disabled={count === 0}
          onClick={() => setShowCommands((v) => !v)}
          sx={{ fontSize: 11.5 }}
        >
          {showCommands ? 'Hide commands' : 'Preview commands'}
        </Button>

        <Tooltip title={disabledReason}>
          <span style={{ display: 'flex' }}>
            <Button
              size="small"
              variant="contained"
              startIcon={<PlayArrowOutlined />}
              disabled={!canRun}
              onClick={() =>
                setToast(
                  `Staged ${count} pipeline${count === 1 ? '' : 's'} for ${injectedInput} — preview only (backend not connected).`,
                )
              }
            >
              {runLabel}
            </Button>
          </span>
        </Tooltip>
      </Box>

      {/* Command preview */}
      <Collapse in={showCommands && count > 0} unmountOnExit>
        <Box
          sx={{
            mt: 0.5,
            p: 1,
            borderRadius: `${theme.aa.radius.sm}px`,
            backgroundColor: theme.aa.color.bg.base,
            border: `1px solid ${theme.aa.color.border.subtle}`,
            fontFamily: theme.aa.font.mono,
            fontSize: 11,
            color: theme.aa.color.text.secondary,
            maxHeight: 150,
            overflowY: 'auto',
          }}
        >
          {selectedPipelines.map((pipeline) => (
            <Box key={pipeline.id} sx={{ mb: 0.75 }}>
              <Typography
                sx={{ fontSize: 10, color: theme.aa.color.text.muted, mb: 0.25 }}
              >
                {pipeline.name}
              </Typography>
              <Box sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {buildCommand(pipeline, draftsFor(pipeline.id), injectedInput).join(' \\\n  | ')}
              </Box>
            </Box>
          ))}
        </Box>
      </Collapse>

      <Snackbar
        open={toast !== null}
        autoHideDuration={4000}
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
}
