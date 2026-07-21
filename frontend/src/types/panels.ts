import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import type { SvgIconTypeMap } from '@mui/material';
import type { OverridableComponent } from '@mui/material/OverridableComponent';

/** The exact type of an `@mui/icons-material` icon component. */
export type IconComponent = OverridableComponent<SvgIconTypeMap>;

/**
 * The default docking region a panel opens into. This is only a *hint* used to
 * build the initial layout and to re-open a panel that the user has closed —
 * once the app is running the user can drag panels anywhere they like.
 */
export type PanelRegion = 'left' | 'right' | 'bottom' | 'center';

/** The identifiers of the panels shipped with the shell. */
export type BuiltinPanelId =
  | 'workspace'
  | 'pipelines'
  | 'editor'
  | 'metadata'
  | 'configuration'
  | 'calibration'
  | 'processingQueue'
  | 'ncei'
  | 'files'
  | 'derived'
  | 'omao'
  | 'terminal'
  | 'log'
  | 'progress'
  | 'console'
  | 'map';

/**
 * Panel ids are strings so that tools can be registered dynamically at runtime.
 * `BuiltinPanelId` narrows the set that ships in the box while still permitting
 * arbitrary future ids.
 */
export type PanelId = BuiltinPanelId | (string & {});

/**
 * A single registerable tool. The registry maps `id -> PanelDefinition`; this is
 * the one place a new tool has to be declared. Dockview renders the `component`
 * and shows `title` in the tab; `icon`/`description` drive the menus and the
 * empty-state chrome.
 */
export interface PanelDefinition {
  id: PanelId;
  title: string;
  icon: IconComponent;
  /** Short summary of the tool, used for menu tooltips and documentation. */
  description: string;
  /** Where this panel opens by default / re-opens when closed. */
  region: PanelRegion;
  /** The React component rendered inside the Dockview panel. */
  component: FunctionComponent<IDockviewPanelProps>;
  /**
   * If false the panel cannot be closed by the user (the central workspace).
   * Defaults to true.
   */
  closeable?: boolean;
  /**
   * A template rather than a panel: opened programmatically, many times, with
   * different parameters (the file editor). Dynamic panels are registered as
   * Dockview components but are left out of the Window menu, the default
   * layout, and the activity bar, because "open an editor" is not a thing to
   * pick from a list — you open a *file*.
   */
  dynamic?: boolean;
}
