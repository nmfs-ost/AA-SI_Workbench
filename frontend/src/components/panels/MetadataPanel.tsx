import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { Box, Typography, useTheme } from '@mui/material';
import { DataObjectOutlined } from '@mui/icons-material';

import { PanelHeader } from './PanelHeader';
import { PanelPlaceholder } from './PanelPlaceholder';
import { StoreView } from './metadata/StoreView';
import { ProvenanceView } from './metadata/ProvenanceView';
import { useActiveSubject } from '../../state/activeSubject';

/**
 * Metadata panel — what the active subject *is*.
 *
 * This is now a router rather than a view, because "the active subject" stopped
 * being one shape. What can be selected is described by different means:
 *
 *   Zarr store   → `aa-store info --json`, one JSON line, read from the store.
 *   Product file → its provenance, read back by `aa-metadata`.
 *
 * A store or product carries its own lineage precisely so it can be understood
 * long after the handle that announced it was lost; this panel reads it.
 *
 * Routing on the subject rather than offering a source selector is deliberate:
 * the user has already chosen, by clicking a row in the left dock. Asking again
 * here would be a second control for a decision that was made.
 */
export const MetadataPanel: FunctionComponent<IDockviewPanelProps> = () => {
  const theme = useTheme();
  const subject = useActiveSubject();
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, backgroundColor: theme.aa.color.bg.panel }}>
      <PanelHeader
        icon={<DataObjectOutlined className="panel-header-icon" />}
        title="Metadata"
        subtitle={subject?.label}
      />
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <MetadataBody />
      </Box>
    </Box>
  );
};

function MetadataBody() {
  const theme = useTheme();
  const subject = useActiveSubject();

  if (!subject) {
    return (
      <PanelPlaceholder
        icon={DataObjectOutlined}
        title="Nothing selected"
        description="Select a product in Products (or a result of Prepare EchoData or a pipeline run), or a file in Files, to see what it is and how it was made."
      />
    );
  }

  if (subject.inspectable) return <StoreView subject={subject} />;
  /* A product file — the Prepare card's EchoData and Sv, an echogram, a
     NetCDF picked in Products or Files: the console tools wrote how it was
     made into it, and `aa-metadata` reads that back. */
  if (/^(gs|file):\/\//.test(subject.uri) && /\.(nc|netcdf4|png|html|json)$/i.test(subject.label)) {
    return <ProvenanceView subject={subject} />;
  }

  /* Selected, but nothing here can describe it: a raw file on disk, a NetCDF
     export, an object of some other kind. Saying so beats an empty panel that
     looks broken, and naming what *would* be describable is the difference
     between a dead end and an instruction. */
  return (
    <Box
      sx={{
        height: '100%',
        overflowY: 'auto',
        p: 1.5,
        backgroundColor: theme.aa.color.bg.panel,
      }}
    >
      <Typography
        sx={{
          fontFamily: theme.aa.font.mono,
          fontSize: 12,
          wordBreak: 'break-all',
          color: theme.aa.color.text.primary,
          mb: 0.75,
        }}
      >
        {subject.label}
      </Typography>
      <Typography sx={{ fontSize: 11.5, color: theme.aa.color.text.muted, lineHeight: 1.6 }}>
        No description available for a <b>{subject.layer}</b> artifact. `aa-store` reads Zarr
        stores; a NetCDF export is a handoff format that nothing downstream reads back, and a
        raw file is described by the catalogue it came from.
      </Typography>
    </Box>
  );
}
