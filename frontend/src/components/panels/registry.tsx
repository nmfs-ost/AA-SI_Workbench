import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import {
  CallMergeRounded,
  FolderOpenOutlined,
  DataObjectOutlined,
  PlaylistPlayOutlined,
  LayersOutlined,
  SailingOutlined,
  HubOutlined,
  DescriptionOutlined,
  AccountTreeOutlined,
  SettingsOutlined,
  ScienceOutlined,
  TerminalOutlined,
  ListAltOutlined,
  TimelapseOutlined,
  CodeOutlined,
  MenuBookOutlined,
  WavesOutlined,
  TableChartOutlined,
  SchemaOutlined,
  SavingsOutlined,
} from '@mui/icons-material';

import type { PanelDefinition, PanelId } from '../../types';

import { FilesPanel } from './FilesPanel';
import { EditorPanel } from './editor/EditorPanel';
import { PipelinesPanel } from './pipelines/PipelinesPanel';
import { RecipesPanel } from './recipes/RecipesPanel';
import { ConfigurationPanel } from './pipelines/ConfigurationPanel';
import { CalibrationPanel } from './calibration/CalibrationPanel';
import { MetadataPanel } from './MetadataPanel';
import { ProcessingQueuePanel } from './ProcessingQueuePanel';
import { PreparePanel } from './prepare/PreparePanel';
import { DerivedPanel } from './DerivedPanel';
import { OmaoPanel } from './OmaoPanel';
import { ResourcesPanel } from './resources/ResourcesPanel';
import { TerminalPanel } from './TerminalPanel';
import { LogPanel } from './LogPanel';
import { ProgressPanel } from './ProgressPanel';
import { ConsolePanel } from './ConsolePanel';
import { EchogramPanel } from './echogram/EchogramPanel';
import { ResultsPanel } from './results/ResultsPanel';
import { DataflowPanel } from './dataflow/DataflowPanel';
import { CostsPanel } from './costs/CostsPanel';

/**
 * THE PANEL REGISTRY — the single extension point of the shell.
 *
 * To add a new tool: write its panel component, then add one entry here. Nothing
 * else in the application needs to change. The Dockview component map, the Window
 * menu, and the "re-open a closed panel" logic are all derived from this list.
 */
export const panelDefinitions: readonly PanelDefinition[] = [
  {
    id: 'pipelines',
    title: 'Pipelines',
    icon: AccountTreeOutlined,
    description: 'Console tools chained, run on products in the bucket.',
    region: 'center',
    component: PipelinesPanel,
  },
  {
    id: 'recipes',
    title: 'Recipes',
    icon: MenuBookOutlined,
    description: "aa-recipe-manager's YAML workflow recipes, discovered from disk.",
    region: 'center',
    component: RecipesPanel,
  },
  {
    id: 'echogram',
    title: 'Echogram',
    icon: WavesOutlined,
    description: 'An Sv, MVBS or mask product as an echogram: colour scale, readout, lines and regions.',
    region: 'center',
    component: EchogramPanel,
  },
  {
    id: 'results',
    title: 'Results',
    icon: TableChartOutlined,
    description: 'Integration results (NASC by interval and layer, by region).',
    region: 'center',
    component: ResultsPanel,
  },
  {
    id: 'costs',
    title: 'Storage costs',
    icon: SavingsOutlined,
    description: 'What the bucket costs to keep: per month and year, by folder, class and product.',
    region: 'center',
    component: CostsPanel,
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

  // Left region — the baseline workflow, then the data sources.
  /* First, and fronted on a fresh layout: the operation almost everything else
     starts from (an NCEI time range -> one EchoData asset in the bucket). It
     sits with the sources because it is where their data becomes an asset;
     the browsers below it are for looking, this is for making. */
  {
    id: 'prepare',
    title: 'Prepare EchoData',
    icon: CallMergeRounded,
    description: 'The baseline: an NCEI time range, made into one EchoData asset in the bucket.',
    region: 'left',
    component: PreparePanel,
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
    title: 'Products',
    icon: LayersOutlined,
    description:
      'Products in the bucket, with their hashes. Select one (or tick several) to run a pipeline on it.',
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
  /* The project itself, rather than a source of data.
     It sits on the left because that strip already carries the shell's
     standing, selection-independent things — the environment updater and the
     feedback dialog live there under a divider — whereas the right dock is
     entirely "about the thing currently selected", which this is not. */
  {
    id: 'resources',
    title: 'Project',
    icon: HubOutlined,
    description: 'Repositories, documentation, and where to ask.',
    region: 'left',
    component: ResourcesPanel,
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
    id: 'dataflow',
    title: 'Dataflow',
    icon: SchemaOutlined,
    description: 'What the selected product was made from and what was made from it, and what is out of date.',
    region: 'right',
    component: DataflowPanel,
  },
  {
    id: 'configuration',
    title: 'Configuration',
    icon: SettingsOutlined,
    description: 'Full configuration for the selected pipeline or recipe.',
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
