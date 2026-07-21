import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import {
  FolderOpenOutlined,
  WorkspacesOutlined,
  DataObjectOutlined,
  PlaylistPlayOutlined,
  TravelExploreOutlined,
  LayersOutlined,
  SailingOutlined,
  MapOutlined,
  DescriptionOutlined,
  AccountTreeOutlined,
  SettingsOutlined,
  ScienceOutlined,
  TerminalOutlined,
  ListAltOutlined,
  TimelapseOutlined,
  CodeOutlined,
} from '@mui/icons-material';

import type { PanelDefinition, PanelId } from '../../types';

import { WorkspacePanel } from './WorkspacePanel';
import { FilesPanel } from './FilesPanel';
import { EditorPanel } from './editor/EditorPanel';
import { MapPanel } from './MapPanel';
import { PipelinesPanel } from './pipelines/PipelinesPanel';
import { ConfigurationPanel } from './pipelines/ConfigurationPanel';
import { CalibrationPanel } from './calibration/CalibrationPanel';
import { MetadataPanel } from './MetadataPanel';
import { ProcessingQueuePanel } from './ProcessingQueuePanel';
import { NceiPanel } from './ncei/NceiPanel';
import { DerivedPanel } from './DerivedPanel';
import { OmaoPanel } from './OmaoPanel';
import { TerminalPanel } from './TerminalPanel';
import { LogPanel } from './LogPanel';
import { ProgressPanel } from './ProgressPanel';
import { ConsolePanel } from './ConsolePanel';

/**
 * THE PANEL REGISTRY — the single extension point of the shell.
 *
 * To add a new tool: write its panel component, then add one entry here. Nothing
 * else in the application needs to change. The Dockview component map, the Window
 * menu, and the "re-open a closed panel" logic are all derived from this list.
 */
export const panelDefinitions: readonly PanelDefinition[] = [
  {
    id: 'workspace',
    title: 'Workspace',
    icon: WorkspacesOutlined,
    description: 'The central workspace surface for visualizations.',
    region: 'center',
    component: WorkspacePanel,
    closeable: false,
  },
  {
    id: 'pipelines',
    title: 'Pipelines',
    icon: AccountTreeOutlined,
    description: 'Saved console-tool pipelines, with run controls.',
    region: 'center',
    component: PipelinesPanel,
  },
  {
    id: 'editor',
    title: 'Editor',
    icon: DescriptionOutlined,
    description: 'View and edit a file from the workstation.',
    region: 'center',
    component: EditorPanel as PanelDefinition['component'],
    dynamic: true,
  },

  // Left region — data sources.
  {
    id: 'ncei',
    title: 'NCEI',
    icon: TravelExploreOutlined,
    description: 'Search NCEI; download raws or combine into a derived .nc.',
    region: 'left',
    component: NceiPanel,
  },
  {
    id: 'files',
    title: 'Files',
    icon: FolderOpenOutlined,
    description: "The workstation's local filesystem.",
    region: 'left',
    component: FilesPanel,
  },
  {
    id: 'derived',
    title: 'Derived',
    icon: LayersOutlined,
    description: 'Derived assets (combined NetCDF products).',
    region: 'left',
    component: DerivedPanel,
  },
  {
    id: 'omao',
    title: 'OMAO',
    icon: SailingOutlined,
    description: 'OMAO vessel acoustics data.',
    region: 'left',
    component: OmaoPanel,
  },

  // Right region — details about the current selection.
  {
    id: 'metadata',
    title: 'Metadata',
    icon: DataObjectOutlined,
    description: 'Inspect metadata for the active item.',
    region: 'right',
    component: MetadataPanel,
  },
  {
    id: 'configuration',
    title: 'Configuration',
    icon: SettingsOutlined,
    description: 'Full configuration for the selected pipeline.',
    region: 'right',
    component: ConfigurationPanel,
  },
  {
    id: 'calibration',
    title: 'Calibration',
    icon: ScienceOutlined,
    description: 'Environment and transducer values used when computing Sv.',
    region: 'right',
    component: CalibrationPanel,
  },
  {
    id: 'processingQueue',
    title: 'Processing Queue',
    icon: PlaylistPlayOutlined,
    description: 'Track queued and running jobs.',
    region: 'right',
    component: ProcessingQueuePanel,
  },

  // Bottom region — output and diagnostics.
  {
    id: 'terminal',
    title: 'Terminal',
    icon: TerminalOutlined,
    description: 'Interactive terminal session.',
    region: 'bottom',
    component: TerminalPanel,
  },
  {
    id: 'log',
    title: 'Log',
    icon: ListAltOutlined,
    description: 'Application log messages.',
    region: 'bottom',
    component: LogPanel,
  },
  {
    id: 'progress',
    title: 'Progress',
    icon: TimelapseOutlined,
    description: 'Progress of long-running tasks.',
    region: 'bottom',
    component: ProgressPanel,
  },
  {
    id: 'console',
    title: 'Console',
    icon: CodeOutlined,
    description: 'Console output from tools and scripts.',
    region: 'bottom',
    component: ConsolePanel,
  },
  {
    id: 'map',
    title: 'Map',
    icon: MapOutlined,
    description: 'GPS track for the selected file on a map.',
    region: 'bottom',
    component: MapPanel,
  },
] as const;

/** Fast id -> definition lookup. */
export const panelRegistry: Record<string, PanelDefinition> = Object.fromEntries(
  panelDefinitions.map((definition) => [definition.id, definition]),
);

/** Retrieve a panel definition by id. */
export function getPanelDefinition(id: PanelId): PanelDefinition | undefined {
  return panelRegistry[id];
}

/**
 * The `components` map handed to <DockviewReact />. Dockview looks up a panel's
 * `component` string against this map to know which React component to render.
 */
export const dockviewComponents: Record<
  string,
  FunctionComponent<IDockviewPanelProps>
> = Object.fromEntries(
  panelDefinitions.map((definition) => [definition.id, definition.component]),
);
