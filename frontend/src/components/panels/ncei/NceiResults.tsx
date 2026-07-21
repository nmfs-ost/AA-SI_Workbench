import {
  Box,
  Checkbox,
  CircularProgress,
  List,
  ListItemButton,
  ListItemText,
  Typography,
  useTheme,
} from '@mui/material';
import TravelExploreOutlined from '@mui/icons-material/TravelExploreOutlined';

import { formatBytes, nceiS3Uri } from './nceiService';
import { CopyPathButton } from '../CopyPathButton';
import type { NceiSearchController } from './useNceiSearch';

interface Props {
  controller: NceiSearchController;
}

function formatAcquired(iso: string): string {
  // "2019-04-15T12:00:00.000Z" -> "2019-04-15 12:00Z"
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}Z`;
}

function CenteredHint({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        px: 3,
        textAlign: 'center',
        color: theme.aa.color.text.muted,
      }}
    >
      {children}
    </Box>
  );
}

/** The list of .raw files for the selected sonar, with multi-select. */
export function NceiResults({ controller }: Props) {
  const theme = useTheme();
  const { filteredFiles, selected, loading, sonar, files, fileQuery, vessel, survey } =
    controller;

  const shownSelected = filteredFiles.filter((f) => selected.has(f.name)).length;
  const allShownSelected =
    filteredFiles.length > 0 && shownSelected === filteredFiles.length;
  const someShownSelected = shownSelected > 0 && !allShownSelected;

  let body: React.ReactNode;

  if (!sonar) {
    body = (
      <CenteredHint>
        <TravelExploreOutlined sx={{ fontSize: 28, opacity: 0.8 }} />
        <Typography sx={{ fontSize: 12.5, maxWidth: 240, lineHeight: 1.5 }}>
          Choose a vessel, survey, and sonar model to list its raw files from NCEI.
        </Typography>
      </CenteredHint>
    );
  } else if (loading.files) {
    body = (
      <CenteredHint>
        <CircularProgress size={20} />
        <Typography sx={{ fontSize: 12.5 }}>Loading raw files…</Typography>
      </CenteredHint>
    );
  } else if (files.length === 0) {
    body = (
      <CenteredHint>
        <Typography sx={{ fontSize: 12.5 }}>
          No raw files found for this sonar model.
        </Typography>
      </CenteredHint>
    );
  } else if (filteredFiles.length === 0) {
    body = (
      <CenteredHint>
        <Typography sx={{ fontSize: 12.5 }}>
          No files match “{fileQuery}”.
        </Typography>
      </CenteredHint>
    );
  } else {
    body = (
      <List dense disablePadding sx={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {filteredFiles.map((file) => {
          const checked = selected.has(file.name);
          return (
            <ListItemButton
              key={file.name}
              dense
              selected={controller.activeFileName === file.name}
              onClick={() => controller.identifyFile(file)}
              sx={{
                py: 0.25,
                pl: 1.25,
                pr: 1,
                '&:hover .aa-copy': { opacity: 1 },
              }}
            >
              {/* No `edge="start"`: at size="small" MUI applies marginLeft:-3px,
                  which pulled every row 3px left of the select-all checkbox in
                  the header above. Same pl on both, same padding, aligned. */}
              <Checkbox
                size="small"
                checked={checked}
                tabIndex={-1}
                disableRipple
                onClick={(e) => {
                  e.stopPropagation();
                  controller.toggleFile(file.name);
                }}
                sx={{ p: 0.5, mr: 0.5 }}
              />
              <ListItemText
                primary={file.name}
                secondary={`${formatBytes(file.sizeBytes)} · ${formatAcquired(file.acquiredAt)}`}
                primaryTypographyProps={{
                  sx: {
                    fontFamily: theme.aa.font.mono,
                    fontSize: 12,
                    color: theme.aa.color.text.primary,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  },
                }}
                secondaryTypographyProps={{
                  sx: { fontSize: 11, color: theme.aa.color.text.muted },
                }}
              />
              {/* The absolute address of a file that lives in S3, not on disk. */}
              {vessel && survey && sonar && (
                <CopyPathButton
                  value={nceiS3Uri(vessel.id, survey.id, sonar.id, file.name)}
                  label="Copy s3:// URI"
                />
              )}
            </ListItemButton>
          );
        })}
      </List>
    );
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Results header: select-all + counts */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          pl: 1.25,
          pr: 1,
          py: 0.5,
          minHeight: 32,
          borderBottom: `1px solid ${theme.aa.color.border.subtle}`,
          color: theme.aa.color.text.secondary,
        }}
      >
        <Checkbox
          size="small"
          disabled={filteredFiles.length === 0}
          checked={allShownSelected}
          indeterminate={someShownSelected}
          onChange={() => controller.toggleAll()}
          sx={{ p: 0.5 }}
        />
        <Typography sx={{ fontSize: 12, flex: 1 }}>
          {filteredFiles.length > 0
            ? `${shownSelected} of ${filteredFiles.length} selected`
            : 'Raw files'}
        </Typography>
        {selected.size > 0 && (
          <Typography
            component="button"
            onClick={() => controller.clearSelection()}
            sx={{
              fontSize: 12,
              color: theme.aa.color.accent.main,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              p: 0,
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            Clear
          </Typography>
        )}
      </Box>

      {body}
    </Box>
  );
}
