import {
  Box,
  CircularProgress,
  Divider,
  IconButton,
  Tooltip,
  useTheme,
} from '@mui/material';

import { openDialog } from '../../state/dialogs';
import { useUpdateJobState } from '../../state/environment';
import { toolbarItems, type ToolbarItem } from './toolbarConfig';

/**
 * The application toolbar: a thin strip of icon buttons beneath the menu bar.
 * Items are declared in toolbarConfig and every one of them is wired — the six
 * placeholder buttons that used to sit on the left were removed rather than
 * left to click to no effect. The environment button doubles as the
 * background-update indicator, which is why it can render a spinner in place of
 * its icon.
 */
export function AppToolbar() {
  const theme = useTheme();
  const jobState = useUpdateJobState();
  const updating = jobState === 'running';

  const dispatch = (item: Extract<ToolbarItem, { kind: 'button' }>) => {
    switch (item.action) {
      case 'open-dialog':
        if (item.dialogId) openDialog(item.dialogId, item.dialogPayload);
        break;
      case 'open-external':
        if (item.href) window.open(item.href, '_blank', 'noopener,noreferrer');
        break;
      default:
        // Unreachable while every configured item carries a known action; kept
        // so an unwired item fails quietly rather than throwing at a click.
        break;
    }
  };

  return (
    <Box
      component="div"
      role="toolbar"
      aria-label="Main toolbar"
      sx={{
        display: 'flex',
        alignItems: 'center',
        height: theme.aa.size.toolBar,
        flexShrink: 0,
        px: 1,
        gap: 0.25,
        backgroundColor: theme.aa.color.bg.chrome,
        borderBottom: `1px solid ${theme.aa.color.border.strong}`,
      }}
    >
      {toolbarItems.map((item) => {
        if (item.kind === 'spacer') {
          return <Box key={item.id} sx={{ flex: 1 }} />;
        }

        if (item.kind === 'divider') {
          return (
            <Divider
              key={item.id}
              orientation="vertical"
              flexItem
              sx={{
                mx: 0.75,
                my: 1,
                borderColor: theme.aa.color.border.subtle,
              }}
            />
          );
        }

        const Icon = item.icon;
        const busy = updating && item.id === 'environment';
        return (
          <Tooltip
            key={item.id}
            title={busy ? 'Environment update running…' : item.label}
            arrow
          >
            <IconButton
              aria-label={item.label}
              onClick={() => dispatch(item)}
              sx={{ width: 30, height: 30 }}
            >
              {busy ? (
                <CircularProgress size={15} thickness={5} />
              ) : (
                <Icon sx={{ fontSize: 18 }} />
              )}
            </IconButton>
          </Tooltip>
        );
      })}
    </Box>
  );
}
