import { Box, Checkbox, CircularProgress, Typography, useTheme } from '@mui/material';
import TravelExploreOutlined from '@mui/icons-material/TravelExploreOutlined';

import { formatBytes, nceiS3Uri } from './nceiService';
import { CopyPathButton } from '../CopyPathButton';
import { panelDensity } from '../panelStyles';
import type { NceiSearchController } from './useNceiSearch';

interface Props {
  controller: NceiSearchController;
}

function formatAcquired(iso: string): string {
  // "2019-04-15T12:00:00.000Z" -> "2019-04-15 12:00Z"
  if (!iso) return '';
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}Z`;
}

/** Checkbox trimmed to sit inside a tree-height row without setting the pace. */
const checkboxSx = {
  p: 0.25,
  mr: 0.25,
  flexShrink: 0,
  '& .MuiSvgIcon-root': { fontSize: 15 },
} as const;

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

/**
 * The list of .raw files for the selected sonar, with multi-select.
 *
 * A row is one line, the same height as a row in the Files tree, because these
 * two lists sit one icon apart and used to be visibly different applications.
 * Getting there cost the acquisition-time column: the raw naming convention is
 * `D{YYYYMMDD}-T{HHMMSS}.raw`, so a formatted timestamp beside the filename was
 * printing the same instant twice and taking the width the filename needed to
 * stay unabbreviated. It is still on the row's tooltip, and the From/To fields
 * above are what time-based work actually goes through.
 */
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
        <Typography
          sx={{ fontSize: panelDensity.font.hint, maxWidth: 240, lineHeight: 1.5 }}
        >
          Choose a vessel, survey, and sonar model to list its raw files from NCEI.
        </Typography>
      </CenteredHint>
    );
  } else if (loading.files) {
    body = (
      <CenteredHint>
        <CircularProgress size={16} />
        <Typography sx={{ fontSize: panelDensity.font.hint }}>
          Loading raw files…
        </Typography>
      </CenteredHint>
    );
  } else if (files.length === 0) {
    body = (
      <CenteredHint>
        <Typography sx={{ fontSize: panelDensity.font.hint }}>
          No raw files found for this sonar model.
        </Typography>
      </CenteredHint>
    );
  } else if (filteredFiles.length === 0) {
    body = (
      <CenteredHint>
        <Typography sx={{ fontSize: panelDensity.font.hint }}>
          No files match “{fileQuery}”.
        </Typography>
      </CenteredHint>
    );
  } else {
    body = (
      <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0, py: 0.25 }}>
        {filteredFiles.map((file) => {
          const checked = selected.has(file.name);
          const isActive = controller.activeFileName === file.name;

          return (
            <Box
              key={file.name}
              role="option"
              aria-selected={isActive}
              tabIndex={0}
              onClick={() => controller.identifyFile(file)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  controller.identifyFile(file);
                }
              }}
              title={`${file.name} — acquired ${formatAcquired(file.acquiredAt)}`}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                height: panelDensity.rowHeight,
                pl: 1,
                pr: 0.5,
                cursor: 'pointer',
                userSelect: 'none',
                backgroundColor: isActive
                  ? theme.aa.color.bg.selected
                  : 'transparent',
                '&:hover': { backgroundColor: theme.aa.color.bg.chrome },
                '&:hover .aa-copy': { opacity: 1 },
                '&:focus-visible': {
                  outline: `1px solid ${theme.aa.color.accent.main}`,
                  outlineOffset: -1,
                },
              }}
            >
              <Checkbox
                size="small"
                checked={checked}
                tabIndex={-1}
                disableRipple
                inputProps={{ 'aria-label': `Select ${file.name}` }}
                onClick={(e) => {
                  e.stopPropagation();
                  controller.toggleFile(file.name);
                }}
                sx={checkboxSx}
              />

              <Typography
                sx={{
                  flex: 1,
                  minWidth: 0,
                  fontFamily: theme.aa.font.mono,
                  fontSize: panelDensity.font.row,
                  color: theme.aa.color.text.primary,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {file.name}
              </Typography>

              <Typography
                sx={{
                  fontSize: panelDensity.font.meta,
                  color: theme.aa.color.text.muted,
                  flexShrink: 0,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatBytes(file.sizeBytes)}
              </Typography>

              {/* The absolute address of a file that lives in S3, not on disk. */}
              {vessel && survey && sonar && (
                <CopyPathButton
                  value={nceiS3Uri(vessel.id, survey.id, sonar.id, file.name)}
                  label="Copy s3:// URI"
                />
              )}
            </Box>
          );
        })}
      </Box>
    );
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Results header: select-all + counts. Same left padding and the same
          checkbox metrics as a row, so the two columns line up. */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          pl: 1,
          pr: 0.5,
          py: 0.25,
          minHeight: 28,
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
          inputProps={{ 'aria-label': 'Select all listed files' }}
          sx={checkboxSx}
        />
        <Typography sx={{ fontSize: panelDensity.font.hint, flex: 1 }}>
          {filteredFiles.length > 0
            ? `${shownSelected} of ${filteredFiles.length} selected`
            : 'Raw files'}
        </Typography>
        {selected.size > 0 && (
          <Typography
            component="button"
            onClick={() => controller.clearSelection()}
            sx={{
              fontSize: panelDensity.font.hint,
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
