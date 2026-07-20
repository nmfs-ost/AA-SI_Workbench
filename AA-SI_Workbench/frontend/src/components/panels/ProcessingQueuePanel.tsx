import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { PlaylistPlayOutlined } from '@mui/icons-material';
import { PanelPlaceholder } from './PanelPlaceholder';

export const ProcessingQueuePanel: FunctionComponent<IDockviewPanelProps> = () => (
  <PanelPlaceholder
    icon={PlaylistPlayOutlined}
    title="Processing Queue"
    description="Queued and running jobs will be tracked here."
  />
);
