import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { SailingOutlined } from '@mui/icons-material';
import { PanelPlaceholder } from './PanelPlaceholder';

export const OmaoPanel: FunctionComponent<IDockviewPanelProps> = () => (
  <PanelPlaceholder
    icon={SailingOutlined}
    title="OMAO"
    description="OMAO vessel acoustics data will be browsable here."
  />
);
