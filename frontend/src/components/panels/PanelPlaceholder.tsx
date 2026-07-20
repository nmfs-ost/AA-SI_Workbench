import { Box, Typography, useTheme } from '@mui/material';
import type { IconComponent } from '../../types';

interface PanelPlaceholderProps {
  icon: IconComponent;
  title: string;
  description: string;
}

/**
 * The shared empty state for every shell panel. The docking framework is the
 * deliverable today, so each tool renders a consistent, intentional placeholder
 * rather than fabricated content. Individual panels swap this out for real UI as
 * they are built.
 */
export function PanelPlaceholder({
  icon: Icon,
  title,
  description,
}: PanelPlaceholderProps) {
  const theme = useTheme();

  return (
    <Box
      sx={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        px: 3,
        userSelect: 'none',
        backgroundColor: theme.aa.color.bg.panel,
      }}
    >
      <Icon
        sx={{
          fontSize: 30,
          color: theme.aa.color.text.muted,
          opacity: 0.85,
          mb: 0.5,
        }}
      />
      <Typography
        sx={{
          fontSize: 13,
          fontWeight: 600,
          color: theme.aa.color.text.secondary,
          letterSpacing: 0.2,
        }}
      >
        {title}
      </Typography>
      <Typography
        sx={{
          fontSize: 12,
          color: theme.aa.color.text.muted,
          textAlign: 'center',
          maxWidth: 220,
          lineHeight: 1.5,
        }}
      >
        {description}
      </Typography>
    </Box>
  );
}
