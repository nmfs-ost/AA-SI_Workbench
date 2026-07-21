import {
  SystemUpdateAltOutlined,
  BugReportOutlined,
} from '@mui/icons-material';
import type { DialogId, IconComponent, ShellActionId } from '../../types';

/**
 * Icons-only toolbar. Declarative on purpose: each entry is a labelled icon
 * (the label drives the tooltip and the accessible name). A `spacer` pushes
 * everything after it to the right-hand end of the bar.
 *
 * **Every item here does something.** The bar used to open with Open, Save,
 * Refresh, Run, Stop and Settings — six buttons that were affordances awaiting
 * a feature, and clicked to no effect. A control that does nothing teaches
 * people not to trust the controls that do, so they were removed rather than
 * disabled. Save and Open live in the File menu, where they are wired; Run and
 * Stop belong to the Pipelines panel if and when pipelines execute.
 *
 * If a future feature wants a toolbar button, add it here *with* its action.
 */
export type ToolbarItem =
  | {
      id: string;
      kind: 'button';
      label: string;
      icon: IconComponent;
      /** What the button does. Optional in the type, but don't ship one without it. */
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
