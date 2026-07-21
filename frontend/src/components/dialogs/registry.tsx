import type { FunctionComponent } from 'react';

import type { DialogId } from '../../types';
import { AboutDialog } from './AboutDialog';
import { EnvironmentDialog } from './EnvironmentDialog';
import { FeedbackDialog } from './FeedbackDialog';

/**
 * THE DIALOG REGISTRY — the extension point for shell-level modals, mirroring
 * the panel registry. A dialog is one component plus one entry here; menu items
 * and toolbar buttons then reference it by id (`action: 'open-dialog'`), and
 * `DialogHost` renders whichever is open. Nothing else changes.
 */

export interface DialogComponentProps {
  open: boolean;
  onClose: () => void;
  /** Opaque argument from the caller, e.g. which issue form to preselect. */
  payload?: string;
}

export interface DialogDefinition {
  id: DialogId;
  component: FunctionComponent<DialogComponentProps>;
}

export const dialogDefinitions: readonly DialogDefinition[] = [
  { id: 'about', component: AboutDialog },
  { id: 'environment', component: EnvironmentDialog },
  { id: 'feedback', component: FeedbackDialog },
] as const;

export const dialogRegistry: Record<string, DialogDefinition> = Object.fromEntries(
  dialogDefinitions.map((definition) => [definition.id, definition]),
);
