import {
  FolderOpenOutlined,
  SaveOutlined,
  Refresh,
  PlayArrow,
  Stop,
  SettingsOutlined,
  SystemUpdateAltOutlined,
  BugReportOutlined,
} from '@mui/icons-material';
import type { DialogId, IconComponent, ShellActionId } from '../../types';

/**
 * Icons-only toolbar. Declarative on purpose: each entry is a labelled icon
 * (the label drives the tooltip and the accessible name). Items carrying an
 * `action` are wired; the rest are affordances awaiting their feature. A
 * `spacer` pushes everything after it to the right-hand end of the bar.
 */
export type ToolbarItem =
  | {
      id: string;
      kind: 'button';
      label: string;
      icon: IconComponent;
      /** Wired behaviour. Omit for a placeholder affordance. */
      action?: ShellActionId;
      /** For 'open-dialog'. */
      dialogId?: DialogId;
      dialogPayload?: string;
      /** For 'open-external'. */
      href?: string;
    }
  | { id: string; kind: 'divider' }
  | { id: string; kind: 'spacer' };

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

  { id: 'spacer', kind: 'spacer' },

  {
    id: 'environment',
    kind: 'button',
    label: 'Update Python environment (aa-setup)',
    icon: SystemUpdateAltOutlined,
    action: 'open-dialog',
    dialogId: 'environment',
  },
  {
    id: 'feedback',
    kind: 'button',
    label: 'Report a problem or suggest an improvement',
    icon: BugReportOutlined,
    action: 'open-dialog',
    dialogId: 'feedback',
  },
];
