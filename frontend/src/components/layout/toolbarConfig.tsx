import {
  FolderOpenOutlined,
  SaveOutlined,
  Refresh,
  PlayArrow,
  Stop,
  SettingsOutlined,
} from '@mui/icons-material';
import type { IconComponent } from '../../types';

/**
 * Icons-only toolbar. Declarative on purpose: each entry is a labelled icon
 * (the label drives the tooltip and the accessible name). Handlers are wired as
 * the corresponding features land — the shell milestone ships the affordances,
 * not the behaviour. Dividers separate logical groups.
 */
export type ToolbarItem =
  | { id: string; kind: 'button'; label: string; icon: IconComponent }
  | { id: string; kind: 'divider' };

export const toolbarItems: ToolbarItem[] = [
  { id: 'open', kind: 'button', label: 'Open', icon: FolderOpenOutlined },
  { id: 'save', kind: 'button', label: 'Save', icon: SaveOutlined },
  { id: 'div-1', kind: 'divider' },
  { id: 'refresh', kind: 'button', label: 'Refresh', icon: Refresh },
  { id: 'div-2', kind: 'divider' },
  { id: 'run', kind: 'button', label: 'Run', icon: PlayArrow },
  { id: 'stop', kind: 'button', label: 'Stop', icon: Stop },
  { id: 'div-3', kind: 'divider' },
  { id: 'settings', kind: 'button', label: 'Settings', icon: SettingsOutlined },
];
