import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Stylesheet order matters: base resets, then Dockview's stylesheet, then our
// Dockview variable overrides so the AA-SI palette wins.
import './theme/global.css';
import 'dockview/dist/styles/dockview.css';
import './theme/dockview-overrides.css';

import App from './App';
import { withoutSignInToken } from './services/addressApi';

// A link that signed this browser in to the Cloud Workstation carries a
// one-time ?_workstationAccessToken=…. The address bar shows the address
// without it, the one to bookmark (see Help ▸ Link to this Workbench).
const clean = withoutSignInToken(window.location.href);
if (clean !== window.location.href) window.history.replaceState(window.history.state, '', clean);

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root was not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
