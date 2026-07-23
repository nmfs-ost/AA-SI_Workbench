# AA-SI Workbench — session handoff

Dense state summary for resuming work. **The source is ground truth** — re-read the
actual files before acting; this repo has drifted from mid-session assumptions before
(panels removed or moved between turns). Verify, don't assume.

## Read this first
This document is a map, not a substitute for the code. Read it top-to-bottom once at
the start of a session, then use it as an index. Three habits matter more than
anything else in it:

1. **Open the file before you change it.** Every section here was true when it was
   written and several have been wrong since.
2. **Run it before you claim it works.** Frontend: `cd frontend && npm install &&
   npm run build && npm test`. Backend: `cd backend && ruff check . && pytest`. A
   section of this document saying something passes is not evidence that it still
   does.
3. **Say what wasn't verified.** Nothing in this sandbox can render a browser, reach
   GCP, or run `aalibrary`/echopype. A great deal of the UI has therefore never been
   *seen*. Distinguish wired / preview-only / untested every time, and never let a
   clean build stand in for "it works".

### Where things stand
The backend and the whole editor/filesystem layer are real and tested. The shell
chrome — two icon strips, two monitor layouts, hidden dock tab strips — is built and
type-checked but **has never rendered in a browser**, so its visual behaviour is the
largest open risk. The scientific core (pipelines, echogram rendering, real GPS) is
still UI-only: `buildCommand()` produces exact command chains that nothing executes.

The most valuable next moves, in order: get it on screen and fix what the layout
tests can't catch; wire `.raw` selection to the Metadata panel (TODO 14); then make
pipelines actually run (TODO 8).

## Rules that are load-bearing
Break these and something silently stops working, usually somewhere else.

1. **Code is ground truth.** Verify with a read or a grep before editing.
2. **Never claim it runs without running it.** See above for the commands. Say
   plainly what is wired, what is preview-only, and what could not be tested
   here (anything needing `aalibrary`, echopype, or GCP credentials).
3. **Schema-driven, always.** Panels come from `panelDefinitions`
   (`components/panels/registry.tsx`), dialogs from `dialogs/registry.tsx`,
   pipeline params from `pipelineDefinitions.ts`, NCEI options from
   `combineOptions.ts`, new-file kinds from `NEW_FILE_SUFFIX` in `api/files.py`.
   Adding a tool, a field, or a panel touches a *definition*, never a component.
4. **Cross-panel state lives in a `state/` module store** (useSyncExternalStore),
   never React context. Dockview mounts panels through portals, so context does
   not reach them. Current stores: activeAsset, calibration, configurationFocus,
   dialogs, editors, environment, fileBrowser, mapTrack, pipelines, recipes,
   terminal, theme.
5. **Bump `LAYOUT_VERSION`** (`frontend/src/types/layout.ts`) whenever the
   default dock layout changes. A saved layout that references a removed panel
   is how returning users get a broken window.
6. **`aa-get` / `aa-fetch` are interactive.** They are composed and handed to
   the PTY terminal, never driven headlessly. Do not "improve" this. **This rule
   is about those tools, not about terminals in general**: `aa-recipe` (Brett's
   recipe manager) is a genuine batch CLI and its terminal handoff is a stopgap,
   not a constraint — see the Recipes section and TODO 28.
7. **The terminal is arbitrary code execution by design.** The security boundary
   is the loopback check, not the command. Mirror the `AASI_ALLOW_REMOTE_*`
   guard in any new route that touches the machine (fs, terminal, environment,
   derived all have one).

## What this is
NOAA Fisheries **AA-SI (Active Acoustics Strategic Initiative) Workbench**: an
IDE-style scientific desktop app that runs in a browser on a Google Cloud
Workstation. Monorepo: React/TS frontend shell (VS Code / QGIS feel) + Python
FastAPI backend + NOAA governance files. AA-SI org on GitHub is **nmfs-ost**.

## Stack (verified against installed deps)
React 18.3.1 · TypeScript 5.6.3 · MUI 6.5.0 (@mui/material + icons-material +
emotion) · **Dockview 1.17.2** (docking) · Vite 5.4 · Node 22. Backend: Python
≥3.11 · FastAPI · uvicorn · pydantic v2 · boto3 · (optional) google-cloud-bigquery.
TS is strict incl. noUnusedLocals/Parameters — no unused imports/vars/params.
Frontend tests: **Vitest 2.1** (`npm test` → `vitest run`), covering pure logic only.

## Run it
```bash
pip install -e backend      # in the env where aa-find works (needs aalibrary importable)
aa-workbench                # builds UI first run, serves UI+API on :8000
```
Real NCEI data: default `--source s3` (public bucket, NO creds). Faster path:
`--source cache` + `gcloud auth application-default login` (BigQuery on ggn-nmfs-aa-dev-1).

Checks (`make lint`, `make test`, or directly):
```bash
cd frontend && npm run typecheck && npm test && npm run build
cd backend  && ruff check . && pytest
```

## Architecture / key decisions
- **Docking = Dockview** (not Mosaic/Golden Layout). Chosen for tabs + inter-region
  drag-dock + serializable layout. Documented in docs/architecture/frontend-shell.md.
- **Panel registry is the single extension point**: `frontend/src/components/panels/registry.tsx`.
  Add a tool = 1 component + 1 registry entry. `dockviewComponents`/Window menu/reopen
  logic all derive from `panelDefinitions`.
- **Dialog registry** = the same idea for shell modals: `frontend/src/components/dialogs/
  registry.tsx` (`{id, component}`) + `state/dialogs.ts` (open id + payload) +
  `DialogHost` mounted once in AppShell. Menu/toolbar items say
  `{action:'open-dialog', dialogId}` — no chrome component imports a dialog. `ShellActionId`
  now also has `open-external` (href → new tab). About moved out of MenuBar into the registry.
- **NCEI data seam = `NceiCatalogSource`** (frontend/src/components/panels/ncei/nceiService.ts).
  `nceiSource` binding = `apiNceiSource` when `VITE_AASI_USE_API==='true'`, else `mockNceiSource`.
- **Cross-panel metadata bridge** = module store `frontend/src/state/activeAsset.ts`
  (useSyncExternalStore). NCEI publishes on file identify; Metadata panel subscribes.
  Works regardless of Dockview mounting (don't rely on React context through portals).
- **Backend NCEI providers** (backend/src/aa_si_workbench/api/ncei.py): `S3Provider`
  (anonymous, default) and `CacheProvider` (BigQuery). Selected by env `AASI_NCEI_SOURCE`.
- **`aa-workbench` launcher** (backend/src/aa_si_workbench/cli.py): FastAPI serves the
  compiled `frontend/dist` as static next to `/api` → single process, single port,
  no Node/proxy/CORS at runtime. `_paths.py` resolves dist (override env → bundled
  `aa_si_workbench/_frontend/` → source `frontend/dist`).

## Current layout (defaultLayout.ts, LAYOUT_VERSION = 14)
```
┌──┬──────────┬───────────────────────┬──────────┬──┐
│A │  LEFT    │  CENTER: Pipelines +  │  RIGHT   │I │
│  │          │  open files as tabs   │          │  │
│  │          ├───────────────────────┤          │  │
│  │          │   BOTTOM  (tabs)      │          │  │
└──┴──────────┴───────────────────────┴──────────┴──┘
```
- **Icon strips on both outer edges (shell chrome — NOT Dockview regions).**
  `components/layout/SideBar.tsx`, rendered twice in AppShell either side of
  `<DockLayout/>`. See their own section below.
- **Left window (data sources):** NCEI (real content, fronts on load) · Files ·
  Derived · OMAO. (An earlier Recipes placeholder was REMOVED from this group; the real
  Recipes feature now lives in the *center*, beside Pipelines — see its own section.)
  FileBrowser + WorkflowExplorer previously REMOVED.
  **The tab strip is hidden** — the left icon strip is its tab strip. The four
  panels are still one Dockview group, just chrome-less.
- **Center (ONE group):** Pipelines · Recipes (tabs, Pipelines fronted on a fresh install),
  plus one tab per open file. The center is not split —
  Echogram used to own the right half. Sv panel REMOVED earlier (the aa-sv *pipeline stage*
  remains in pipelineDefinitions — different thing).
- **Workspace REMOVED** (user: "we don't use it"). It was a placeholder showing the app name,
  but it was also the *anchor*: every region was positioned relative to it, `openPanel` and
  `openEditor` fell back to it by id, and `closeable: false` guaranteed it survived Close All
  Panels. **Pipelines is the anchor now**, and — more importantly — nothing assumes an anchor
  exists any more. `openPanel` looks for any centre-region panel and, finding none, adds
  positionless (Dockview gives it a fresh group). That is what makes every panel closeable
  without the shell painting itself into a corner.
- **Echogram REMOVED** (user: "in the way, no longer needed").
  `EchogramPanel.tsx` and `ViewerScaffold.tsx` are both deleted — Sv had already
  gone, so the scaffold had no other consumer. "Echogram" still appears as a
  *pipeline stage* name in `toolCatalog.ts`/`pipelineDefinitions.ts`; that is a
  different thing and was left alone.
- **Right window:** Metadata (auto-populates from NCEI file click) · Configuration ·
  Calibration · Processing Queue. Properties REMOVED. **Its tab strip is hidden too** — the
  right icon strip replaces it, same mechanism as the left. Configuration auto-fronts when a pipeline card is focused
  (DockLayout subscribes to the pipelines store and calls layout `openPanel('configuration')`).
- **Bottom (tools):** Terminal · Log · Progress · Console · Map. **Its tab strip is hidden too**
  — a horizontal icon strip along the foot of the dock area replaces it, same mechanism as the
  two sides, which is what lets clicking an icon collapse the whole dock without hiding the
  only control that could bring it back. Map (MapPanel.tsx) plots the in-view
  NCEI file positions as dots + a chronological track line, highlighting the identified file;
  fitted cos-lat projection + graticule. Coords come from the mapTrack store
  (state/mapTrack.ts), published by useNceiSearch — today they are MOCK positions on each file
  (RawFile.lat/lon, filled by the mock generator's per-survey random walk; apiNceiSource omits them).
- BuiltinPanelId union: pipelines, recipes, editor, ncei, files, derived, omao, metadata,
  configuration, calibration, processingQueue, terminal, log, progress, console, map.
  (`'echogram'` and `'workspace'` removed; `'files'` and `'editor'` added. Keep this union in
  step with the registry — `PanelId` has a `(string & {})` escape hatch, so a typo'd id passes
  `tsc` silently.)
- **`PanelDefinition.dynamic`** (new): marks a panel that is a *template*, opened
  programmatically many times with different params. Only `editor` uses it. Dynamic panels are
  registered as Dockview components but excluded from the Window menu, the default layout, and
  the activity bar — "open an editor" isn't a thing to pick from a list, you open a *file*.
- NCEI file rows use pl:1.25 / pr:1 (they were flush against the panel edge).
- **Terminal defaults 260px (horizontal) / 280px (vertical).** Raised from 200/220 because the
  first thing anyone did on opening the app was drag it taller.
- **LAYOUT_VERSION is 15.** Bumped from 14 for the Recipes tab — a panel added to the default
  layout in both builders, i.e. exactly the structural change the rule exists for.
- **LAYOUT_VERSION 14 note.** Bumped from 13 for the terminal heights — a *size* change, which the
  "bump for structure, not chrome" rule would normally leave alone. Deliberate exception: a new
  default that only a persisted-layout-free install ever sees is not a new default. The cost is
  that one reload discards saved arrangements; Reset Layout was the alternative and would have
  required every existing user to know to run it.
- **LAYOUT_VERSION 13 note.** Bumped from 12 when the vertical layout changed shape (regions
  moved, so a persisted v12 record would restore the old portrait stack). A persisted older layout
  references a panel that no longer exists, so it is discarded and rebuilt. (It was
  deliberately *not* bumped for the hidden sidebar tabs or the vertical layout — neither
  added, removed, or moved a panel. Bump for structure, not for chrome.)

## Two layouts — WIRED (View ▸ Horizontal / Vertical Layout)
`defaultLayout.ts` exports `buildHorizontalLayout` (the default), `buildVerticalLayout`, and
`buildLayout(api, variant)`, with a tick on whichever is in force (`MenuBar` compares
`item.layoutVariant` to the controller's `layoutVariant`).

```
HORIZONTAL                              VERTICAL
┌──┬──────┬──────────┬──────┬──┐        ┌──┬──────┬──────────┬──────┬──┐
│A │SOURCE│  CENTER  │INSPEC│I │        │A │SOURCE│  CENTER  │INSPEC│I │
│  │      ├──────────┤      │  │        │  ├──────┴──────────┴──────┤  │
│  │      │  TOOLS   │      │  │        │  │      TOOLS (full)      │  │
└──┴──────┴──────────┴──────┴──┘        └──┴────────────────────────┴──┘
   └── bottom strip ──┘                    └──── bottom strip ─────┘
```
- **The two are identical but for the width of the tools dock**, and the only thing producing
  that difference is the *order* regions are added in. Dockview's grid is nested splits and
  `direction: 'below'` splits the cell holding the referenced panel: add the tools dock after
  the sides and it lands under the centre column alone; add it first, while the centre still
  owns the whole grid, and it splits the root and spans everything the sides are later carved
  out of. Same panels, same anchors, same sizes — one reordering. `layouts.test.ts` asserts
  that ordering in both directions, because it is invisible in the finished grid.
- **Anchor the tools dock to `pipelines`, never to a side dock.** Anchoring it to a side would
  split that dock instead of the root — the same bug as adding it too late. Tested.
- Vertical is what a terminal wants: a shell, a log and a map are read in long lines, and
  under the centre column alone each reads through a slot a third of the monitor wide while
  two file trees sit either side with width they aren't using.
- **This replaced a portrait band-stack** (four full-width regions, nothing split sideways,
  aimed at a ~1080px-wide monitor turned on its end). No arrangement targets that shape now;
  if a portrait monitor turns up, a third `build*Layout` is the answer, not a change to these.
  Adding one means a new builder + a `LayoutVariant` member + one menu entry. Nothing else
  knows layouts have variants.
- **Switching is a full teardown** (`api.clear()` + rebuild) — Dockview has no re-flow. **Open
  files are carried across**: paths are captured first, `rebuildingRef` suppresses the
  panel-removal cleanup so no buffer is dropped, and the tabs are re-added after.
- `PersistedLayout.variant` records the choice so **Reset Layout rebuilds the one you chose**.
  Records written before this existed are read as `'horizontal'`.
- The menu labels dropped the word "Monitor" when the portrait layout went: neither
  arrangement describes a monitor shape any more.

## Themes — WIRED (View ▸ Dark / Light / NOAA / Spring)
Dark is the default and the fallback. `state/theme.ts` (module store, localStorage-backed)
holds the mode; `MenuBar` ticks it with the same machinery as the layout variants.

- **Four palettes, one theme definition.** `theme/tokens.ts` holds `dark`, `light`, `noaa` and
  `spring`; `createAppTheme(mode)` binds `color`/`font`/`radius` to one of them and every MUI
  component override is written against those names. There is no second theme to keep in step
  and no component that knows which mode it is in.
- **Adding a palette is one object.** `palettes` is now `Record<ThemeMode, PaletteDefinition>`
  = `{id, label, base, tokens}`, and `paletteList` drives the View menu — `menuConfig.tsx`
  maps over it the same way the Window menu maps over the panel registry. A palette that
  exists but cannot be selected, or a menu entry naming a palette that was deleted, are both
  unrepresentable.
- **`base` is the load-bearing field.** Three things outside our own CSS understand only the
  words *light* and *dark*: MUI's `palette.mode`, the CSS `color-scheme` property (native
  scrollbars, select dropdowns, caret) and Dockview's base class. All three used to
  interpolate the mode id directly, which for a fourth palette would have produced
  `dockview-theme-noaa` (matches nothing) and `color-scheme: noaa` (silently discarded).
  Each palette declares its base and all three ask `baseFor(mode)`. **A new palette must
  declare one** — the `Record<ThemeMode, …>` makes forgetting a type error.
- **The persisted mode is validated, not compared.** `load()` narrows through `isThemeMode`
  against the registry, so a stored id from another build falls back to dark instead of
  throwing on the first token read. LAYOUT_VERSION is unrelated and was not bumped: themes
  touch no panel and the theme key (`aa-si.theme-mode`) is its own thing.
- **NOAA** is dark-based with navy neutrals instead of slate. Both emblem colours appear
  literally — Pantone 287 (`#003087`) as the fronted tab, Process Blue's hue as the accent —
  but the accent is lightened to `#29a0e0` because `#0085CA` carries only 3.7:1 on these
  panels. Same substitution the light palette makes for `#4d8df0`.
- **Spring** is light-based. Green and yellow get different jobs, because any yellow legible
  as text on white has stopped being yellow: green carries the accent, and yellow tints the
  whole neutral ramp and takes the `string` slot in the editor.
- **`AaTokens` is `Widen<typeof dark>`.** `as const` on the reference palette is what makes
  the shape exact (a palette that forgets or invents a token is a type error); the `Widen`
  mapped type is what stops it also demanding the dark palette's literal *values*.
- **Light is not an inversion.** In dark, chrome is darkest and panels lift toward the viewer;
  lightening that naively makes chrome the brightest thing on screen. Light runs the layers the
  other way — chrome greyest, panel bodies white — keeping the rule underneath. The accent
  changes hex for contrast (`#4d8df0` is ~2.4:1 on white, so `#1d64cd` at the same hue).
- **The seam is CSS custom properties.** `global.css` and `dockview-overrides.css` can't import
  TS, so they used to repeat hex values behind a "keep these in sync" comment — the same
  duplication that let three dead Dockview selectors survive. They now name `var(--aa-*)`, and
  `theme/cssVariables.ts` writes those onto `document.documentElement` on every mode change.
  The flattening is generic (`color.bg.tabActive` → `--aa-bg-tab-active`), so a new token is
  exposed to CSS with no second edit.
- **Dockview is never told anything.** Its `--dv-*` variables are declared in terms of ours, so
  the docking surface repaints without a rebuild and open panels, tab strips, sashes and
  scroll positions all survive the switch. Only the base class swaps
  (`dockview-theme-dark|light`), for the defaults we don't override.
- `document.documentElement.style.colorScheme` is set too — without it a light theme still gets
  dark native select dropdowns and a dark scrollbar gutter.
- **Anything drawing outside MUI must be handed the palette explicitly.** The terminal is a
  canvas, so no context reaches it: it built its xterm colours from the static `tokens` export
  (which is *dark*, always) and rendered near-white text on a white panel in light mode. It now
  takes `theme.aa` and repaints in place via `term.options.theme` — session, scrollback and
  cursor survive the switch. `color.terminalAnsi` carries the two ANSI slots (`white`,
  `brightWhite`) whose xterm defaults assume a dark background. **If another canvas/WebGL
  surface is ever added, it has the same problem.**
- **Contrast is now measured, not reasoned about** (`tests/theme.test.ts`, 37 assertions over
  all four palettes): text ramp, accent, syntax, status and the two terminal ANSI slots, each
  against panel/editor/base. Thresholds are calibrated to what dark and light already shipped
  rather than to the WCAG number for every rôle — `comment` and `disabled` are deliberately
  quiet in every palette here (dark's comment is 2.9:1), so holding them to 4.5 would be a
  different design, not a stricter test. The suite caught a real miss: spring's accent cleared
  4.5:1 on white and 4.34:1 on the tinted strips.
- **Still not seen in a browser.** Measured contrast is not the same as looking right. Nothing
  here has read syntax colours against a white editor, and the two new palettes have never
  been rendered at all.

## NOAA mark — WIRED (top-left + favicon)
`components/branding/NoaaMark.tsx` replaced the "AA-SI" wordmark in the menu bar. Circle, gull,
wave: original geometry at the same stroke weight as the outlined icon set, not a reproduction
of the agency seal. It draws in `currentColor`, so it needs no per-theme variant and inherits
hover/disabled states. The name it replaced lives on the tooltip and the `aria-label`.
`public/favicon.svg` repeats the geometry — a static file can't import a component, so a change
to the shape belongs in both — and follows `prefers-color-scheme`, since the browser paints the
tab outside the page and cannot see the in-app toggle.


## File editor — WIRED (center tabs)
Click a file in the Files panel and it opens as a tab in the center, beside Workspace and
Pipelines. `components/panels/editor/` + `state/editors.ts` + backend read/write/create routes.

**Module map** (`components/panels/editor/`, all pure except the two components):
- `paths.ts` — basename/dirname/extname/ellipsizePath. POSIX display helpers only.
- `language.ts` — `languageFor(path)`, `documentViewFor(kind,path)` → text|notebook|image|
  unsupported, `isOpenable()`, `unsupportedReason()`. **This is the routing table**; change
  what opens how by editing it, not a component.
- `highlight.ts` — a small regex tokenizer, one rule list per language.
- `notebook.ts` — nbformat parse/edit/serialize, pure.
- `CodeEditor.tsx` — the text surface.
- `NotebookEditor.tsx` — the cell surface.
- `EditorPanel.tsx` — header + routing between the three surfaces.
- `panelIds.ts` — `editor:{path}` id scheme, both directions.

**Decisions that are load-bearing:**
- **No CodeMirror/Monaco.** A transparent `<textarea>` sits on top of a highlighted `<pre>`,
  sharing one set of font metrics (FONT_SIZE 12.5 / LINE_HEIGHT 19 — changing one without the
  others is what breaks caret alignment). The browser keeps caret, selection, IME, undo and
  a11y; the layer below only paints. Cost: **~31 kB** of bundle. Monaco would have been ~10x.
  **The highlighter must never add or remove a character** — there is a test for exactly this.
- **`highlight()` output goes through `dangerouslySetInnerHTML`.** Every emitted token is
  HTML-escaped. `tests/highlight.test.ts` asserts that *every* `<` in the output opens one of
  the highlighter's own spans, across all seven languages and five hostile inputs. If you touch
  that file, run the tests.
- **Wrapping is off, deliberately.** Soft wrap makes the gutter lie about line numbers, and a
  fixed-width data file has to keep its columns.
- **Buffers live in the store, not the component.** Dockview unmounts and remounts a panel when
  it is dragged between groups; a buffer in component state would be lost. `EditorPanel` owns
  no content.
- **`.raw`/`.nc`/`.zarr` select but do not open.** A text view of a 2 GB echosounder file can
  say nothing true, and a tab explaining that on every click is worse than no tab.
- **Notebooks do not execute.** No kernel, and the Run affordance is *absent* rather than
  greyed out — a disabled button reads as "not yet", and this one isn't coming. Outputs are
  whatever Jupyter last wrote, shown read-only, preserved byte-for-byte on save.
- **Notebook saves keep everything they don't understand.** Each cell retains its original raw
  object and edits are written over it; unknown metadata survives. Serialization matches
  Jupyter's own one-space indent + trailing newline so a save isn't a whole-file diff.
- **Closing a dirty tab keeps the buffer.** Dockview reports `onDidRemovePanel` *after* the
  fact, so a close cannot be vetoed; discarding would be silent data loss. Clean docs are
  dropped, dirty ones are kept and counted in the status bar (click it to reopen). A
  `beforeunload` guard covers the browser tab itself.

**Saving:** `Ctrl+S` in the editor, `Ctrl+S` anywhere (AppShell global handler, which also
stops the browser's own save-page dialog), or File ▸ Save (`ShellActionId 'save-active-file'`).
All three route to `saveActiveDoc()`, which uses `state.focusedPath` — published by
`EditorPanel` from `api.onDidActiveChange`.

**Backend** (`api/files.py`, same `/api/fs` router as the browser):
- `GET /api/fs/read?path=` → `FsDocument`. Binary and oversized files return **200 with a
  `detail`** rather than an error, because the panel needs something to render. NUL-byte +
  UTF-8 detection for binary; `MAX_TEXT_BYTES` 2 MB, truncation blocks saving; `readOnly`
  from `os.access`.
- `GET /api/fs/raw?path=` → FileResponse for `<img src>`. `MAX_RAW_BYTES` 32 MB, 413 over.
- `POST /api/fs/write` → atomic (tempfile + `os.replace`), preserves mode, **refuses to
  create** (404 if missing) so a typo'd path can't silently make a new file.
- `POST /api/fs/create` → kinds text/python/notebook/markdown/folder via `NEW_FILE_SUFFIX`.
  Refuses overwrite (409), rejects slashes and `..` in the name (400), and **re-resolves
  through the parent** so a symlinked folder can't escape the root.
- `new_notebook_source()` emits valid nbformat 4.5 (per-cell `id` is required at 4.5).
- `AASI_FS_READONLY=true` removes the write half entirely (405 on write/create).
- The existing loopback guard (`AASI_ALLOW_REMOTE_FS`) covers every new route — tested.

## Icon strips on three edges — WIRED (JupyterLab-style)
`components/layout/SideBar.tsx`, one component rendered twice:
`<SideBar side="left" />` and `<SideBar side="right" />`, mounted in AppShell **beside**
DockLayout so they are shell chrome and can never be dragged away or docked somewhere
surprising. `components/layout/sidebarChrome.ts` decides which dock groups they replace.

- **Both side docks render without a tab strip.** `dockSideOfGroup` finds a group whose panels
  are *all* in one docked region; `syncSidebarChrome` then hides its header
  (`group.header.hidden = true`) and locks it against drops. Dockview serializes both flags
  (`hideHeader`, `locked`), so it survives save/restore, and it is re-applied on every
  `onDidLayoutChange` because re-opening a closed panel can build a brand-new group.
- **The "every, not any" rule is the whole safety property.** A group is chrome-less only if
  *all* its panels share one docked region. Flip it to "any" and the centre group loses its
  tabs — which is where every open file lives, so there would be no way to switch between
  them. Tested in `sidebar.test.ts`; a mixed group keeps its tabs so a dragged-in panel stays
  reachable, and a group that stops being pure gets its header back.
- **Locking is a consequence, not a preference.** With no header there is nothing to drag
  *out*, so a panel dragged *in* would become invisible with no tab to show it and no close
  button to undo it. Locking removes the trap rather than documenting it.
- **Everything is generated from the panel registry by `region`.** Registering a panel on
  either edge puts an icon on that strip with no further wiring. Left: NCEI · Files · Derived
  · OMAO. Right: Metadata · Configuration · Calibration · Processing Queue. (The user named
  three of the four right-hand panels; Calibration was included because hiding the tab strip
  without giving it an icon would have left it reachable only from the Window menu.)
- **These icons are each dock's only label**, so the active state carries three cues: accent
  hairline against the *outer* edge (the two strips mirror rather than both pointing left),
  tinted background (`bg.selected`), and full-strength icon colour against muted neighbours.
  Names live in the tooltip, which is also the `aria-label`. Tooltips open outward.
- **`pt: 0`.** The first icon is flush with the top of the dock beside it — possible only
  because the toolbar strip is gone.
- **Collapse is `group.api.setVisible(false)`, not a resize to zero.** Dockview removes a
  hidden view from the grid, gives its space to the neighbours, and remembers its size for the
  return trip. The old implementation drove the width to 0 while lifting the minimum-width
  constraint, which meant fighting the grid's own clamps — a dock could end up stuck narrow
  and half-drawn, and because "collapsed" was then *inferred from geometry*, the state machine
  couldn't tell that had happened and refused to expand again. Visibility is a boolean; there
  is no threshold to land on the wrong side of, and it works identically in both monitor
  layouts with no axis detection.
- **Repeat clicks inside `DOUBLE_CLICK_MS` (350ms) on the same icon count once.** A
  double-click is two click events, and left alone the second undoes the first — so a user
  double-clicking to close a dock saw it flash and stay open. Clicking a *different* panel is
  a different intent and stays instant.
- Controller state is per side: `activeDockPanel: Record<DockSide, PanelId | null>`,
  `dockCollapsed: Record<DockSide, boolean>`, and one `toggleDockPanel(id)` that reads the
  side from the panel's registered region. There is no left-specific or right-specific code
  path — that is what keeps the two strips behaving identically.
- **LAYOUT_VERSION was not bumped for this.** No panel was added, removed, or moved; only
  chrome changed, and `syncSidebarChrome` runs on load so saved layouts self-heal.
- **Consequence to watch:** the icons are now the only label on *both* docks. If "which panel
  am I in?" turns out too subtle, the fix is one line — delete the `header.hidden` assignment
  in `syncSidebarChrome`. Nothing else depends on it.

## No toolbar — the left icon strip holds everything
There is no toolbar strip. It went in two steps, both at the user's request: first the six
placeholder buttons (Open, Save, Refresh, Run, Stop, Settings) were deleted because they had
no `action` and clicked to no effect — a control that does nothing teaches people not to
trust the ones that do. Then the two that remained (environment update, report a problem)
moved into the left icon strip, at which point a 34px empty band was all that was left.

`AppToolbar.tsx`, `toolbarConfig.tsx` and the `size.toolBar` token are all gone. Save and
Open live in the File menu where they are wired; Run and Stop belong to the Pipelines panel
if and when pipelines execute. **A future toolbar button goes in `SideBar.tsx`'s `SHELL_ACTIONS`
list, with its dialog id.**

Removing the strip is also what lets each icon column's first icon sit flush with the top of
the dock beside it — column and panel now share one baseline, which they could not while a
separate bar sat between them.

## Copy absolute path — WIRED (one control, every listing)
`components/panels/CopyPathButton.tsx`. Props: `value`, `label`, `alwaysVisible`, `size`.
- Invisible until row hover or `:focus-visible`, so 200 rows don't become 200 buttons. Rows
  opt in with `'&:hover .aa-copy': { opacity: 1 }`.
- Falls back to `document.execCommand('copy')` when `navigator.clipboard` is unavailable —
  the workstation is often plain-HTTP localhost, which is not a secure context.
- **Each source copies its own kind of absolute address**, which is the point: Files → a
  filesystem path; NCEI → `s3://noaa-wcsd-pds/…` (`nceiS3Uri()`); Derived → the `gs://` URI;
  Metadata → the full S3 URI, not the bucket-relative key it used to show.
- `NCEI_BUCKET`/`nceiKey()`/`nceiS3Uri()` live in `ncei/nceiService.ts` and **mirror `BUCKET`
  in `api/ncei.py`** — same archive, must not drift.

## Creating files — WIRED
`components/dialogs/NewFileDialog.tsx`, registered in the dialog registry as `'new-file'`.
- Two entry points, one implementation: **File ▸ New Text/Python/Notebook/Folder** (menu items
  pass the kind as `dialogPayload`) and the **+** in the Files panel toolbar.
- Creates into `state/fileBrowser.ts`'s `currentDirectory` — whatever folder Files is showing.
  Falls back to the first discovered root if Files was never opened. This is the answer that
  needs no explaining: you make the thing where you're standing.
- **The server appends the extension**, so `analysis` → `analysis.py` and nobody gets
  `analysis.py.py`. A live "Creates: …/name.ext" line shows the result before it happens.
- On success: `refreshFileBrowser(path)` (Files re-reads that folder and selects the new entry)
  then `openFile()`. Creating a notebook you can't see would be a strange kind of success.
- `state/fileBrowser.ts` is the seam between the dialog and the panel: `currentDirectory`,
  a monotonic `refreshToken`, and `revealPath`.

## Pipelines feature (schema-driven — the key design)
`components/panels/pipelines/`: pipelineTypes.ts (schema + helpers) · pipelineDefinitions.ts
(5 seed pipelines modelling aa-fetch/aa-raw/aa-combine/aa-sv/aa-graph/aa-plot/aa-kmeans) ·
ParamControl.tsx · PipelineFlow.tsx · PipelineCard.tsx · PipelineRunControls.tsx ·
PipelinesPanel.tsx · ConfigurationPanel.tsx · **toolCatalog.ts** · **NewPipelineDialog.tsx**.
Store: `state/pipelines.ts` (now holds `state.pipelines`, seeded from pipelineDefinitions;
user-created pipelines are appended, so ALWAYS resolve via `getPipeline(state,id)` — the old
`findPipeline` helper was deleted).
- **ONE SOURCE OF TRUTH**: a `ParamDef.type` drives everything. `ParamControl` maps
  enum→dropdown, number→numeric field, boolean→checkbox, multi→tag select, path→text+browse,
  string→text, file→injectable selector. The SAME schema generates (a) the card's compact
  widget, (b) the full Configuration form, (c) the shell command via `buildCommand()`.
  Add a tool/flag = edit a definition, never a component.
- `ParamDef.primary` = shown on the card widget; the rest only in Configuration.
- `ParamDef.role:'input'` = the param the left-window file selection is INJECTED into
  (read-only + accent-coloured when injected). Injection source = `activeAsset` store
  (NCEI file click) — no manual path entry.
- Store concepts: *selected* (checkboxes, many) vs *active* (focused card, one, drives
  Configuration) vs *draft* (edited values) vs *saved configuration* (named value set).
  Actions: toggleSelected/setActivePipeline/setParam/selectConfig/saveOverwrite/saveAsNew/
  revertDraft/deleteConfig; `isDirty()` compares draft vs current config. Built-in "Default"
  configs are protected: Save on a built-in redirects to Save-as-new.
- `buildCommand()` UNIT-TESTED via tsc→node: injection, empty-param skip, multi join+quote,
  boolean flag-only-if-true, shell quoting, dirty tracking all verified.
- Run controls: staging only (Snackbar), no execution. Run disabled until ≥1 card selected
  AND an input file is injected.
- **Create new pipeline**: dashed "Create new pipeline" card at the end of the list + a "New"
  button in the panel header, both opening `NewPipelineDialog`. The dialog composes a pipeline
  by appending tools from `toolCatalog.ts` (8 templates: aa-fetch/raw/combine/sv/graph/plot/
  kmeans/dbscan), reorder/remove, with a live flow + command preview. `makeStage(template,i)`
  gives stage 0 the injectable input param regardless of which tool it is — UNIT-TESTED.
  `createPipeline()` seeds a Default config so Configuration works immediately.

## Recipes feature — Brett Layman's aa-recipe-manager, integrated as a PEER
Center tab beside Pipelines. `components/panels/recipes/` + `state/recipes.ts` +
`state/configurationFocus.ts` + backend `api/recipes.py`. The two systems answer the same
question — "how do I run a workflow?" — with different primitives, and the integration keeps
the difference visible instead of papering over it:

|                    | Pipelines (this repo)        | Recipes (aa-recipe-manager)      |
|--------------------|------------------------------|----------------------------------|
| source of truth    | TS definitions in the app    | YAML files on disk               |
| unit               | console-tool chain           | declarative DAG of ops           |
| configure          | per-stage flags              | pipeline-level `inputs:` block   |
| compose            | `buildCommand()` → shell     | `aa-recipe <verb> file.yaml`     |
| validation         | the definitions here         | **`aa-recipe dry-run`**          |

- **The Workbench reads recipes; it never rewrites, re-encodes, or re-validates them.**
  Backend `GET /api/recipes` parses each YAML *for display only* (name, description, `inputs:`,
  step list incl. `include:` steps) with `yaml.safe_load`, mirroring only the shape his
  `yaml_reader._flatten_recipe_yaml` accepts. Anything authoritative stays with the `aa-recipe`
  CLI, which the UI invokes — `dry-run` is offered as the first verb precisely because this app
  refuses to be a second validator. Verified against his real example_recipes: all 18 recipes
  parse; the `.config.yaml` beside them is correctly skipped.
- **The CLI is the integration point, not the library.** His README installs into a dedicated
  Conda env (`recipe-manager`); the Workbench runs in `venv313`. `import aa_recipe_manager`
  may therefore fail where `aa-recipe` on a shell's PATH works — so the backend never imports
  it and the frontend hands commands to the terminal.
- **`aa-recipe` is a genuine batch CLI** — click-based, no prompts, meaningful exit codes,
  errors to stderr (verified by installing and running it). **The "never headless" rule that
  protects `aa-get`/`aa-fetch` does NOT apply here.** The terminal handoff is a v1 convenience
  while no job runner exists; this tool is the *first candidate* for the environment.py
  job-runner pattern (TODO below).
- **Discovery:** `AASI_RECIPES_DIR`, else the first existing of
  `~/AA-SI_recipe_manager/example_recipes` (where his README clones it) and `~/recipes`,
  else the **bundled snapshot** (below) so the panel is never empty out of the box. An
  explicit `AASI_RECIPES_DIR` pointing somewhere broken errors loudly rather than quietly
  serving the bundle — silent fallback would hide the misconfiguration (tested).
  Depth ≤ 2, hidden dirs and symlinked dirs skipped, 512 kB/file and 200-recipe caps. The
  filter is `recipe:` mapping + `steps:` list — which excludes the three other YAML species
  that live beside recipes in the wild: per-user `*.config.yaml` run configs, the older
  section-style workshop configs in AA-SI_Full_Pipeline_Example, and his registry spec files
  (`op:` at top level). Broken YAML is listed *with an error* only when its text carries a
  top-level `recipe:` key (the author meant it as a recipe); other broken YAML is not this
  panel's business. Never raises — error payloads like `/api/derived`. Loopback guard:
  `AASI_ALLOW_REMOTE_RECIPES`.
- **Cards** (RecipeCard): the YAML's own name/description/steps. Step chips distinguish op
  steps from `include:` steps (dashed/italic) — an include is a whole sub-recipe folded in and
  his modular examples lean on that. **No checkbox multi-select**: `aa-recipe` takes one
  recipe per invocation, so a multi-run UI would compose commands his CLI doesn't accept.
  **No "Create new recipe" card** where Pipelines has one: authoring his format in a
  half-faithful builder would fork it; Open YAML in the editor is the honest affordance.
- **Configuration** = the recipe's `inputs:` block → form → `--input NAME=VALUE` overrides.
  `--input` is emitted only for values that DIFFER from the recipe's own default (the file
  already carries its defaults; repeating them would claim overrides that didn't happen —
  tested). `dataset`/`echodata` inputs render as a read-only "wired by a parent recipe" row:
  they exist for composition via `input_overrides` and cannot be expressed as `--input`, so
  Run is blocked on sub-recipes with an explanation (Validate/Generate still work). A
  declared default makes an input optional whatever `required` says, mirroring his
  `InputDeclaration.set_required_from_default` (tested both sides).
- **One Configuration tab, two systems behind it.** `state/configurationFocus.ts` holds
  'pipelines' | 'recipes'; **only DockLayout writes it**, from whichever store's active id
  changed last — the chrome knows about both systems, the systems never import each other.
  `ConfigurationPanel` branches on it at the top; everything below the branch is the untouched
  pipeline renderer. RecipesPanel never calls `openPanel` itself.
- **Data seam** mirrors nceiService: `recipesSource` = `apiRecipesSource` when
  `VITE_AASI_USE_API==='true'`, else `mockRecipesSource` whose entries are transcribed (not
  invented) from his real example_recipes, incl. one broken entry to exercise the error card.
  `capabilities.filesOnDisk` gates Run-in-Terminal and Open YAML — mock paths are fictions and
  a button against them would produce an honest-looking error.
- **Bundled snapshot** = `backend/src/aa_si_workbench/builtin_recipes/`: **verbatim copies**
  of his example_recipes @ `60fcb66` (every recipe YAML, `run_gcs.sh`, the
  `*.config.yaml` his CLI auto-discovers beside its recipe, plus `calibration_files/` and
  `line_files/` because the HB1603 recipes' relative-path defaults point at them). His
  LICENSE + NOTICE are copied alongside per Apache-2.0, and the folder README states
  provenance and the rule: **do not edit these files here** — update by re-copying and
  bumping the recorded hash. `raw_file_inputs/` was deliberately excluded: those are
  *outputs* of the recipes' own query/download steps. Shipped as setuptools package-data;
  a built wheel was inspected and carries all 29 files. `RecipesResponse.builtin` flags
  the fallback and the panel labels it "bundled examples". The include graph and the
  cal/line data presence are pinned by `test_recipes.py`.
- **The mock is now GENERATED, not transcribed.** Four bundle files run through the
  backend's own `summarize_recipe` and dumped into `recipeService.ts` (the hand-written
  versions had silently trimmed inputs and steps — processing_lvl_1 has 7 inputs, not 6;
  machine_learning has 8 steps, not 4). The synthetic `broken_example` entry stays so the
  error card is exercised. Regenerate after updating the bundle:
  ```bash
  cd backend && python -c "
  import json
  from aa_si_workbench.api.recipes import builtin_recipes_root, summarize_recipe
  root = builtin_recipes_root()
  for n in ['processing_lvl_1.yaml','hb1603_survey_pipeline_modular.yaml',
            'machine_learning.yaml','visualization.yaml']:
      d = summarize_recipe(root/n, root).model_dump(exclude_none=True)
      d['path'] = f'/home/user/AA-SI_recipe_manager/example_recipes/{n}'
      print(json.dumps(d, indent=2), ',')
  "   # paste into MOCK_RECIPES, keep the broken entry
  ```
- `quote()` moved to `panels/shellQuote.ts` (shared with recipes); `ncei/combineOptions`
  imports + re-exports it, so its callers didn't move.
- Store split follows the systems: `state/recipes.ts` holds only what the *session* adds
  (listing, focus, typed overrides, verb, extra flags). No named saved configurations like
  pipelines has — for recipes the YAML file is the saved configuration, and "saving" means
  editing it, which is the editor's job.
- **Verified**: backend parses all 18 of his real example recipes (run in this sandbox against
  his repo); `aa-recipe --help`/`dry-run`/`schema` exercised against the installed package;
  frontend logic covered in `tests/recipes.test.ts` (18) and backend in `test_recipes.py` (9).
  **Not verified**: the panels have never rendered in a browser (nothing here can), and
  `aa-recipe run` has never been executed end-to-end (his built-in specs need aa-si-utils /
  aa-si-calibration, not installed here).

## Calibration panel (right dock) — SCAFFOLD, content not settled
`components/panels/calibration/{calibrationSchema.ts,CalibrationPanel.tsx}` +
`state/calibration.ts`. Declared with the SAME ParamDef schema and rendered through the shared
`ParamControl`, so changing what appears = edit `calibrationSchema.ts` only. Sections: Source
(from file / sphere cal .xml / manual), Environment (temperature, salinity, pressure, sound
speed, absorption), Transducer (channel, gain, Sa correction, equivalent beam angle, apply-to-
pipelines). These map onto echopype env_params/cal_params for Sv. **User explicitly said they
aren't sure what belongs here yet** — panel shows an honest "starting point / nothing applied
yet" alert. Values are NOT yet passed to aa-sv.

## Environment update (aa-setup) — WIRED end to end
Menu **Tools → Update Python Environment (aa-setup)…**, plus a toolbar button (right end)
and a status-bar indicator. This is the first feature where the browser actually causes the
backend to *execute* something.
- Backend: `backend/src/aa_si_workbench/api/environment.py` — inspection + a single-flight,
  cancellable job runner + routes `GET /api/env`, `GET /api/env/update?since=N`,
  `POST /api/env/update`, `POST /api/env/update/cancel`. Registered in `api/main.py`;
  CORS `allow_methods` widened to GET+POST.
- **Security seam (read before extending):** the client sends an *action id*, never a
  command. argv is built server-side from the `UPDATE_ACTIONS` allow-list and run with
  `shell=False`, `cwd=$HOME`, in its own process group (cancel kills the group so pip dies
  too). `cli.py` now exports `AASI_BIND_HOST`; a non-loopback bind disables the updater
  (403 + explanation in the UI) unless `AASI_ALLOW_REMOTE_UPDATE=true`.
- Default command `aa-setup`, overridable with `AASI_UPDATE_COMMAND` (shlex). argv[0] is
  resolved against `sys.prefix/bin` *before* PATH, so it always updates THIS venv.
- **Polling, not SSE** (`?since=cursor`): a long-lived stream is what proxies buffer, and
  the app is reached through the Cloud Workstation web preview. Server keeps the last 4000
  lines; ANSI stripped and `\r` progress redraws collapsed before buffering.
- Frontend: `services/environmentApi.ts` (typed client) + `state/environment.ts` (module
  store that OWNS the polling loop, so closing the dialog doesn't stop the job) +
  `components/dialogs/EnvironmentDialog.tsx`. Shows venv/python/tool inventory, a warning
  when `sys.prefix` isn't `venv313`, the exact command, live log, and a **version diff**
  (versions snapshotted before the run, re-fetched after success).
- Honest caveat surfaced in the UI: the update rewrites the venv this server runs in →
  restart `aa-workbench` afterwards.
- Docs: `docs/guides/updating-the-environment.md` (incl. the GCPSetup init.sh fallback).

## Feedback / GitHub issues — WIRED (hand-off model)
Menu **Help → Report a Problem… / Suggest an Improvement…** (+ toolbar bug icon).
`components/dialogs/FeedbackDialog.tsx` composes a **prefilled GitHub issue URL** and opens
it in a new tab; the user reviews and submits under their own account. Deliberate: shipping
a GitHub token to every workstation is not acceptable, and NOAA SSO makes it unnecessary.
- **Schema-driven**: `components/dialogs/issueTemplates.ts` mirrors `.github/ISSUE_TEMPLATE/
  *.yml`. Field `id`s ARE the GitHub prefill keys, so they must match the YAML — there is a
  unit test asserting exactly that (it parses the YAML). Add a field = edit both, never the
  dialog.
- Bug form auto-fills an `environment` block (versions + platform + UA only) from
  `/api/env`, shown in an editable field behind a toggle before anything leaves the browser.
- URL length guarded (`MAX_PREFILL_URL_LENGTH` 6000) → falls back to clipboard copy.
- `frontend/src/config/repo.ts` is the ONLY place the org/repo appear
  (`nmfs-ost/AA-SI_Workbench`, overridable via `VITE_AASI_GITHUB_ORG/_REPO`). Security
  vulnerabilities are pointed at the private advisory, not a public issue.

## Terminal — WIRED (real PTY)
Bottom dock. `api/terminal.py` forks a PTY and streams it over `WS /api/terminal/ws`;
the panel is xterm.js. Binary frames are raw PTY bytes both directions, text frames are
JSON control (`{"type":"resize"}`) — using the frame type to split control from data
avoids escaping keystrokes that look like JSON.
- **This is deliberately the OPPOSITE of environment.py.** There the client sends an
  action id and the server builds argv from an allow-list. A terminal *is* arbitrary
  code execution; there is no allow-list to write and filtering keystrokes would be
  theatre. The boundary is the loopback check (`AASI_ALLOW_REMOTE_TERMINAL` to override)
  — verified to refuse the socket when bound to 0.0.0.0.
- **Venv control**: `discover_venvs()` finds `$VIRTUAL_ENV`, `~/venv313`, `.venv`,
  `~/venv*`, plus `AASI_VENV_SEARCH`; reads the version from `pyvenv.cfg` (no subprocess)
  and flags which hold `aa-*` tools. The panel preselects that one. Activation does what
  `activate` does: prepend `bin/`, export `VIRTUAL_ENV`, drop `PYTHONHOME`.
- Session dies with the socket (SIGHUP to the child). `ResizeObserver` drives resize
  because Dockview resizes the panel, not the window.
- **Frame types are load-bearing.** `term.onData` yields a *string*, and `socket.send(str)`
  sends a TEXT frame — which the control channel JSON-parses and (originally) dropped
  silently, so every keystroke vanished and the terminal looked like a dead keyboard. The
  panel now encodes input with `TextEncoder`; the backend additionally treats any text
  frame that isn't valid control JSON as keystrokes. Belt and braces, because the silent
  version was expensive to diagnose.

## Files panel — WIRED (left dock, new tab) — IDE-style tree
`api/files.py` + `components/panels/FilesPanel.tsx`. An explorer tree, not a navigator:
folders expand **in place** so context is never lost, children are fetched lazily on first
expand and cached (a home dir with a season of survey data is far too big to walk eagerly),
and a filter keeps a folder visible when any loaded descendant matches.
- **Clicking a file opens it** in the center editor (see the File editor section). Folders
  toggle. `.raw`/`.nc`/`.zarr` select without opening.
- **Creating is here** (the **+** button and the empty-state link, both opening the New file
  dialog). **Deleting and renaming still are not** — a destructive action one misclick from a
  file listing is a poor trade, and the terminal is right there.
- Publishes its current folder to `state/fileBrowser.ts` so File ▸ New knows where to create;
  honours `revealPath` so a file created elsewhere shows up selected.
- Every row carries the shared `CopyPathButton` (hover-revealed).
- Roots are *discovered*: home, cwd, Downloads, aa-docs, and any `*_NCEI` folder aa-raw
  left in `$HOME`.
- Every path is resolved then confined to `AASI_FS_ROOT` (default `$HOME`) — `..` and
  symlink escapes both return 403 (verified). `AASI_ALLOW_REMOTE_FS` mirrors the other
  loopback guards.
- `.raw`/`.nc`/`.zarr` are tagged server-side so they stand out; a `.zarr` directory is
  reported as one asset, not a folder.
- NOT wired to the `activeAsset` store yet — its `source` field is the literal `'NCEI'`
  and `s3Path` is NCEI-shaped. Widening both is the follow-up that makes a local file
  selectable into Metadata/Echogram.

## Derived assets — WIRED (GCS bucket browser)
`api/derived.py` + `components/panels/DerivedPanel.tsx`. The output side of the workflow:
where NCEI is the read-only source archive, this is the bucket pipelines write products
back to. Default `ggn-nmfs-aa-dev-1-data` in project `ggn-nmfs-aa-dev-1`.
- **Delimiter listing is the whole trick.** GCS has a flat namespace; listing with
  `delimiter="/"` folds it into folders (`iterator.prefixes`) plus objects at that level,
  so each expand is one request and nothing is enumerated until opened. `prefixes` is only
  populated *after* the iterator is consumed — that ordering is load-bearing.
- Zero-byte "directory placeholder" objects (created by the console) are filtered out;
  they'd otherwise appear as a duplicate empty row beside the real folder.
- `AASI_DERIVED_PREFIX` lets a sub-path act as the root. It's stripped from displayed
  paths but kept in the `gs://` URI, because the URI is what a pipeline consumes.
- **`GET /api/derived` never raises.** The panel needs to render a reason, and a 502 would
  leave it with nothing to show. `_explain()` maps the usual GCP failures to something a
  scientist can act on: missing library → the pip command; missing ADC → the gcloud
  command; 403 → which permission; quota → `set-quota-project`.
- Optional dependency: `google-cloud-storage` (declared as the `derived` extra, and
  installed by init.sh). Without it every other panel still works.
- Read-only. No upload or delete — producing derived assets is the pipelines' job, and a
  destructive action one misclick from a listing is a poor trade.
- **NOT verified against the real bucket**: this sandbox has no GCP credentials and no
  network path to Google. The provider logic is covered by 16 unit tests against a stubbed
  storage client (delimiter folding, prefix arithmetic, placeholder filtering, truncation,
  error translation); "do these credentials work" is the only untested part.

## Custom commands in pipelines — the `{input}` token
Two requirements pull against each other: hand-written commands need total freedom (any
tool, any pipe, flags the catalogue never heard of), but the workspace must still swap the
input file underneath them. A **template** reconciles them.
- `COMMAND_OVERRIDE` (`'__command'`) is a reserved param id holding a user-written command
  for a stage. Stored alongside ordinary values, so it persists in saved configurations
  without changing their shape and "reset to defaults" clears it too.
- `INPUT_TOKEN` (`'{input}'`) stands in for the selected file. `buildCommand` substitutes
  it on **every** build, so clicking a different file in the workspace re-targets a
  hand-written command exactly as it re-targets a generated one. This is the property that
  makes the feature safe — there's a test named for it.
- A template with **no** token is left alone. That's correct for a pipe filter reading
  stdin (`grep -v WARNING`), and the editor warns when a file is selected but unused.
- `templateFrom()` seeds the editor with the real generated command, input already
  tokenised, so the placeholder is discovered by example rather than from help text.
  Seeding then building round-trips to the identical command (tested).
- The catalogue offers ONE freeform stage (`tool: 'sh'`, `freeform: true`, no params)
  rather than enumerating tools. There are more `aa-*` tools than the catalogue lists,
  plus the whole Unix toolbox, and listing them would always be out of date.
- Overrides are per stage: editing stage 1 leaves stage 2 generated.

## NCEI actions — two workflows, both handed to the TERMINAL
`ncei/NceiActions.tsx` + `ncei/combineOptions.ts` + `state/terminal.ts`.

**The constraint that shapes this whole feature:** `aa-get` and `aa-fetch` are
*interactive* console UIs. They prompt and expect a human. They CANNOT be driven from a
background job runner the way `aa-setup` can — a runner would hang on the first question
with nobody to answer it. So the Workbench does not try. The panel composes the exact
command, shows it, and types it into the PTY terminal where the user stays in the
conversation. **Do not "improve" this into a headless runner.**
- `state/terminal.ts` is the seam: `sendToTerminal(command)` sets a request with a
  monotonic id; `TerminalPanel` starts a session if none is running, queues the command,
  and writes it on `onopen`. Requests supersede rather than queue — two commands racing
  into one shell would interleave their prompts.
- Two peer workflows in one toggle: **Download files** (`aa-fetch`) and **Combine dataset**
  (`aa-combine`), with an output-format toggle for **.nc vs .zarr**. Changing format
  rewrites the output extension and swaps in the zarr-only options (chunking,
  consolidated metadata).
- Options are declared in `combineOptions.ts` and the form is generated, so adding a flag
  never touches a component.
- **The panel's job is to explain the operation, not to encode flags.** Two things carry
  that: a **format explainer** at the point of choice (single .nc file vs chunked .zarr
  store — what each is good for and what to watch out for, in problem terms rather than
  format terms), and a **step strip** showing the real chain, because "combine" quietly
  implies fetch → convert → combine → upload and that isn't visible from a command line.
  The upload step dims when no destination is set, so the UI never implies work it won't do.
- **FLAG ACCURACY**: only options with `verified: true` came from the existing tool
  catalogue. The rest are grouped into one dashed "Proposed controls" block saying the
  names are unconfirmed — one honest statement beats six warning icons. Run
  `aa-fetch --help` / `aa-combine --help` and fix the `flag` strings in that one file. An
  "Additional flags" field is appended verbatim so an incomplete schema is never a blocker.

## NCEI panel — what it does
Graphical front-end to aa-find + aa-fetch + aa-combine, scoped to NCEI.
Fuzzy drill-down vessel → survey → sonar (searchable dropdowns) → raw file list.
**Datetime range (From/To)** + fuzzy name filter scope the file set (surveys are huge;
combine is driven by the range, not per-file checkboxes). Click a row = identify
(highlights + populates Metadata); checkbox = action-selection. Actions target the
checked subset else the whole filtered set: **Download raw** (aa-fetch) and
**Combine → .nc** (aa-combine, ≥2 files, shows equivalent command). Actions are
PREVIEW-ONLY (stage a job; honest "backend not connected" note). Files: ncei/
{nceiTypes,fuzzy,nceiService,apiNceiSource,useNceiSearch}.ts +
{NceiFilters,NceiResults,NceiActions,NceiPanel}.tsx.

## Verified domain facts (don't re-derive)
- NCEI = **public S3 bucket `noaa-wcsd-pds`**, accessed **anonymously** (`create_s3_objs()`
  in cloud_utils.py uses `signature_version=UNSIGNED`). No creds for browse/listing.
- S3 layout: `data/raw/{ship}/{survey}/{sonar}/{file}`. Raw name convention
  `D{YYYYMMDD}-T{HHMMSS}.raw`. Ship folder e.g. `Reuben_Lasker`; survey e.g. `RL2107`;
  sonar e.g. `EK60/EK80/ME70`.
- aalibrary functions used (ncei_utils.py): `get_all_ship_names_in_ncei(normalize,s3_client,return_full_paths)`,
  `get_all_survey_names_from_a_ship(ship_name,s3_client,...)`,
  `get_all_echosounders_in_a_survey(ship_name,survey_name,s3_client,...)` (filters out
  calibration/metadata/json/doc folders), `get_all_raw_file_names_from_survey(ship_name,
  survey_name,echosounder,s3_resource,...)` (filters `.raw`), `get_file_size_from_s3`,
  `get_folder_size_from_s3`. `create_s3_objs()` returns (client, resource, bucket).
- BigQuery cache (ncei_cache_utils.py): table **`ggn-nmfs-aa-dev-1.metadata.ncei_cache`**,
  columns incl. s3_object_key, ship_name, ship_name_normalized, survey_name,
  echosounder_name, file_name, file_type, file_datetime (and assumed **file_size** —
  CONFIRM the column name). `_cache` fns need a BigQuery client (GCP ADC). `get_dates_of_
  survey_in_ncei_cache` returns per-survey dates.
- GCP: project `ggn-nmfs-aa-dev-1`, data bucket `ggn-nmfs-aa-dev-1-data`. Env
  `AALIBRARY_GCP_PROJECT_ID`, `AALIBRARY_GCP_BUCKET_NAME`.
- Pipeline: `aa-get | aa-fetch | aa-raw/aa-ed | aa-combine | aa-sv | aa-graph/aa-plot`.
  aa-combine: ≥2 files, same sonar_model, chronological (sort by name), optional
  `--channels "GPT 38 kHz,..."`. Output `D{YYYYMMDD}-T{HHMMSS}.nc`.
- Channels ("GPT 38 kHz", EK80→"WBT ...") live INSIDE the raw/converted file config —
  NOT in S3 listing or the cache. So `/api/ncei/channels` returns [] for now.

## Env / config
- Frontend (frontend/.env.example): `VITE_AASI_USE_API=true`, `VITE_AASI_API_BASE`
  (empty=same-origin), `VITE_AASI_API_PROXY` (dev proxy target, default http://localhost:8000).
- Backend (backend/.env.example): `AASI_NCEI_SOURCE=s3|cache`, `AASI_CORS_ORIGINS`,
  `AALIBRARY_GCP_PROJECT_ID`, optional `GOOGLE_APPLICATION_CREDENTIALS`, `AASI_FRONTEND_DIST`.
- Updater: `AASI_UPDATE_COMMAND` (default `aa-setup`), `AASI_EXPECTED_VENV` (default
  `venv313`), `AASI_ENV_WATCH_PACKAGES`, `AASI_ALLOW_REMOTE_UPDATE`, `AASI_BIND_HOST`
  (set by `aa-workbench serve`).
- Terminal: `AASI_TERMINAL_SHELL` (default `$SHELL`), `AASI_VENV_SEARCH` (extra venv
  paths, os.pathsep-separated), `AASI_ALLOW_REMOTE_TERMINAL`.
- Files: `AASI_FS_ROOT` (default `$HOME`; set `/` to browse the whole machine),
  `AASI_ALLOW_REMOTE_FS`, **`AASI_FS_READONLY`** (true → `/api/fs/write` and `/api/fs/create`
  return 405 and the editor renders read-only; reading is unaffected).
- Derived: `AASI_DERIVED_BUCKET` (default `ggn-nmfs-aa-dev-1-data`), `AASI_DERIVED_PREFIX`,
  `AALIBRARY_GCP_PROJECT_ID`.
- Frontend also: `VITE_AASI_GITHUB_ORG` / `VITE_AASI_GITHUB_REPO` (fork overrides).

## Verification status

### Current — re-run these, don't trust this list
Everything below was run from a clean extract, in this order, at the end of the last session.

| Check | Command | Result |
| --- | --- | --- |
| Frontend types | `npm run typecheck` | clean |
| Frontend tests | `npm test` | **140 passed** (8 files) |
| Frontend build | `npm run build` | clean — **1,144.34 kB / 319.22 kB gzip** |
| Backend lint | `ruff check .` | clean |
| Backend tests | `pytest` | **88 passed, 1 skipped** (89 collected) |

- Bundle grew **1,088.95 → 1,121.92 kB** (+33 kB raw, +11 kB gzip) across all the work above,
  nearly all of it the editor; removing the toolbar gave a little back. That number is the
  argument against Monaco — keep an eye on it.
- The skip is `test_files.py:390` — a read-only-file test that cannot mean anything when the
  suite runs as a user whose privileges ignore the write bit (root in a container). It skips
  itself rather than passing vacuously.
- Backend tests by file: `test_files.py` **46**, `test_derived.py` 16,
  `test_environment.py` 15, `test_recipes.py` 11, `test_smoke.py` 1.
- Frontend tests (`frontend/tests/`, Vitest) cover **pure logic only** — no DOM, no jsdom:
  - `highlight.test.ts` (20) — HTML-escaping across 7 languages × 5 hostile inputs, the
    every-`<`-opens-our-own-span invariant, text preservation round-trips, oversized files.
  - `notebook.test.ts` (17) — unknown-metadata preservation, outputs byte-for-byte, double
    round-trip stability, nbformat validity when a cell's type changes, cell operations.
  - `language.test.ts` (21) — path helpers incl. dotfiles and root-level files, language
    lookup, and the open/don't-open routing for the acoustic binaries.
  - `recipes.test.ts` (18) — `buildRecipeCommand` (verbs, default-equal values suppressed,
    quoting, wired inputs never emitted, extra flags), the required/wired input rules, the
    control-kind mapping for every input type his examples use, the focus arbiter, and mock
    fidelity (every mock input renders; one broken entry present; paths declared not-on-disk).
  - `theme.test.ts` (37) — palette registry completeness both directions, every palette
    declaring a light/dark base, token-shape parity against dark, **CSS custom-property
    parity** (a palette emitting a variable another lacks would leave one stale colour behind
    after a switch, since applying a theme writes properties and never removes them), and
    measured contrast per rôle per surface.
  - `sidebar.test.ts` (8) — `dockSideOfGroup`: pure left and right groups, the centre group,
    the bottom dock, mixed groups, empty groups, unknown ids, and an unresolvable lookup.
  - `layouts.test.ts` (13) — both builders against a recording fake `DockviewApi`: the two
    arrangements hold the same panel set, every panel is added once and anchored to something
    already placed, the vertical builder never uses `left`/`right`, band order and sizing axis.
    It can't prove either layout *looks* right — nothing without a browser can.
- `make lint` used to die on its first line (it called `npm run lint`; no such script, and the
  repo has no eslint config). It now runs `npm run typecheck` — strict TS with
  noUnusedLocals/Parameters is the gate this repo actually has. `make test` now runs both
  halves instead of backend only.

### What is still NOT verified
- **Neither icon strip has been seen in a browser**, so the mirrored active marker, the
  outward tooltips, and the right dock's width without its tab strip are all unverified.
- **The dock collapse fix has not been seen in a browser.** `setVisible` is the documented
  primitive and the grid stores the size for the return trip, but the bug it replaces was
  precisely a grid-clamping behaviour that only shows up on screen.
- **Neither monitor layout has been seen on a real screen**, portrait or otherwise. The
  builders are asserted structurally; the band heights (320 / 260 / 240) are judgement, and
  the first thing to check on an actual portrait monitor is whether the sources band is tall
  enough to be worth having.
- **No browser rendering check of the editor.** Caret/highlight alignment, scroll sync, and
  the notebook layout have never been seen by a real engine. The metrics constants are the
  fragile part.
- Live NCEI / BigQuery / the real derived bucket — no `aalibrary`, no echopype, no GCP
  credentials in this sandbox.
- `aa-setup` has never been executed; `aa-seabed` has never been executed (name unconfirmed).
- xterm.js rendering (jsdom has no canvas).

### Earlier sessions (context only — these harnesses do NOT ship)
Prior sessions ran ad-hoc checks that cannot be re-run from the repo: node checks via
tsc→CJS (prefill URLs, environment report, store cursor logic, `buildCommand()` including
the `{input}` file-swap property), jsdom UI drives (Tools menu → env dialog → poll →
completion; feedback prefill; Files panel navigation), and real HTTP/WebSocket drives against
the built dist (SPA fallback, 409 double-start, `/etc` → 403, a PTY echoing a command, the
loopback guard refusing 0.0.0.0). **`buildCommand()` is still asserted by nothing that ships** —
now that Vitest is here, porting those node checks is cheap and worth doing.

## Open items / TODOs
1. **Download/Combine/Upload actions** are preview-only. Wire backend endpoints:
   download = aa-fetch; derived .nc = aa-fetch → aa-raw → aa-combine → GCS upload. Needs
   GCP metadata DB + derived-assets bucket. Real upload dest currently stubbed
   `gs://<derived-assets-bucket>/{survey}/`.
2. **Channels**: surface real channels by reading a representative file's config (echopype).
3. **Cache `file_size` column**: confirm/adjust the SELECT in CacheProvider.
4. ~~`<org>` placeholders → `nmfs-ost`~~ **DONE** (CITATION.cff, CODEOWNERS, pyproject
   Repository, ISSUE_TEMPLATE/config.yml, docs/development/setup.md). The CODEOWNERS *team*
   handles (`@nmfs-ost/aa-si-maintainers|frontend|backend`) are still unverified — GitHub
   silently ignores owners it cannot resolve. Conduct/security contact emails are still
   placeholders.
5. **Node-free deploy**: build UI once → copy `frontend/dist` into
   `backend/src/aa_si_workbench/_frontend/`, ship a wheel (launcher auto-detects it).
6. **OMAO tab**: aa-find has a stubbed OMAO branch; could mirror the NCEI drill-down later.
7. ~~Confirm whether **Recipes** belongs in the left data-source group~~ **RESOLVED** — the
   user decided: Recipes is a *center* tab beside Pipelines, integrating Brett Layman's
   aa-recipe-manager as a distinct peer system. See the Recipes section.
8. **Pipelines are UI-only.** Definitions are seed data in pipelineDefinitions.ts and saved
   configurations live in memory (lost on reload). To make real: serve user-saved pipelines +
   configs from the backend (GET/PUT), and add a run endpoint that executes the composed
   command chain, streaming progress to the Processing Queue / Log panels. `buildCommand()`
   already produces the exact chain to run.
9. **Update job is only visible once something asks for it.** Nothing polls `/api/env` at
   boot (deliberate: the app also runs against mock data with no backend), so after a page
   reload the status bar says "Ready" even if an `aa-setup` run is still going. Opening the
   dialog reattaches correctly. If you want always-accurate chrome, call `syncUpdateJob()`
   once from AppShell and accept one API call per load.
10. **Update output only lives in the dialog.** The Log/Console/Progress panels are the
   natural home for it; the store already holds the lines, so a panel that renders
   `useEnvironment().lines` is small. Same plumbing (`?since=` cursor + job state) is what a
   pipeline-run endpoint will need — reuse it rather than inventing a second mechanism.
11. ~~**Pre-existing ruff debt** / broken `make lint`~~ **DONE / was stale.** `ruff check .`
   is clean under the repo's own config (`E,F,I,W,UP,B` @ 88) and has been for a while — the
   "15 errors" claim was out of date. `make lint` genuinely was broken (it called a frontend
   `lint` script that doesn't exist); it now runs `npm run typecheck`, and `make test` covers
   both halves.
12. **`aa-seabed` is a GUESS.** Every other entry in `toolCatalog.ts` matches a real
   tool; this one was inferred from the naming convention because no seabed tool is
   documented publicly and none exists in the catalog. The card is tagged "unverified
   tool" so it's visible in the UI. Confirm with `ls $VIRTUAL_ENV/bin/aa-*`, then fix the
   `tool` string and flags in `toolCatalog.ts` and `pipelineDefinitions.ts`.
13. **Pipelines still don't run.** The four new cards compose correct commands and are
   fully configurable, but nothing executes them — same gap as the existing five. The
   environment updater's job runner (single-flight, cursor-paged log, cancel) is the
   pattern to reuse rather than inventing a second mechanism.
14. **Files panel → activeAsset.** `AssetMetadata.source` is the literal `'NCEI'` and the
   locator field is `s3Path`. Widen to `'NCEI' | 'local'` and add a generic `path` so a local
   file can drive the Metadata panel, then check MetadataPanel's labels (it now renders a full
   `s3://` URI, which would be wrong for a local file). This is the reason clicking a `.raw`
   in Files still shows nothing anywhere — the editor correctly declines it, and there is no
   other destination for it yet. **Highest-value follow-up in this list.**
15. **Terminal bundle cost.** xterm.js is ~300 kB. `React.lazy` on the terminal panel
   inside the registry would claw it back for users who never open it.
16. **Real GPS on the Map.** The **Map plots MOCK positions** (RawFile.lat/lon filled by the
   mock generator; apiNceiSource omits them). For real GPS: extract position from the
   raw/NetCDF in the backend and return lat/lon on RawFile (backend RawFile schema + both
   providers); MapPanel already fits + plots + highlights the active file. Stores:
   state/{activeAsset,mapTrack}.ts. Panels: MapPanel.tsx.
   *(Echogram and Sv viewers are gone — Sv was removed earlier, Echogram later, and
   `ViewerScaffold.tsx` went with it. If echogram rendering is ever wanted again it is a new
   feature, not a resumed one.)*
17. **The editor has never rendered in a real browser.** Caret-to-highlight alignment depends
   on `CodeEditor.tsx`'s three layers sharing exact font metrics, and jsdom has no layout, so
   nothing here can catch a drift. First thing to eyeball: a Python file with tabs, a long
   line, and a wide unicode character.
18. **No conflict detection on save.** `saveDoc()` guards against a race with *itself*, not
   against the world: if a pipeline or another editor writes the file while it is open, Save
   overwrites it silently. `FsDocument` already carries `modifiedAt` — send it back on write
   and let the server 409 on a mismatch. Same gap in reverse: nothing watches for external
   changes, so an open file can be stale (the Revert button is the manual answer).
19. **Editor scope, deliberately left out.** No find/replace, no go-to-line, no multi-cursor,
   no block indent of a multi-line selection (Tab indents at the caret only), no bracket
   matching. Each is a real request the day someone edits a long file; none is worth a
   megabyte of editor library. Find/replace is the one most likely to be missed first.
20. **Port the old node checks to Vitest.** `buildCommand()` — including the `{input}`
   file-swap property that makes hand-written commands safe — is still asserted only by
   prose in this document. The harness now exists; the tests are a copy-paste away.
21. **`registry.tsx` eagerly imports every panel component.** That single line of coupling is
   behind two separate problems: ~300 kB of xterm in the bundle for users who never open the
   terminal (TODO 15), and any test importing the registry crashing under Node with
   `self is not defined` from `@xterm/addon-fit`'s UMD wrapper. `React.lazy` on the heavy
   panels fixes both at once. Until then, keep pure logic in modules that don't reach the
   registry — `sidebarChrome.ts` is the pattern.
22. **Layout switching drops the *arrangement*, not just the shape.** `applyLayout` rebuilds
   from the template, so any resizing or re-docking the user did is lost — only open files are
   carried across. Remembering per-variant arrangements (two saved layouts instead of one)
   would fix it and is a small change to `PersistedLayout`; nobody has asked yet.
23. ~~**Band heights in the vertical layout are guesses.**~~ **GONE** — the portrait
   band-stack was replaced by a full-width-tools arrangement; there are no bands to size.
24. **Root `package.json` has a broken `lint` script** — `"lint": "cd frontend && npm run lint"`,
   and the frontend has no `lint` script (verified: dev/build/preview/typecheck/test only).
   `make lint` was fixed to call `typecheck`; this one wasn't. One line.
25. **The favicon can't follow the in-app theme toggle.** The browser paints the tab outside
   the page, so `public/favicon.svg` follows `prefers-color-scheme` instead. Regenerating it as
   a data URI on theme change would track the toggle exactly; nobody has asked.
26. **The terminal's ANSI palette is still xterm's**, apart from `white`/`brightWhite`
   (`color.terminalAnsi`). The rest assume a dark background and were left alone because they
   are dark enough to survive both. If coloured output reads badly in a light-based theme,
   that is the place to look.
27. **`NoaaMark.tsx` and `public/favicon.svg` repeat the same path data.** A static favicon
   can't import a component. Both files carry a comment pointing at the other; a change to the
   shape belongs in both.
28. **Run `aa-recipe` through a job runner, not the terminal.** Unlike `aa-fetch`, `aa-recipe`
   is a genuine batch CLI (no prompts, exit codes, stderr) — the terminal handoff is only a
   stopgap while no run endpoint exists. The environment.py pattern (single-flight,
   cursor-paged log, cancel, loopback guard) fits it exactly, and its `[N/M] step ... ok`
   progress lines are ready-made for the Processing Queue / Progress panels. Same mechanism a
   pipeline run endpoint needs (TODO 8/13) — build one, use it for both.
29. **`aa-recipe run` has never been executed end-to-end.** His built-in specs resolve to
   aa-si-utils / aa-si-calibration callables not installed in this sandbox; `dry-run`,
   `--help` and `schema` were exercised against the installed package, `run` was not. First
   real run on the workstation: `aa-recipe dry-run` then `run` on `processing_lvl_1.yaml`.

## Open design questions
Not bugs and not TODOs — places where a reasonable person could pick differently, recorded so
the next session doesn't relitigate them by accident.

- **Should a `.raw` click do *something*?** Right now it selects and nothing else, because the
  editor honestly can't show it and the Metadata panel only speaks NCEI (TODO 14). The options
  are: widen activeAsset so Metadata answers; or show a small "what is this file" summary in
  the editor's unsupported state (size, sonar guess, acquisition time from the filename); or
  leave it. Doing nothing is defensible but currently feels like a dead click.
- **The centre has no home tab.** With Workspace gone, a fresh install opens on Pipelines and
  closing every file leaves Pipelines alone in the centre. That's cleaner than a placeholder
  that says nothing, but it does mean there is no surface for a future viewer (echogram, Sv,
  3-D) to land on — whatever comes next will need to register its own centre panel rather than
  mounting into an existing one.
- **Where do notebooks really belong?** The Workbench edits them but will never run them. If
  scientists want to *run* notebooks the honest answer is JupyterLab, and the Workbench should
  perhaps offer to open the file there rather than growing a kernel.
- **Is the activity bar the right home for anything else?** VS Code puts search and source
  control there. Keeping it to data sources is what makes it legible at a glance; adding a
  second category of thing to it is the decision that would erode that.
- **Calibration content is still unsettled** — the user has said so explicitly. The panel is
  an honest scaffold and the schema is one file; don't invest in it until someone says what
  belongs there.
- **Bundle strategy.** 1.12 MB / 312 kB gzip is fine over a workstation LAN and not fine over
  a hotel wifi. The two obvious wins are `React.lazy` on the terminal (~300 kB of xterm) and
  route-splitting the editor. Neither has been done because neither has been needed yet.

## Deployment: how this repo reaches the workstation
The Workbench runs on a Google Cloud Workstation at `/home/user/AA-SI_Workbench`, installed
into `venv313` by an installer that ends with `aa-workbench build`. That build is `tsc -b &&
vite build`, and **`tsconfig.app.json` includes all of `src`** — so TypeScript checks every
file under `frontend/src` whether or not anything imports it.

**That one fact is behind every deployment failure so far.** A source file deleted in a new
version but left on disk still gets compiled, and if it references an export that no longer
exists, the whole install fails on a file nobody is using.

Three failures, three distinct causes, all worth knowing:

1. **Unzipping over a checkout.** Archives add and overwrite; they never delete. Left a stale
   `AppToolbar.tsx` behind after `size.toolBar` was removed from the theme tokens.
2. **A hand-maintained list of deleted files can't be complete.** `ActivityBar.tsx` was
   *created* in one release and *deleted* in a later one, so it appears in no diff between the
   first release and the last — only on machines that installed something in between.
3. **The stale files got committed.** Applying a release to the git checkout without first
   removing tracked files produced a commit that still contained them, so `git pull` and even
   `git reset --hard` faithfully restored the breakage. If a file survives
   `git reset --hard origin/main` followed by `git clean -fd`, it is *tracked at that commit* —
   that is the whole diagnosis.

**The durable fix is to make the repo the source of truth**, then pull. Git applies deletions;
archives don't. To lay a release into a git checkout so removals register:

```bash
git ls-files -z | xargs -0 rm -f     # drop tracked files; ignored ones (node_modules) stay
unzip -q <release>.zip -d /tmp/wb
cp -R /tmp/wb/AA-SI_Workbench/. .
git add -A && git status             # deletions now show as D
```

To find orphans without a list, compare the tree to a release — see
`docs/development/setup.md` → "Finding orphans". As a checksum, the current release has
**88** `.ts`/`.tsx` files under `frontend/src`.

Files deleted so far, for reference only — **do not treat this as authoritative**, see cause 2:
`AppToolbar.tsx`, `toolbarConfig.tsx`, `ActivityBar.tsx` (all `components/layout/`),
`WorkspacePanel.tsx`, `EchogramPanel.tsx`, `ViewerScaffold.tsx` (all `components/panels/`).

### Launching
`--open` belongs to the `serve` subcommand, not the bare parser:

```bash
aa-workbench serve --open      # NOT `aa-workbench --open` — argparse rejects it
aa-workbench                   # bare = serve on 127.0.0.1:8000, no browser
```
The installer's closing "You're all set" text prints the wrong form; that text lives in the
installer, not this repo.

## Deliverable
`/mnt/user-data/outputs/AA-SI_Workbench.zip` (whole monorepo; node_modules/dist stripped).
Rebuild flow: `cd frontend && npm install` before any build; clean node_modules/dist/
*.tsbuildinfo/__pycache__ before zipping.

## Working notes
Minimal narration during tool calls; concise prose wrap-ups; verify builds before claiming
"runs"; present ZIPs via present_files; honest about what's preview vs wired vs untested.

Comments in this codebase explain **why**, not what — the code already says what. When a
decision looks odd (no Monaco; notebooks that don't run; a tab close that keeps the buffer;
a sidebar that hides rather than resizes), the comment saying why is the thing stopping
someone from "fixing" it. Several of those comments name the bug that the current approach
replaced; don't delete that history.

The user's standing preferences, learned across sessions: intuitive over feature-complete,
never cluttered; remove a control rather than disable it; say plainly what wasn't tested.
When a request would strand something — removing a tab strip from a panel with no icon,
deleting the layout's anchor — handle the consequence and *say so*, rather than shipping the
literal request and letting them find it.
