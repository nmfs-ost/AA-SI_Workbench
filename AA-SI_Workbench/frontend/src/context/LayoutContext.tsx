import { createContext, useContext, type ReactNode } from 'react';
import {
  useLayoutController,
  type LayoutController,
} from '../hooks/useLayoutController';

/**
 * Distributes the single layout controller to the chrome (menu bar, toolbar)
 * and the docking surface (DockLayout). The controller is created once here so
 * the menus dispatch against the same Dockview instance the DockLayout renders.
 */
const LayoutContext = createContext<LayoutController | null>(null);

export function LayoutProvider({ children }: { children: ReactNode }) {
  const controller = useLayoutController();
  return (
    <LayoutContext.Provider value={controller}>
      {children}
    </LayoutContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLayout(): LayoutController {
  const controller = useContext(LayoutContext);
  if (!controller) {
    throw new Error('useLayout must be used within a <LayoutProvider>.');
  }
  return controller;
}
