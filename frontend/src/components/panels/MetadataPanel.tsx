import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { Box, Typography, useTheme } from '@mui/material';
import { DataObjectOutlined } from '@mui/icons-material';

import { PanelPlaceholder } from './PanelPlaceholder';
import { AssetView } from './metadata/AssetView';
import { StoreView } from './metadata/StoreView';
import { useActiveSubject } from '../../state/activeSubject';

/**
 * Metadata panel — what the active subject *is*.
 *
 * This is now a router rather than a view, because "the active subject" stopped
 * being one shape. Two things can be selected and they are described by
 * different means:
 *
 *   NCEI file  → catalogue metadata, already in memory from the search.
 *   Zarr store → `aa-store info --json`, one JSON line, read from the store.
 *
 * The second is the one that was missing. The Derived panel could already find
 * a combined store — the artifact of the whole acquire → convert → assemble
 * sector — and clicking it did nothing anywhere, because this panel could only
 * be about an NCEI raw file. A store carries its own lineage in its root
 * attributes precisely so it can be understood long after the handle that
 * announced it was lost, and there was nothing here to read it.
 *
 * Routing on the subject rather than offering a source selector is deliberate:
 * the user has already chosen, by clicking a row in the left dock. Asking again
 * here would be a second control for a decision that was made.
 */
export const MetadataPanel: FunctionComponent<IDockviewPanelProps> = () => {
  const theme = useTheme();
  const subject = useActiveSubject();

  if (!subject) {
    return (
      <PanelPlaceholder
        icon={DataObjectOutlined}
        title="Metadata"
        description="Select a file in NCEI, or a store in Derived or Files, to describe it."
      />
    );
  }

  if (subject.inspectable) return <StoreView subject={subject} />;
  if (subject.asset) return <AssetView asset={subject.asset} />;

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
};
