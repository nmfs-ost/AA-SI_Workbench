import { useEffect, useRef } from 'react';
import { DockviewReact } from 'dockview';
import { Box } from '@mui/material';

import { dockviewComponents } from '../panels/registry';
import { useLayout } from '../../context/LayoutContext';
import { getPipelinesState, subscribePipelines } from '../../state/pipelines';

/**
 * The docking surface. Thin wrapper around <DockviewReact />: it supplies the
 * component map from the registry and the `onReady` handler from the layout
 * controller, and fills the remaining shell height.
 *
 * It also fronts the Configuration tab whenever a pipeline becomes the focused
 * one, so selecting a pipeline card reveals its settings without the user having
 * to hunt for the tab. This lives here because DockLayout is guaranteed to sit
 * inside the layout provider and therefore has access to the Dockview API.
 *
 * The `aa-dockview dockview-theme-dark` classes theme Dockview via the CSS
 * variable overrides in src/theme/dockview-overrides.css.
 */
export function DockLayout() {
  const { onReady, openPanel } = useLayout();
  const lastActiveRef = useRef<string | null>(getPipelinesState().activePipelineId);

  useEffect(() => {
    return subscribePipelines(() => {
      const active = getPipelinesState().activePipelineId;
      if (active !== lastActiveRef.current) {
        lastActiveRef.current = active;
        if (active) openPanel('configuration');
      }
    });
  }, [openPanel]);

  return (
    <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
      <DockviewReact
        className="dockview-theme-dark aa-dockview"
        components={dockviewComponents}
        onReady={onReady}
      />
    </Box>
  );
}
