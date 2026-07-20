import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { LayersOutlined } from '@mui/icons-material';
import { PanelPlaceholder } from './PanelPlaceholder';

export const DerivedPanel: FunctionComponent<IDockviewPanelProps> = () => (
  <PanelPlaceholder
    icon={LayersOutlined}
    title="Derived"
    description="Derived assets (combined NetCDF products) will be listed here."
  />
);
