import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { TimelapseOutlined } from '@mui/icons-material';
import { PanelPlaceholder } from './PanelPlaceholder';

export const ProgressPanel: FunctionComponent<IDockviewPanelProps> = () => (
  <PanelPlaceholder
    icon={TimelapseOutlined}
    panelTitle="Progress"
    title="Nothing here yet"
    description="Progress of long-running tasks will be displayed here."
  />
);
