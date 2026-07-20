import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { WaterfallChartOutlined } from '@mui/icons-material';
import { ViewerScaffold } from './ViewerScaffold';

/** Center viewer for a raw echogram, tied to the NCEI file selection. */
export const EchogramPanel: FunctionComponent<IDockviewPanelProps> = () => (
  <ViewerScaffold
    title="Echogram"
    icon={WaterfallChartOutlined}
    instruction="Select a raw file in the NCEI panel to view its echogram here."
    note="Live echogram rendering isn't wired yet — this viewer is ready for it."
  />
);
