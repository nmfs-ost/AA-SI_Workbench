import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Stylesheet order matters: base resets, then Dockview's stylesheet, then our
// Dockview variable overrides so the AA-SI palette wins.
import './theme/global.css';
import 'dockview/dist/styles/dockview.css';
import './theme/dockview-overrides.css';

import App from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root was not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
