import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { TerminalOutlined } from '@mui/icons-material';
import { PanelPlaceholder } from './PanelPlaceholder';

export const TerminalPanel: FunctionComponent<IDockviewPanelProps> = () => (
  <PanelPlaceholder
    icon={TerminalOutlined}
    title="Terminal"
    description="An interactive terminal session will run here."
  />
);
