# AA-SI Workbench — session handoff

Dense state summary for resuming work. **The uploaded source is ground truth** —
re-read the actual files before acting; this repo has drifted from mid-session
assumptions before (e.g. panels removed/moved between turns). Verify, don't assume.

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

## Current layout (defaultLayout.ts, LAYOUT_VERSION = 9)
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

## Verification status
- Frontend `npm run build` (tsc -b && vite build) passes clean (~673 kB bundle, only the
  benign >500 kB chunk warning). Dev server boots (HTTP 200).
- Backend: `py_compile` clean; CLI argparse smoke-tested (bare → serve :8000; subcommands OK).
- **Single-port serve proven via curl**: `/`=UI (correct title), `/assets/*`=200, unknown
  path→index.html (SPA fallback), `/api/ncei/vessels`=502 (reached provider; aalibrary absent
  in sandbox → routing precedence over static mount confirmed), `/health` & `/docs`=200.
- NOT tested against live NCEI/BigQuery (no aalibrary/AWS/GCP in sandbox).

## Open items / TODOs
1. **Download/Combine/Upload actions** are preview-only. Wire backend endpoints:
   download = aa-fetch; derived .nc = aa-fetch → aa-raw → aa-combine → GCS upload. Needs
   GCP metadata DB + derived-assets bucket. Real upload dest currently stubbed
   `gs://<derived-assets-bucket>/{survey}/`.
2. **Channels**: surface real channels by reading a representative file's config (echopype).
3. **Cache `file_size` column**: confirm/adjust the SELECT in CacheProvider.
4. **`<org>` placeholders → `nmfs-ost`** across repo (pyproject Repository URL, README,
   CITATION.cff, CODEOWNERS, dependabot.yml, ISSUE_TEMPLATE/config.yml). Offered, not applied.
   Also conduct/security contact email placeholders.
5. **Node-free deploy**: build UI once → copy `frontend/dist` into
   `backend/src/aa_si_workbench/_frontend/`, ship a wheel (launcher auto-detects it).
6. **OMAO tab**: aa-find has a stubbed OMAO branch; could mirror the NCEI drill-down later.
7. Confirm whether **Recipes** belongs in the left data-source group (user hasn't decided).
8. **Pipelines are UI-only.** Definitions are seed data in pipelineDefinitions.ts and saved
   configurations live in memory (lost on reload). To make real: serve user-saved pipelines +
   configs from the backend (GET/PUT), and add a run endpoint that executes the composed
   command chain, streaming progress to the Processing Queue / Log panels. `buildCommand()`
   already produces the exact chain to run.
9. **Center viewers + real GPS.** Echogram/Sv need real rendering. The **Map now plots MOCK
   positions** (RawFile.lat/lon filled by the mock generator; apiNceiSource omits them). For real
   GPS: extract position from the raw/NetCDF in the backend and return lat/lon on RawFile (add to
   the backend RawFile schema + both providers); MapPanel already fits + plots + highlights the
   active file. Stores: state/{activeAsset,mapTrack}.ts. Panels:
   {ViewerScaffold,EchogramPanel,SvPanel,MapPanel}.tsx.

## Deliverable
`/mnt/user-data/outputs/AA-SI_Workbench.zip` (whole monorepo; node_modules/dist stripped).
Rebuild flow: `cd frontend && npm install` before any build; clean node_modules/dist/
*.tsbuildinfo/__pycache__ before zipping.

## Working notes
Minimal narration during tool calls; concise prose wrap-ups; verify builds before claiming
"runs"; present ZIPs via present_files; honest about what's preview vs wired vs untested.
