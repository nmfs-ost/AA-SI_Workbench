import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import {
  AccountCircleOutlined,
  CheckCircleOutlineRounded,
  ContentCopyOutlined,
  ErrorOutlineRounded,
  HelpOutlineRounded,
  RefreshOutlined,
  TerminalOutlined,
  WarningAmberRounded,
} from '@mui/icons-material';

import { useLayout } from '../../context/LayoutContext';
import type { AccountCheckItem, CheckState } from '../../services/identityApi';
import { loadAccountCheck, useAccountCheck } from '../../state/accountCheck';
import { sendToTerminal } from '../../state/terminal';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * The account check: the account the Workbench names your folder after, the
 * account the aa-* tools upload with, and what the chosen bucket allows — each
 * with the command that fixes it.
 *
 * A fix is typed into the Workbench's terminal, not run: gcloud's sign-in
 * commands ask questions, and the person should see what is about to run.
 * "Check again" after it re-detects the account everywhere in the Workbench.
 */
export function AccountDialog({ open, onClose }: Props) {
  const theme = useTheme();
  const c = theme.aa.color;
  const { check, loading, error } = useAccountCheck();
  const { openPanel } = useLayout();
  const [copied, setCopied] = useState('');

  useEffect(() => {
    if (open) void loadAccountCheck();
  }, [open]);

  const tone: Record<CheckState, { color: string; Icon: typeof CheckCircleOutlineRounded }> = {
    ok: { color: c.status.success, Icon: CheckCircleOutlineRounded },
    warn: { color: c.status.warning, Icon: WarningAmberRounded },
    fail: { color: c.status.error, Icon: ErrorOutlineRounded },
    unknown: { color: c.text.muted, Icon: HelpOutlineRounded },
  };

  const runInTerminal = (command: string) => {
    sendToTerminal(command, { origin: 'Account check', execute: false });
    openPanel('terminal');
    onClose();
  };

  const copy = (command: string) => {
    void navigator.clipboard
      ?.writeText(command)
      .then(() => setCopied(command))
      .catch(() => setCopied(''));
  };

  const row = (item: AccountCheckItem) => {
    const { color, Icon } = tone[item.state] ?? tone.unknown;
    return (
      <Box
        key={item.id}
        sx={{
          display: 'flex',
          gap: 1,
          py: 1.1,
          borderBottom: `1px solid ${c.border.subtle}`,
          '&:last-of-type': { borderBottom: 'none' },
        }}
      >
        <Icon sx={{ fontSize: 18, color, mt: '1px', flexShrink: 0 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: c.text.primary }}>
            {item.label}
          </Typography>
          <Typography sx={{ fontSize: 12.5, lineHeight: 1.45, color: c.text.secondary, mt: 0.25 }}>
            {item.detail}
          </Typography>
          {item.fix && (
            <Box sx={{ mt: 0.75 }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  px: 1,
                  py: 0.4,
                  borderRadius: 1,
                  border: `1px solid ${c.border.strong}`,
                  backgroundColor: c.bg.base,
                }}
              >
                <Typography
                  component="code"
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    fontFamily: theme.aa.font.mono,
                    fontSize: 12,
                    color: c.text.primary,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {item.fix}
                </Typography>
                <Tooltip title={copied === item.fix ? 'Copied' : 'Copy'}>
                  <IconButton size="small" aria-label="Copy the command" onClick={() => copy(item.fix)}>
                    <ContentCopyOutlined sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
                <Button
                  size="small"
                  startIcon={<TerminalOutlined sx={{ fontSize: 14 }} />}
                  onClick={() => runInTerminal(item.fix)}
                  sx={{ textTransform: 'none', fontSize: 12, flexShrink: 0 }}
                >
                  Type in Terminal
                </Button>
              </Box>
              {item.fixNote && (
                <Typography sx={{ fontSize: 11.5, color: c.text.muted, mt: 0.4 }}>
                  This {item.fixNote}. Press Enter in the terminal, then Check again.
                </Typography>
              )}
            </Box>
          )}
        </Box>
      </Box>
    );
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 0.5 }}>
        <AccountCircleOutlined sx={{ fontSize: 20, color: c.text.muted }} />
        <Typography component="span" sx={{ fontSize: 16, fontWeight: 600, flex: 1 }}>
          Account check
        </Typography>
        {loading && <CircularProgress size={14} />}
      </DialogTitle>
      <DialogContent sx={{ pt: 0.5 }}>
        <Typography sx={{ fontSize: 12.5, color: c.text.muted, mb: 1 }}>
          Who your products are filed under, who uploads them, and whether the bucket
          lets them in. Nothing is written to check this.
        </Typography>
        {error && (
          <Alert severity="warning" sx={{ mb: 1, fontSize: 12.5 }}>
            The check couldn't be run: {error}
          </Alert>
        )}
        {check ? (
          <Box>{check.checks.map(row)}</Box>
        ) : (
          !error && (
            <Typography sx={{ fontSize: 12.5, color: c.text.muted, py: 2 }}>
              Checking…
            </Typography>
          )
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          startIcon={<RefreshOutlined sx={{ fontSize: 16 }} />}
          onClick={() => void loadAccountCheck(true)}
          disabled={loading}
          sx={{ textTransform: 'none', mr: 'auto' }}
        >
          Check again
        </Button>
        <Button onClick={onClose} variant="contained" sx={{ textTransform: 'none' }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
