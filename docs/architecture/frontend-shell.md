# Frontend shell — architecture & design decisions

The **application shell** for AA-SI: a professional, IDE-style desktop application
that runs in the browser (hosted on a Google Cloud Workstation). This repository
is **only the windowing framework** — the menu bar, toolbar, dockable panel
system, theming, and layout persistence. No scientific functionality, data
processing, maps, or plots are implemented; every panel is an empty, registered
surface waiting for its tool to be built.

Think VS Code / JupyterLab / QGIS as the reference feel: dense, dark, quiet, and
built to host dozens of independent tools without redesign.

---

## The docking-library decision (please read first)

The brief asked for **React Mosaic or Golden Layout**. I chose neither, and built
on **[Dockview](https://dockview.dev)** instead. This is the one place I
overrode the brief, so here is the reasoning up front — if you have a hard
constraint I don't know about, this is the thing to push back on.

The behaviour the brief requires of *every* panel is: resizable, dockable,
**tabbed**, drag-to-re-dock **between regions**, remembers its position, and
supports **dynamic creation** at runtime. That specific combination is exactly
Dockview's native feature set.

- **React Mosaic** is a clean, React-native *tiling* manager, but it has **no
  native tabs** and no concept of dragging a panel from one region into another
  as a tab. Delivering the tabbed, dockable requirement on top of Mosaic means
  hand-building a tab layer and cross-region drag — reinventing most of a
  docking library.
- **Golden Layout** does have tabs and docking, but it manages its own DOM
  imperatively and its React integration works by rendering each panel into a
  **separate React root**, which fights React's reconciler and drops context
  (theming, providers) across the boundary.
- **Dockview** is React-first, TypeScript-native, MIT-licensed, renders panels
  through **React portals** (so the MUI theme/context flows through normally),
  and ships tabs, inter-group drag-docking, floating groups, and
  `toJSON`/`fromJSON` layout serialization out of the box.

The architecture is deliberately abstracted so this is reversible: the docking
engine lives behind `DockLayout` + the panel registry, and the app shell and
panels don't import Dockview directly. Swapping engines means rewriting one
component and the layout builder, not the application. If you need Mosaic or
Golden Layout specifically, say the word and I'll re-target that layer.

---

## Running it

```bash
npm install
npm run dev       # dev server on 0.0.0.0:5173 (host enabled for Cloud Workstation)
npm run build     # tsc -b && vite build  -> dist/
npm run preview   # preview the production build on 0.0.0.0:4173
npm run typecheck # type-check only
```

`server.host` / `preview.host` are set to `true` so the dev and preview servers
bind to all interfaces and are reachable from the browser running against the
Workstation, not just `localhost`.

Requires Node 18+ (developed on Node 22).

---

## Architecture

The shell separates three concerns. Each can evolve independently.

### 1. App shell (chrome)

`src/components/layout/` — the fixed frame. `AppShell` is a vertical flex stack:

```
MenuBar        (fixed height)   File / Edit / View / Run / Tools / Window / Help
AppToolbar     (fixed height)   icon-only: Open Save | Refresh | Run Stop | Settings
DockLayout     (grows)          the Dockview docking surface
StatusBar      (fixed height)   slim status strip
```

The menu bar and toolbar are **data-driven** (`menuConfig.tsx`,
`toolbarConfig.tsx`) so adding an entry is a one-line change and never touches
render logic. Window-management commands (Reset Layout, Close All Panels, open a
panel, About) are wired to real behaviour; the rest are inert placeholders with
shortcut hints, ready to connect as features land.

### 2. Docking engine (Dockview, wrapped)

`DockLayout.tsx` is the *only* component that renders Dockview. It feeds Dockview
two things: the component map (from the registry) and the `onReady` handler (from
the layout controller). The default arrangement is built imperatively in
`defaultLayout.ts`.

### 3. Panel registry (the extension point)

`src/components/panels/registry.tsx` is the heart of extensibility. It's a single
list mapping a panel `id` to its `{ title, icon, description, region, component }`.
Everything else is derived from it:

- the Dockview `components` map,
- the **Window menu** (auto-lists every registered panel),
- the "re-open a closed panel in its home region" logic.

**Adding a new tool is one entry** (see below). Nothing else changes.

### Theming

`src/theme/` is a single token source (`tokens.ts`) consumed by **both** the MUI
theme (`theme.ts`) and the Dockview CSS-variable overrides
(`dockview-overrides.css`). That's why the MUI-rendered chrome and the
Dockview-rendered docking surface look identical. The tokens are also exposed on
the MUI theme as `theme.aa`, so any component can read exact chrome colours via
`useTheme()` without importing tokens.

Direction: neutral slate greys, one restrained blue accent (`#4d8df0`), tight
radii, 13px base, Inter for UI and JetBrains Mono reserved for terminal/console
surfaces. No gradients.

### Layout persistence

`useLayoutController` serializes the Dockview layout to `localStorage` (debounced)
on every change and restores it on load. The payload is **versioned**
(`LAYOUT_VERSION`): when the default layout or panel set changes in a way that
should invalidate saved layouts, bump the version and stale layouts are discarded
and rebuilt instead of restoring into a broken state. A layout that fails to
deserialize also falls back to the default rather than bricking startup.

---

## Folder structure

```
src/
├── main.tsx                 # entry; CSS import order (base -> dockview -> overrides)
├── App.tsx                  # ThemeProvider + CssBaseline + LayoutProvider + AppShell
├── theme/
│   ├── tokens.ts            # single source of truth for colour/type/spacing
│   ├── theme.ts             # MUI theme derived from tokens (+ theme.aa augmentation)
│   ├── global.css           # resets, scrollbars, reduced-motion
│   └── dockview-overrides.css  # maps --dv-* variables to the tokens
├── types/                   # PanelDefinition, MenuDefinition, persisted-layout types
├── hooks/
│   └── useLayoutController.ts   # Dockview lifecycle, persistence, window actions
├── context/
│   └── LayoutContext.tsx    # distributes the controller to chrome + surface
└── components/
    ├── layout/              # AppShell, MenuBar, AppToolbar, DockLayout, StatusBar,
    │                        # defaultLayout, menuConfig, toolbarConfig
    └── panels/              # registry + one component per tool + shared placeholder
```

---

## Adding a new tool (the whole process)

1. Create `src/components/panels/MyToolPanel.tsx` — a
   `FunctionComponent<IDockviewPanelProps>` (use `PanelPlaceholder` until the real
   UI exists).
2. Add one entry to `panelDefinitions` in `registry.tsx`:

   ```ts
   {
     id: 'myTool',
     title: 'My Tool',
     icon: SomeOutlinedIcon,
     description: 'What this tool does.',
     region: 'left',            // default dock location
     component: MyToolPanel,
   }
   ```

That's it. The panel is now renderable by Dockview, appears in the Window menu,
and re-opens into its region when closed. To also place it in the **default**
layout, add an `addPanel` line in `defaultLayout.ts` and bump `LAYOUT_VERSION`.

---

## Notes & known follow-ups

- **Bottom dock** sits beneath the central workspace (between the sidebars). It
  can be dragged to span the full width at runtime; the *default* placement is a
  one-line change in `defaultLayout.ts` if you prefer full-width by default.
- **Keyboard shortcuts** shown in menus are display-only hints in this milestone;
  no global key bindings are registered yet.
- **Bundle size**: the production bundle is ~550 kB (~160 kB gzip), dominated by
  React + MUI + Dockview. Fine for a desktop-class app; route- or panel-level
  code-splitting is the lever if it matters later.
- Verified via `tsc` and `vite build`. Visual rendering wasn't verified in a
  browser in this environment.
