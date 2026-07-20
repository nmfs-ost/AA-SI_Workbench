import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { ListAltOutlined } from '@mui/icons-material';
import { PanelPlaceholder } from './PanelPlaceholder';

export const LogPanel: FunctionComponent<IDockviewPanelProps> = () => (
  <PanelPlaceholder
    icon={ListAltOutlined}
    title="Log"
    description="Application log messages will stream here."
  />
);
