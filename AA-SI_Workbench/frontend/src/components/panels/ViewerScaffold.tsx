import type { OverridableComponent } from '@mui/material/OverridableComponent';
import type { SvgIconTypeMap } from '@mui/material';
import { Box, Chip, Typography, useTheme } from '@mui/material';

import { useActiveAsset } from '../../state/activeAsset';

interface Props {
  title: string;
  icon: OverridableComponent<SvgIconTypeMap>;
  /** Shown centered when no file is active. */
  instruction: string;
  /** Muted line shown when a file is active (honest "not wired" note). */
  note: string;
}

/**
 * A viewer panel scaffold for the split center region. It frames a plot area
 * (depth × time, like an echogram) and reflects the file currently identified in
 * the NCEI panel via the shared active-asset store — so echogram/Sv viewers stay
 * in sync with the raw selection. Live rendering is a later step; this establishes
 * the layout, the tabbing, and the data binding.
 */
export function ViewerScaffold({ title, icon: Icon, instruction, note }: Props) {
  const theme = useTheme();
  const asset = useActiveAsset();

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: theme.aa.color.bg.editor,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.25,
          minHeight: 30,
          borderBottom: `1px solid ${theme.aa.color.border.subtle}`,
          color: theme.aa.color.text.secondary,
        }}
      >
        <Icon sx={{ fontSize: 16 }} />
        <Typography sx={{ fontSize: 12, fontWeight: 600 }}>{title}</Typography>
        {asset && (
          <Chip
            label={asset.fileName}
            size="small"
            sx={{
              height: 18,
              fontSize: 10.5,
              fontFamily: theme.aa.font.mono,
              backgroundColor: theme.aa.color.bg.elevated,
              color: theme.aa.color.text.secondary,
              maxWidth: 260,
            }}
          />
        )}
      </Box>

      {/* Plot area */}
      <Box sx={{ flex: 1, position: 'relative', minHeight: 0, p: 3 }}>
        <Box
          sx={{
            position: 'absolute',
            inset: theme.spacing(3),
            border: `1px solid ${theme.aa.color.border.subtle}`,
            borderRadius: `${theme.aa.radius.sm}px`,
            // faint raster grid to read as an echogram canvas
            backgroundImage: `linear-gradient(${theme.aa.color.border.subtle} 1px, transparent 1px), linear-gradient(90deg, ${theme.aa.color.border.subtle} 1px, transparent 1px)`,
            backgroundSize: '28px 28px',
            opacity: 0.5,
          }}
        />
        {/* Axis labels */}
        <Typography
          sx={{
            position: 'absolute',
            left: 2,
            top: '50%',
            transform: 'translateY(-50%) rotate(-90deg)',
            transformOrigin: 'left center',
            fontSize: 10,
            color: theme.aa.color.text.muted,
            letterSpacing: 0.4,
          }}
        >
          Depth (m)
        </Typography>
        <Typography
          sx={{
            position: 'absolute',
            bottom: 4,
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: 10,
            color: theme.aa.color.text.muted,
            letterSpacing: 0.4,
          }}
        >
          Time / ping
        </Typography>

        {/* Centered state */}
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0.75,
            textAlign: 'center',
            px: 4,
            pointerEvents: 'none',
          }}
        >
          <Icon sx={{ fontSize: 30, color: theme.aa.color.text.muted, opacity: 0.7 }} />
          {asset ? (
            <>
              <Typography sx={{ fontSize: 12.5, color: theme.aa.color.text.secondary }}>
                {asset.vessel} › {asset.survey} › {asset.sonar}
              </Typography>
              <Typography sx={{ fontSize: 11.5, color: theme.aa.color.text.muted, maxWidth: 360 }}>
                {note}
              </Typography>
            </>
          ) : (
            <Typography sx={{ fontSize: 12.5, color: theme.aa.color.text.muted, maxWidth: 340, lineHeight: 1.5 }}>
              {instruction}
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}
