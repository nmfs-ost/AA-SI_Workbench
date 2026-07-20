import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { CodeOutlined } from '@mui/icons-material';
import { PanelPlaceholder } from './PanelPlaceholder';

export const ConsolePanel: FunctionComponent<IDockviewPanelProps> = () => (
  <PanelPlaceholder
    icon={CodeOutlined}
    title="Console"
    description="Console output from tools and scripts will appear here."
  />
);
