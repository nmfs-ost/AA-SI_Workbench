import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

import { theme } from './theme';
import { LayoutProvider } from './context/LayoutContext';
import { AppShell } from './components/layout';

/**
 * Application root. Establishes the MUI theme, resets base styles, provides the
 * layout controller, and mounts the shell.
 */
export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <LayoutProvider>
        <AppShell />
      </LayoutProvider>
    </ThemeProvider>
  );
}
