import { useEffect, useMemo } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

import { applyCssVariables, baseFor, createAppTheme, tokensFor } from './theme';
import { useThemeMode } from './state/theme';
import { LayoutProvider } from './context/LayoutContext';
import { AppShell } from './components/layout';

/**
 * Application root. Establishes the MUI theme, resets base styles, provides the
 * layout controller, and mounts the shell.
 *
 * A palette change has to reach three different rendering systems, so it is
 * applied in two places rather than one. MUI components read `theme.aa.*`
 * through the provider below and repaint on the context change; the two static
 * stylesheets — ours and Dockview's — read `var(--aa-*)`, which is why the same
 * tokens are also written onto the document element here. Dockview itself is
 * never told anything: its `--dv-*` variables are declared in terms of ours, so
 * the docking surface follows without a rebuild, and open panels, tab strips
 * and sashes keep their state through the switch.
 */
export default function App() {
  const mode = useThemeMode();
  const theme = useMemo(() => createAppTheme(mode), [mode]);

  useEffect(() => {
    applyCssVariables(tokensFor(mode));
    /* Tells the browser which way round form controls, scrollbars and the
       native caret should be drawn. Without it a light theme still gets dark
       select dropdowns and a dark scrollbar gutter. */
    document.documentElement.style.colorScheme = baseFor(mode);
  }, [mode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <LayoutProvider>
        <AppShell />
      </LayoutProvider>
    </ThemeProvider>
  );
}
