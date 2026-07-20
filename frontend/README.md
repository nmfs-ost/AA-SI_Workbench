# AA-SI Workbench — Frontend

The browser-based user interface for the AA-SI Workbench: an IDE-style, dockable
workspace built as an application shell (menu bar, toolbar, status bar, docking
surface) that hosts tool panels registered through a central panel registry.

For the full design rationale — including why the docking layer is built on
Dockview — see
[`../docs/architecture/frontend-shell.md`](../docs/architecture/frontend-shell.md).

## Stack

- **React 18** + **TypeScript**
- **Vite** (dev server + build)
- **Material UI (v6)** for the chrome/component layer and theming
- **Dockview** for the resizable, tabbed, dockable panel system

## Structure

```
frontend/
├── index.html
├── vite.config.ts
├── tsconfig*.json
└── src/
    ├── main.tsx                 App entry (theme + global styles + shell)
    ├── App.tsx
    ├── theme/                   Design tokens + MUI theme + Dockview overrides
    ├── types/                   Shared types (panels, menus, layout)
    ├── hooks/                   Layout controller (persistence + actions)
    ├── context/                 Layout context provider
    └── components/
        ├── layout/              Menu bar, toolbar, status bar, dock surface
        └── panels/              Panel components + the panel registry
```

## Run

From the **repository root** (recommended):

```bash
npm run setup     # installs the frontend dependencies
npm run dev       # Vite dev server at http://localhost:5173
```

Or directly inside this folder:

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production build to dist/
npm run preview   # serve the build at http://localhost:4173
```

## Adding a tool

Write a panel component under `src/components/panels/`, then add one entry to the
panel registry (`src/components/panels/registry.tsx`). The Dockview component
map, the Window menu, and re-open logic are all derived from that registry — no
other wiring required.
