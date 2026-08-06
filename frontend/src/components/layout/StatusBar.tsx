import { useEffect } from 'react';
import { Box, CircularProgress, Tooltip, Typography, useTheme } from '@mui/material';
import { AccountCircleOutlined } from '@mui/icons-material';

import { useLayout } from '../../context/LayoutContext';
import { openDialog } from '../../state/dialogs';
import { useUpdateJobState } from '../../state/environment';
import { getEditorsState, isDirty, openFile, useUnsavedCount } from '../../state/editors';
import { loadIdentity, useIdentity } from '../../state/identity';

/**
 * A slim status strip along the bottom of the shell. Global chrome that frames
 * the window and hosts lightweight status text.
 *
 * The right-hand slot reflects the environment update job, so a run started
 * from the dialog stays visible after the dialog is closed; clicking it reopens
 * the dialog.
 *
 * It also carries an unsaved-files count. Closing an editor tab with unsaved
 * edits keeps the buffer rather than discarding it, and without this the work
 * would be invisible — clicking the count reopens the file it belongs to.
 *
 * ## Why the account is here
 *
 * The signed-in account used to appear only in the Project panel's footer,
 * which meant the answer to "which Google account is this running as?" was
 * behind opening a panel — and nobody opens a panel to check something they
 * assume they already know. That is exactly the assumption that goes wrong: a
 * service account, a colleague's workstation, or a second account in a
 * different gcloud configuration all look identical until something is
 * refused. The status bar is the one strip that is always on screen, so the
 * account is stated there, next to the project it belongs to.
 *
 * Reported, never enforced — see `services/identityApi.ts`. Naming the account
 * is not a claim about what it may do.
 */
export function StatusBar() {
  const theme = useTheme();
  const jobState = useUpdateJobState();
  const unsavedCount = useUnsavedCount();
  const { identity, loaded } = useIdentity();
  const { openPanel } = useLayout();

  /* Shared with every other consumer — the store fetches once per session, so
     mounting here costs nothing beyond a subscription. */
  useEffect(() => {
    void loadIdentity();
  }, []);

  const labelSx = {
    fontSize: 11.5,
    color: theme.aa.color.text.muted,
    letterSpacing: 0.2,
  } as const;

  const status: Record<string, { text: string; color?: string }> = {
    idle: { text: 'Ready' },
    running: { text: 'Updating environment…', color: theme.aa.color.accent.main },
    succeeded: { text: 'Environment updated', color: theme.aa.color.status.success },
    failed: { text: 'Environment update failed', color: theme.aa.color.status.error },
    cancelled: {
      text: 'Environment update cancelled',
      color: theme.aa.color.status.warning,
    },
  };
  const current = status[jobState] ?? status.idle;
  const interactive = jobState !== 'idle';

  return (
    <Box
      component="footer"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: theme.aa.size.statusBar,
        flexShrink: 0,
        px: 1.5,
        backgroundColor: theme.aa.color.bg.base,
        borderTop: `1px solid ${theme.aa.color.border.strong}`,
        userSelect: 'none',
      }}
    >
      <Typography sx={labelSx}>Active Acoustics Strategic Initiative</Typography>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      {/*
        Who this is, and which project. Shown as soon as the answer arrives and
        not before: an empty slot that fills in is honest, whereas a placeholder
        reading "signed in" while the probe is still out would be a claim we
        cannot yet make.

        No account is a *state*, not a blank. It is the one case here worth a
        colour, because it is the one the user can fix — and `identity.detail`
        already carries the sentence telling them how.
      */}
      {loaded && (
        <Tooltip
          title={
            identity.detail ||
            (identity.principal ? `Signed in as ${identity.principal}` : '')
          }
          placement="top-end"
        >
          <Box
            component="button"
            onClick={() => openPanel('resources')}
            aria-label={
              identity.principal
                ? `Signed in as ${identity.principal}. Open the Project panel.`
                : 'No Google account detected. Open the Project panel.'
            }
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.6,
              maxWidth: 340,
              background: 'none',
              border: 'none',
              p: 0,
              font: 'inherit',
              cursor: 'pointer',
              color: identity.principal
                ? theme.aa.color.text.muted
                : theme.aa.color.status.warning,
              '&:hover': { color: theme.aa.color.text.primary },
              '&:focus-visible': {
                outline: `1px solid ${theme.aa.color.accent.main}`,
                outlineOffset: 2,
              },
            }}
          >
            <AccountCircleOutlined sx={{ fontSize: 13, flexShrink: 0 }} />
            <Typography
              component="span"
              sx={{
                ...labelSx,
                color: 'inherit',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {identity.principal || 'No account'}
            </Typography>
            {identity.project && (
              <Typography
                component="span"
                sx={{
                  ...labelSx,
                  color: theme.aa.color.text.muted,
                  flexShrink: 0,
                  opacity: 0.75,
                }}
              >
                {'\u00b7'} {identity.project}
              </Typography>
            )}
          </Box>
        </Tooltip>
      )}

      {unsavedCount > 0 && (
        <Typography
          component="button"
          onClick={() => {
            const pending = Object.values(getEditorsState().docs).find(isDirty);
            if (pending) openFile(pending.path, pending.name);
          }}
          sx={{
            ...labelSx,
            color: theme.aa.color.status.warning,
            background: 'none',
            border: 'none',
            p: 0,
            cursor: 'pointer',
            '&:hover': { textDecoration: 'underline' },
          }}
        >
          {unsavedCount} unsaved
        </Typography>
      )}

      <Box
        onClick={interactive ? () => openDialog('environment') : undefined}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          cursor: interactive ? 'pointer' : 'default',
          '&:hover': interactive ? { opacity: 0.85 } : undefined,
        }}
      >
        {jobState === 'running' && <CircularProgress size={10} thickness={6} />}
        <Typography sx={{ ...labelSx, color: current.color ?? labelSx.color }}>
          {current.text}
        </Typography>
      </Box>
      </Box>
    </Box>
  );
}
