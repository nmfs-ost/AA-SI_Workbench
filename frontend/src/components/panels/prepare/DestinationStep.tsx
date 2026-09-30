import { Box, IconButton, InputAdornment, TextField, Tooltip, Typography, useTheme } from '@mui/material';
import {
  DataObjectOutlined,
  DescriptionOutlined,
  FolderOutlined,
  ImageOutlined,
  RestartAltRounded,
  StorageOutlined,
  WavesOutlined,
} from '@mui/icons-material';

import { CopyPathButton } from '../CopyPathButton';
import { compactFieldSx } from '../panelStyles';
import { FileName, LevelChip, PathText } from './ui';

export interface PlannedFile {
  name: string;
  kind: 'echodata' | 'sv' | 'echogram' | 'report' | 'request';
  level: string;
  what: string;
}

interface Props {
  folder: string;
  base: string;
  defaultBase: string;
  baseError: string;
  files: PlannedFile[];
  onBase: (base: string) => void;
}

export const KIND_ICON = {
  echodata: StorageOutlined,
  sv: WavesOutlined,
  echogram: ImageOutlined,
  report: DataObjectOutlined,
  request: DescriptionOutlined,
} as const;

/**
 * Step 4: where it goes, and what it will be called.
 *
 * The place is not a choice here, on purpose. Products land under
 * derived_products/<you>/<vessel>/<survey>/<asset>/ in the project bucket, so
 * that the next person — or the next operation — finds them by knowing what
 * they are, not by asking where they were put. The name is editable; the
 * default says which data it holds.
 *
 * Below the name, the folder as it will look afterwards: every file, named by
 * the tools' own rule. `‹recipe›` is the eight characters that name the
 * processing; the same settings give the same name on any data.
 */
export function DestinationStep({ folder, base, defaultBase, baseError, files, onBase }: Props) {
  const theme = useTheme();
  const c = theme.aa.color;
  const name = base.trim() || defaultBase;

  return (
    <Box>
      <TextField
        size="small"
        fullWidth
        label="Asset name"
        value={base}
        placeholder={defaultBase}
        error={Boolean(baseError)}
        helperText={baseError || ' '}
        onChange={(e) => onBase(e.target.value)}
        InputLabelProps={{ shrink: true }}
        inputProps={{ spellCheck: false }}
        InputProps={{
          endAdornment: base ? (
            <InputAdornment position="end">
              <Tooltip title="Back to the default name">
                <IconButton size="small" onClick={() => onBase('')} edge="end">
                  <RestartAltRounded sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ) : undefined,
        }}
        sx={{
          ...compactFieldSx,
          '& .MuiInputBase-input': { fontFamily: theme.aa.font.mono, fontSize: 11.5 },
          '& .MuiFormHelperText-root': { fontSize: 10.5, mx: 0, mt: 0.25, minHeight: 14 },
        }}
      />

      <Box
        sx={{
          mt: 0.5,
          borderRadius: `${theme.aa.radius.md}px`,
          border: `1px solid ${c.border.subtle}`,
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 0.75,
            px: 1,
            py: 0.75,
            backgroundColor: theme.aa.color.bg.editor,
            borderBottom: `1px solid ${c.border.subtle}`,
            '&:hover .aa-copy': { opacity: 1 },
          }}
        >
          <FolderOutlined sx={{ fontSize: 14, color: c.syntax.entity, mt: '1px' }} />
          <Typography
            sx={{
              flex: 1,
              minWidth: 0,
              fontFamily: theme.aa.font.mono,
              fontSize: 10.5,
              lineHeight: 1.5,
              color: c.text.secondary,
              overflowWrap: 'anywhere',
            }}
          >
            <PathText path={folder} />
          </Typography>
          <CopyPathButton value={folder} label="Copy gs:// folder" />
        </Box>
        {files.map((f) => {
          const Icon = KIND_ICON[f.kind];
          return (
            <Box
              key={f.name}
              title={f.what}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pl: 2.5, pr: 1, height: 23 }}
            >
              <Icon sx={{ fontSize: 13, color: c.text.muted, flexShrink: 0 }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <FileName name={f.name} base={name} strong={f.kind === 'echodata'} />
              </Box>
              <LevelChip level={f.level} />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
