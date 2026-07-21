import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { DataObjectOutlined } from '@mui/icons-material';
import { Box, Chip, Divider, Stack, Typography, useTheme } from '@mui/material';

import { PanelPlaceholder } from './PanelPlaceholder';
import { useActiveAsset } from '../../state/activeAsset';
import { formatBytes, NCEI_BUCKET } from './ncei/nceiService';
import { CopyPathButton } from './CopyPathButton';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Box sx={{ display: 'flex', gap: 1, py: 0.5, alignItems: 'baseline' }}>
      <Typography
        sx={{
          fontSize: 11.5,
          color: theme.aa.color.text.muted,
          minWidth: 84,
          flexShrink: 0,
        }}
      >
        {label}
      </Typography>
      <Box sx={{ fontSize: 12.5, color: theme.aa.color.text.primary, minWidth: 0 }}>
        {children}
      </Box>
    </Box>
  );
}

function formatAcquired(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

/**
 * Metadata panel. Reflects the file currently identified in the NCEI panel via
 * the shared active-asset store; empty until a file is picked.
 */
export const MetadataPanel: FunctionComponent<IDockviewPanelProps> = () => {
  const theme = useTheme();
  const asset = useActiveAsset();

  if (!asset) {
    return (
      <PanelPlaceholder
        icon={DataObjectOutlined}
        title="Metadata"
        description="Select a file in the NCEI panel to view its metadata."
      />
    );
  }

  const mono = { fontFamily: theme.aa.font.mono, fontSize: 12, wordBreak: 'break-all' as const };
  /* `s3Path` is a key within the archive bucket; the absolute address adds the
     scheme and bucket back on. */
  const s3Uri = `s3://${NCEI_BUCKET}/${asset.s3Path}`;

  return (
    <Box
      sx={{
        height: '100%',
        overflowY: 'auto',
        p: 1.5,
        backgroundColor: theme.aa.color.bg.panel,
      }}
    >
      <Typography sx={{ ...mono, color: theme.aa.color.text.primary, mb: 0.5 }}>
        {asset.fileName}
      </Typography>
      <Chip
        label={asset.source}
        size="small"
        sx={{
          height: 18,
          fontSize: 10.5,
          mb: 1,
          backgroundColor: theme.aa.color.accent.soft,
          color: theme.aa.color.accent.main,
        }}
      />
      <Divider sx={{ mb: 1 }} />

      <Row label="Vessel">{asset.vessel}</Row>
      <Row label="Survey">{asset.survey}</Row>
      <Row label="Sonar">{asset.sonar}</Row>
      <Row label="Size">{formatBytes(asset.sizeBytes)}</Row>
      <Row label="Acquired">{formatAcquired(asset.acquiredAt)}</Row>
      <Row label="Channels">
        {asset.channels.length > 0 ? (
          <Stack direction="row" gap={0.5} flexWrap="wrap">
            {asset.channels.map((c) => (
              <Chip
                key={c}
                label={c}
                size="small"
                variant="outlined"
                sx={{ height: 18, fontSize: 10.5 }}
              />
            ))}
          </Stack>
        ) : (
          '—'
        )}
      </Row>
      {/* Shown as a full URI rather than a bucket-relative key: this is the
          value that can be pasted into the AWS CLI, boto3, or a message to a
          colleague and still mean something. */}
      <Row label="S3 URI">
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
          <Box sx={{ ...mono, color: theme.aa.color.text.secondary }}>{s3Uri}</Box>
          <CopyPathButton value={s3Uri} label="Copy s3:// URI" alwaysVisible />
        </Box>
      </Row>
    </Box>
  );
};
