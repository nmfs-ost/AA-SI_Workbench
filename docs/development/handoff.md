# AA-SI Workbench — session handoff

Dense state summary for resuming work. **The uploaded source is ground truth** —
re-read the actual files before acting; this repo has drifted from mid-session
assumptions before (e.g. panels removed/moved between turns). Verify, don't assume.

## Read this first
This document is a map, not a substitute for the code. It is written to be read
top-to-bottom once at the start of a session, then used as an index. Two habits
matter more than anything else in it:

1. **Open the file before you change it.** Every section here was true when it
   was written and several have been wrong since.
2. **Run it before you claim it works.** Frontend: `cd frontend && npm install &&
   npm run build && npm test`. Backend: `cd backend && ruff check . && pytest`.
   A section of this document saying something passes is not evidence that it
   still does.

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
   not reach them. Current stores: activeAsset, calibration, dialogs, editors,
   environment, fileBrowser, mapTrack, pipelines, terminal.
5. **Bump `LAYOUT_VERSION`** (`frontend/src/types/layout.ts`) whenever the
   default dock layout changes. A saved layout that references a removed panel
   is how returning users get a broken window.
6. **`aa-get` / `aa-fetch` are interactive.** They are composed and handed to
   the PTY terminal, never driven headlessly. Do not "improve" this.
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

## Current layout (defaultLayout.ts, LAYOUT_VERSION = 12)
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
  Derived · OMAO. Recipes REMOVED. FileBrowser + WorkflowExplorer previously REMOVED.
  **The tab strip is hidden** — the left icon strip is its tab strip. The four
  panels are still one Dockview group, just chrome-less.
- **Center (ONE group):** Pipelines, plus one tab per open file. The center is not split —
  Echogram used to own the right half. Sv panel REMOVED earlier (the aa-sv *pipeline stage*
  remains in pipelineDefinitions — different thing).
- **Workspace REMOVED** (user: "we don't use it"). It was a placeholder showing the app name,
  but it was also the *anchor*: every region was positioned relative to it, `openPanel` and
  `openEditor` fell back to it by id, and `closeable: false` guaranteed it survived Close All
  Panels. **Pipelines is the anchor now**, and — more importantly — nothing assumes an anchor
  exists any more. `openPanel` looks for any centre-region panel and, finding none, adds
  positionless (Dockview gives it a fresh group). That is what makes every panel closeable
  without the shell painting itself into a corner.
- **Echogram REMOVED this session** (user: "in the way, no longer needed").
  `EchogramPanel.tsx` and `ViewerScaffold.tsx` are both deleted — Sv had already
  gone, so the scaffold had no other consumer. "Echogram" still appears as a
  *pipeline stage* name in `toolCatalog.ts`/`pipelineDefinitions.ts`; that is a
  different thing and was left alone.
- **Right window:** Metadata (auto-populates from NCEI file click) · Configuration ·
  Calibration · Processing Queue. Properties REMOVED. **Its tab strip is hidden too** — the
  right icon strip replaces it, same mechanism as the left. Configuration auto-fronts when a pipeline card is focused
  (DockLayout subscribes to the pipelines store and calls layout `openPanel('configuration')`).
- **Bottom:** Terminal · Log · Progress · Console · Map. Map (MapPanel.tsx) plots the in-view
  NCEI file positions as dots + a chronological track line, highlighting the identified file;
  fitted cos-lat projection + graticule. Coords come from the mapTrack store
  (state/mapTrack.ts), published by useNceiSearch — today they are MOCK positions on each file
  (RawFile.lat/lon, filled by the mock generator's per-survey random walk; apiNceiSource omits them).
- BuiltinPanelId union: pipelines, editor, ncei, files, derived, omao, metadata,
  configuration, calibration, processingQueue, terminal, log, progress, console, map.
  (`'echogram'` and `'workspace'` removed; `'files'` and `'editor'` added. Keep this union in
  step with the registry — `PanelId` has a `(string & {})` escape hatch, so a typo'd id passes
  `tsc` silently.)
- **`PanelDefinition.dynamic`** (new): marks a panel that is a *template*, opened
  programmatically many times with different params. Only `editor` uses it. Dynamic panels are
  registered as Dockview components but excluded from the Window menu, the default layout, and
  the activity bar — "open an editor" isn't a thing to pick from a list, you open a *file*.
- NCEI file rows use pl:1.25 / pr:1 (they were flush against the panel edge).
- **LAYOUT_VERSION is 12.** Bumped from 11 when Workspace was removed; a persisted v11 layout
  references a panel that no longer exists, so it is discarded and rebuilt. (It was
  deliberately *not* bumped for the hidden sidebar tabs or the vertical layout — neither
  added, removed, or moved a panel. Bump for structure, not for chrome.)

## File editor — WIRED (center tabs) — the big feature of this session
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

## Icon strips on both edges — WIRED (JupyterLab-style, mirrored)
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
Everything below was run in this session, in this order, from a clean extract.

| Check | Command | Result |
| --- | --- | --- |
| Frontend types | `npm run typecheck` | clean |
| Frontend tests | `npm test` | **79 passed** (5 files) |
| Frontend build | `npm run build` | clean — **1,121.92 kB / 312.38 kB gzip** |
| Backend lint | `ruff check .` | clean |
| Backend tests | `pytest` | **77 passed, 1 skipped** (78 collected) |

- Bundle grew **1,088.95 → 1,121.92 kB** (+33 kB raw, +11 kB gzip), nearly all of it the
  editor; the toolbar's removal gave a little back.
  That number is the argument against Monaco; keep an eye on it.
- The skip is `test_files.py:390` — a read-only-file test that cannot mean anything when the
  suite runs as a user whose privileges ignore the write bit (root in a container). It skips
  itself rather than passing vacuously.
- Backend tests by file: `test_files.py` **46** (new this session), `test_derived.py` 16,
  `test_environment.py` 15, `test_smoke.py` 1.
- Frontend tests (`frontend/tests/`, Vitest) cover **pure logic only** — no DOM, no jsdom:
  - `highlight.test.ts` (20) — HTML-escaping across 7 languages × 5 hostile inputs, the
    every-`<`-opens-our-own-span invariant, text preservation round-trips, oversized files.
  - `notebook.test.ts` (17) — unknown-metadata preservation, outputs byte-for-byte, double
    round-trip stability, nbformat validity when a cell's type changes, cell operations.
  - `language.test.ts` (21) — path helpers incl. dotfiles and root-level files, language
    lookup, and the open/don't-open routing for the acoustic binaries.
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
7. Confirm whether **Recipes** belongs in the left data-source group (user hasn't decided).
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
   *(Echogram and Sv viewers are gone — Sv was removed earlier, Echogram this session, and
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
23. **Band heights in the vertical layout are guesses.** 320 sources / 260 inspector / 240
   tools. On a 1920-tall monitor that leaves ~1050 for the workspace, which felt right on
   paper and has never been checked on glass.

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

## Files deleted so far (orphans to remove when upgrading in place)
Unzipping a release over an existing checkout leaves deleted files behind, and
`tsconfig.app.json` includes all of `src`, so an orphan that references a removed token fails
the build even though nothing imports it. This has already bitten once — a stale
`AppToolbar.tsx` referencing `size.toolBar` after the token was deleted.

```
frontend/src/components/layout/AppToolbar.tsx
frontend/src/components/layout/toolbarConfig.tsx
frontend/src/components/panels/WorkspacePanel.tsx
frontend/src/components/panels/EchogramPanel.tsx
frontend/src/components/panels/ViewerScaffold.tsx
frontend/src/components/layout/ActivityBar.tsx
```

**Add to this list whenever you delete a source file**, and see
`docs/development/setup.md` → "Upgrading an existing checkout".

## Deliverable
`/mnt/user-data/outputs/AA-SI_Workbench.zip` (whole monorepo; node_modules/dist stripped).
Rebuild flow: `cd frontend && npm install` before any build; clean node_modules/dist/
*.tsbuildinfo/__pycache__ before zipping.

## Working notes
Minimal narration during tool calls; concise prose wrap-ups; verify builds before claiming
"runs"; present ZIPs via present_files; honest about what's preview vs wired vs untested.
Comments in this codebase explain **why**, not what — the code already says what. When a
decision looks odd (no Monaco; notebooks that don't run; a close that keeps the buffer), the
comment saying why it is that way is the thing stopping someone from "fixing" it.
