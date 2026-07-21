# AA-SI Workbench — session handoff

Dense state summary for resuming work. **The uploaded source is ground truth** —
re-read the actual files before acting; this repo has drifted from mid-session
assumptions before (e.g. panels removed/moved between turns). Verify, don't assume.

## Read this first
If you are picking this up cold, in order: **this file** → `frontend/src/components/panels/registry.tsx`
(the single frontend extension point) → `backend/src/aa_si_workbench/api/main.py`
(every route). Those three explain the shape of the whole thing.

**Rules that are load-bearing, not style preferences:**
1. The **code is ground truth**. This document drifts; verify with `view`/`grep` before
   editing. Where the two disagree, the code wins and this file is wrong.
2. **Never claim it runs without running it.** `cd frontend && npm install && npm run build`
   for the UI; `ruff check . && pytest` for the backend. Pure logic is unit-tested by
   compiling to CJS and running under node; UI wiring via the jsdom harness. See
   *Verification status* for what each covers and — more usefully — what it does not.
3. **Schema-driven means schema-driven.** Panels come from `panelDefinitions`, dialogs from
   `dialogRegistry`, pipeline params from `pipelineDefinitions`, NCEI options from
   `combineOptions.ts`. Adding a tool, field or panel should touch a *definition*, never a
   component. If you find yourself editing a component to add an option, stop.
4. **Cross-panel state lives in `state/` module stores** (useSyncExternalStore), not React
   context. Existing: `activeAsset`, `calibration`, `dialogs`, `environment`, `terminal`.
5. **Bump `LAYOUT_VERSION`** (`types/layout.ts`) only when the default dock layout changes.
   It is 10. Persisted layouts below the current version are discarded on load, which is
   intended — otherwise a new panel is invisible to existing users.
6. **Chrome is MenuBar → DockLayout → StatusBar.** There is no toolbar; it was removed
   (its six main buttons had no `action` at all, and its two live ones duplicated menu
   entries). `AppToolbar.tsx` and `toolbarConfig.tsx` are deleted — recover from git if a
   toolbar is ever wanted again.
7. **`aa-get` and `aa-fetch` are interactive.** They prompt and expect a human. They cannot
   be driven from a background job runner. The Workbench composes commands and hands them
   to the PTY terminal. Do not "improve" this into a headless runner.
8. **A terminal is arbitrary code execution by design.** Do not filter keystrokes; that is
   theatre. The real boundary is the loopback check in `api/terminal.py`.

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

## Run it
```bash
pip install -e backend      # in the env where aa-find works (needs aalibrary importable)
aa-workbench                # builds UI first run, serves UI+API on :8000
```
Real NCEI data: default `--source s3` (public bucket, NO creds). Faster path:
`--source cache` + `gcloud auth application-default login` (BigQuery on ggn-nmfs-aa-dev-1).

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

## Current layout (defaultLayout.ts, LAYOUT_VERSION = 10)
- **Left window (data sources):** NCEI (real content, active) · Derived (placeholder)
  · OMAO (placeholder). Recipes REMOVED. FileBrowser + WorkflowExplorer previously REMOVED.
- **Center (split vertically):** left-center group [Pipelines + Workspace tabs] · right-center
  group [Echogram]. **Pipelines fronts on load.** Sv panel REMOVED (the aa-sv *pipeline stage*
  remains in pipelineDefinitions — different thing). Echogram/Sv are viewer scaffolds (ViewerScaffold.tsx)
  bound to the active-asset store; live rendering NOT wired.
- **Right window:** Metadata (auto-populates from NCEI file click) · Configuration ·
  Calibration · Processing Queue. Properties REMOVED. Configuration auto-fronts when a pipeline card is focused
  (DockLayout subscribes to the pipelines store and calls layout `openPanel('configuration')`).
- **Bottom:** Terminal · Log · Progress · Console · Map. Map (MapPanel.tsx) plots the in-view
  NCEI file positions as dots + a chronological track line, highlighting the identified file;
  fitted cos-lat projection + graticule. Coords come from the mapTrack store
  (state/mapTrack.ts), published by useNceiSearch — today they are MOCK positions on each file
  (RawFile.lat/lon, filled by the mock generator's per-survey random walk; apiNceiSource omits them).
- BuiltinPanelId union: workspace, pipelines, echogram, ncei, derived, omao, metadata,
  configuration, calibration, processingQueue, terminal, log, progress, console, map.
- NCEI file rows use pl:1.25 / pr:1 (they were flush against the panel edge).
- **LAYOUT_VERSION is 10.** Bumped from 9 when the Files tab joined the left dock group
  (NCEI / Files / Derived / OMAO). Persisted layouts from v9 are discarded on load, which
  is the intended behaviour — otherwise the new tab would be invisible to existing users.

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
and a filter keeps a folder visible when any loaded descendant matches. Read-only by
design: browsing and handing a path to a pipeline is the job; create/delete belongs in the
terminal where the user can see what they're doing.
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

## Dock tabs — icon-only in the left group
`layout/PanelTab.tsx`, wired as Dockview's `defaultTabComponent`.
- Panels whose registry `region` is `'left'` render **their icon alone**, with the name in
  a tooltip. That group is the narrowest column and holds four data sources; text labels
  were eating width that belongs to the file names beneath them.
- Every other region keeps its text. Centre and bottom groups are wide and their panels are
  less visually distinct, so a row of anonymous glyphs there would be a puzzle, not a saving.
- The split is driven by `region` in the registry, so adding a panel never requires editing
  this component — the definition already says where it lives.
- The close control is hover-revealed (a row of icon tabs showing eight crosses at rest is
  noise) but still present and tested, since a custom tab component replaces Dockview's own
  close affordance rather than augmenting it.
- **Constraint**: every `region: 'left'` panel MUST have an `icon` or its tab renders blank.
  There is a test asserting exactly that.

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
  `AASI_ALLOW_REMOTE_FS`.
- Derived: `AASI_DERIVED_BUCKET` (default `ggn-nmfs-aa-dev-1-data`), `AASI_DERIVED_PREFIX`,
  `AALIBRARY_GCP_PROJECT_ID`.
- Frontend also: `VITE_AASI_GITHUB_ORG` / `VITE_AASI_GITHUB_REPO` (fork overrides).

## Verification status
Numbers below are from the most recent run. Earlier per-feature results were removed rather
than kept alongside — a handoff with two contradictory bundle sizes is worse than one with
none. Historical detail lives in the transcripts.

### Latest state (all verified in the same run)
- `cd frontend && npm install && npm run build` — clean. Bundle **1,089 kB (301 kB gzip)**;
  xterm.js is ~300 kB of that and loads for everyone. `React.lazy` on the terminal panel is
  the lever if it matters (TODO 15).
- `ruff check .` clean; **32 backend tests pass**.
- **jsdom, 30 checks**: dock tabs (left icon-only, centre/bottom text, still closable,
  every left panel has an icon); Files tree discovers roots → lists → expands in place → nests
  children → collapses; every pipeline card has an Edit button; the four simple pipelines
  are registered, single-stage and hole-free.
- **Node unit tests, 23 checks** across three suites: command builder (10), format/stage
  guidance content (5), and pipeline command overrides (8) — including the file-swap
  property, which is the one that makes hand-written commands safe.
- **Live HTTP + WebSocket** against the built dist: `/api/fs/list` tags entries and 403s on
  `..`; a PTY session echoed a command back; resize confirmed via `tput lines; tput cols`;
  the loopback guard refused the socket at `0.0.0.0`; `/api/derived` returned its
  actionable "google-cloud-storage isn't installed" message.

### Covered by the suites above, from earlier sessions
Environment updater (16 backend tests: real child processes via a fake `AASI_UPDATE_COMMAND`
— success, non-zero exit, cancel/SIGTERM of the process group, 409 double-start, 400 unknown
action, 403/404 guards, cursor slicing, ANSI cleaning). Feedback dialog (prefill URL
construction, and a test that parses `.github/ISSUE_TEMPLATE/*.yml` to prove field ids match
— rename a field in either place and it fails). SPA fallback and API routing under uvicorn.

### What is NOT verified (and why)
- **The derived bucket has never been listed for real.** No GCP credentials and no network
  path to Google in the build environment. 16 unit tests cover delimiter folding, prefix
  arithmetic, placeholder filtering and every error branch; "do these credentials reach
  this bucket" is untestable from here.
- **xterm.js rendering.** jsdom has no canvas, so the terminal panel is excluded from the
  DOM harness. The PTY, framing and socket URL are all tested; "does it look right" is not.
- **Every `aa-*` tool invocation.** No aalibrary in the build environment. Commands are
  composed and previewed but never executed, so flag correctness rests on the tool
  catalogue — see the accuracy warning in `ncei/combineOptions.ts`.
- **`aa-seabed` has never been run** because it may not exist.

## Open design questions (raised, NOT answered)
These are genuine unknowns about the tools, not missing code. Each needs someone who can
run the console tools and watch what they do — they cannot be resolved by reading source.

1. **Does `aa-combine` fetch and convert on its own?** The NCEI panel's step strip honestly
   shows four steps (fetch → convert → combine → upload), but the command it emits is
   `aa-combine` alone. If the tool doesn't do its own fetching, the UI should emit a
   three-command sequence instead. The mismatch is visible in the UI by design rather than
   hidden.
2. **Does NCEI serve pre-combined Zarr stores?** `.zarr` is currently treated purely as a
   *combine output format*. If the archive also hosts ready-made stores that should be
   downloadable directly, that is a third workflow which does not exist yet.
3. **Does `aa-seabed` exist?** See TODO 12. No seabed tool is in the catalogue and a web
   search found nothing; the name was inferred from the `aa-<product>` convention.
4. **Are the CODEOWNERS teams real?** `@nmfs-ost/aa-si-{maintainers,frontend,backend}` were
   written in but never verified. GitHub silently ignores owners it cannot resolve, so a
   wrong team looks identical to a working one until a PR gets no reviewer.

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
11. **Pre-existing ruff debt**: `ruff check backend` reports 15 errors in ncei.py/cli.py/
   main.py (line length, `datetime.timezone.utc`→`UTC`, one unused import, one `raise…from`).
   Untouched deliberately; `make lint` also references a frontend `lint` script that
   package.json doesn't define.
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
   locator field is `s3Path`. Widen to `'NCEI' | 'local'` and add a generic `path` to let
   a local file drive Metadata/Echogram, then check MetadataPanel's labels.
15. **Terminal bundle cost.** xterm.js is ~300 kB. `React.lazy` on the terminal panel
   inside the registry would claw it back for users who never open it.
16. **Center viewers + real GPS.** Echogram/Sv need real rendering. The **Map now plots MOCK
   positions** (RawFile.lat/lon filled by the mock generator; apiNceiSource omits them). For real
   GPS: extract position from the raw/NetCDF in the backend and return lat/lon on RawFile (add to
   the backend RawFile schema + both providers); MapPanel already fits + plots + highlights the
   active file. Stores: state/{activeAsset,mapTrack}.ts. Panels:
   {ViewerScaffold,EchogramPanel,SvPanel,MapPanel}.tsx.


## Git / packaging habits (learned the hard way)
The delivery zip **excludes `.git`**. Extracting it over a repo destroys the repo metadata —
this happened three times. Always:

```bash
unzip -oq AA-SI_Workbench.zip -d /tmp/wb
rsync -a --exclude '.git' /tmp/wb/AA-SI_Workbench/ ./
git status --short
```

- **Reconnect a working tree after the remote history was rewritten:**
  `git init -b main; git remote add origin <url>; git fetch origin; git reset origin/main`
  — `reset` without `--hard` adopts the remote history and leaves the working tree alone,
  so `git status` then shows a real diff.
- **`git pull` after a force-push** fails with "divergent branches" or "Not possible to
  fast-forward". That is correct behaviour, not a bug. `git config --global pull.ff only`
  makes it fail with a specific message instead of an ambiguous prompt.
- **Force-push does not erase anything.** Old commits stay reachable via direct URLs and
  the events API until GitHub garbage-collects. If something sensitive was published,
  delete and recreate the repository instead.
- **Never run `git init` in a parent folder of several clones.** Doing so once published a
  personal project (24 files) into this public NOAA repo, plus eight broken gitlinks and a
  committed `.zip`. `*.zip` is now in `.gitignore`; the repo was deleted and recreated.
- `init.sh` belongs to **nmfs-ost/AA-SI_GCPSetup**, not this repo — that is where the setup
  guide fetches it from, alongside `Examples.ipynb` and `region.evr`.

## Shell gotcha worth remembering (cost an afternoon)
A bash function returns the exit code of its **last** command. `init.sh` had:

```bash
_install_workbench() {
    pip install -e "$WORKBENCH_DIR/backend"      # failed
    pip install fastapi uvicorn pydantic boto3   # succeeded
}
```

The failed editable install was masked by the dependency install, so the step printed a
green tick and the failure surfaced three steps later as `ModuleNotFoundError`. Fixed with
`&&`. The same shape appears anywhere a helper runs more than one command.

## Deliverable
`/mnt/user-data/outputs/AA-SI_Workbench.zip` (whole monorepo; node_modules/dist stripped).
Rebuild flow: `cd frontend && npm install` before any build; clean node_modules/dist/
*.tsbuildinfo/__pycache__ before zipping.

## Working notes
Minimal narration during tool calls; concise prose wrap-ups; verify builds before claiming
"runs"; present ZIPs via present_files; honest about what's preview vs wired vs untested.
