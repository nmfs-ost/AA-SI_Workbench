import { Box, MenuItem, TextField, Typography, useTheme } from '@mui/material';

import type { Catalogue, StageSpec } from '../../../services/pipelinesApi';
import { OWN_STEPS, kindLabel } from './chain';

/**
 * A step of your own: a Bash command (tee, grep, gsutil, a script of yours) or
 * Python code, between console tools or on its own. What it gets and what it
 * passes on is said beside the command, since nothing else on the card can.
 */
export function OwnStepEditor({
  stage,
  catalogue,
  onChange,
  autoFocus = false,
}: {
  stage: StageSpec;
  catalogue: Catalogue | null;
  onChange: (patch: Partial<Pick<StageSpec, 'command' | 'label' | 'produces'>>) => void;
  autoFocus?: boolean;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  const bash = stage.tool === 'bash';
  const kinds = Object.keys(catalogue?.kinds ?? {}).filter((k) => k !== 'raw');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        <TextField
          size="small"
          label="Name on the card"
          placeholder={OWN_STEPS[stage.tool]}
          value={stage.label ?? ''}
          onChange={(e) => onChange({ label: e.target.value })}
          InputLabelProps={{ shrink: true }}
          inputProps={{ maxLength: 60 }}
          sx={{ flex: '2 1 160px' }}
        />
        <TextField
          select
          size="small"
          label="Passes on"
          value={stage.produces ?? ''}
          onChange={(e) => onChange({ produces: e.target.value })}
          InputLabelProps={{ shrink: true }}
          sx={{ flex: '1 1 140px' }}
          SelectProps={{ displayEmpty: true, MenuProps: { slotProps: { paper: { sx: { maxHeight: 320 } } } } }}
        >
          <MenuItem value="" dense>
            What it was given
          </MenuItem>
          {kinds.map((k) => (
            <MenuItem key={k} value={k} dense>
              {kindLabel(k, catalogue)}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      <TextField
        size="small"
        label={bash ? 'Bash command' : 'Python code'}
        value={stage.command ?? ''}
        onChange={(e) => onChange({ command: e.target.value })}
        multiline
        minRows={bash ? 2 : 4}
        maxRows={14}
        autoFocus={autoFocus}
        InputLabelProps={{ shrink: true }}
        inputProps={{ maxLength: 20000, spellCheck: false, 'aria-label': bash ? 'Bash command' : 'Python code' }}
        sx={{ '& textarea': { fontFamily: theme.aa.font.mono, fontSize: 12, lineHeight: 1.55 } }}
      />
      <Typography component="div" sx={{ fontSize: 11, color: c.text.muted, lineHeight: 1.55 }}>
        {bash ? (
          <>
            Gets the product’s path on stdin and as <Code>$IN</Code>; <Code>$DEST</Code> is where products go. Pipes,{' '}
            <Code>tee</Code>, <Code>grep</Code>, <Code>gsutil</Code> and your own scripts all work. It runs in your home
            folder and stops at the first command that fails.
          </>
        ) : (
          <>
            Gets the product’s path on stdin (<Code>sys.stdin</Code>) and as <Code>os.environ["IN"]</Code>; aalibrary can be
            imported. It runs in your home folder.
          </>
        )}{' '}
        The last line it prints, when that is a product (<Code>gs://…</Code> or a file), goes to the next stage; otherwise
        what it was given does.
      </Typography>
    </Box>
  );
}

function Code({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Box
      component="code"
      sx={{
        fontFamily: theme.aa.font.mono,
        fontSize: 10.5,
        px: 0.4,
        borderRadius: `${theme.aa.radius.sm}px`,
        backgroundColor: theme.aa.color.bg.editor,
        border: `1px solid ${theme.aa.color.border.subtle}`,
      }}
    >
      {children}
    </Box>
  );
}
