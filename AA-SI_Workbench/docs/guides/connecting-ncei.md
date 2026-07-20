# Connecting the NCEI panel to real NCEI data

The NCEI panel talks to a single interface, `NceiCatalogSource`
(`frontend/src/components/panels/ncei/nceiService.ts`). Out of the box it's
backed by mock data; this guide switches it to your real archive via the
backend API in `backend/src/aa_si_workbench/api/`.

```
NCEI panel ─▶ NceiCatalogSource ─┬─ mockNceiSource   (default: sample data)
                                 └─ apiNceiSource ──▶ /api/ncei/* ──▶ FastAPI
                                                                       ├─ S3Provider     (anonymous noaa-wcsd-pds)
                                                                       └─ CacheProvider  (BigQuery ncei_cache)
```

The backend reuses the exact `aalibrary` helpers `aa-find` already uses, so the
Workbench sees identical vessels, surveys, echosounders, and raw files.

## Two data sources

| Source | Env | Needs credentials? | Notes |
| --- | --- | --- | --- |
| **S3** (default) | `AASI_NCEI_SOURCE=s3` | **No** — `create_s3_objs()` lists the public `noaa-wcsd-pds` bucket anonymously (`signature_version=UNSIGNED`) | Real file sizes; acquisition time parsed from the `D…-T…` name. Slower for very large surveys (walks S3). |
| **Cache** | `AASI_NCEI_SOURCE=cache` | **Yes** — GCP application-default creds with BigQuery access | Queries `ggn-nmfs-aa-dev-1.metadata.ncei_cache`. Much faster and carries `file_datetime`. Ideal for the datetime-range combine. |

Start with **S3** (nothing to configure), then move to **cache** for speed.

---

## Step 1 — Backend environment

The providers `import aalibrary`, so run the backend in a Python env where
`aalibrary` is importable — the simplest choice is the **same venv `aa-find`
runs in**. From there:

```bash
cd backend
pip install -e .                 # fastapi, uvicorn, boto3, pydantic + this package
# aalibrary must also be importable here, e.g.:
#   pip install "git+https://github.com/nmfs-ost/AA-SI_aalibrary.git"
```

Copy the example config and adjust if needed:

```bash
cp .env.example .env             # AASI_NCEI_SOURCE defaults to s3
```

## Step 2 — Run and verify the backend

```bash
uvicorn aa_si_workbench.api.main:app --reload --port 8000
```

Verify it independently of the UI (S3 mode needs no credentials):

```bash
curl localhost:8000/health
curl "localhost:8000/api/ncei/vessels"
curl "localhost:8000/api/ncei/surveys?vessel=Reuben_Lasker"
curl "localhost:8000/api/ncei/sonars?vessel=Reuben_Lasker&survey=RL2107"
curl "localhost:8000/api/ncei/files?vessel=Reuben_Lasker&survey=RL2107&sonar=EK60"
```

`vessels` returns `{ id, name }` (id is the exact NCEI folder, e.g.
`Reuben_Lasker`); `files` returns `{ name, sizeBytes, acquiredAt }`. Interactive
docs are at `http://localhost:8000/docs`.

## Step 3 — Point the frontend at the API

```bash
cd frontend
cp .env.example .env.local        # sets VITE_AASI_USE_API=true
```

That flips `nceiSource` from the mock to `apiNceiSource`. The adapter calls
same-origin `/api/...`, which the dev server forwards to the backend (proxy in
`vite.config.ts`, default target `http://localhost:8000`). No CORS needed.

## Step 4 — Run both and check the panel

```bash
# terminal 1
cd backend && uvicorn aa_si_workbench.api.main:app --reload --port 8000
# terminal 2
cd frontend && npm install && npm run dev
```

Open the app, select a vessel → survey → sonar in the **NCEI** tab. The lists,
sizes, and the datetime range now come from the live bucket; clicking a file
still populates Metadata. Errors (e.g. backend down) surface in the panel's
error banner.

---

## Switching to the fast BigQuery cache

```bash
cd backend
pip install -e ".[ncei-cache]"    # google-cloud-bigquery, pandas, db-dtypes
gcloud auth application-default login
export AALIBRARY_GCP_PROJECT_ID=ggn-nmfs-aa-dev-1
export AASI_NCEI_SOURCE=cache
uvicorn aa_si_workbench.api.main:app --reload --port 8000
```

No frontend change is required. One caveat: the file query in `CacheProvider`
assumes an `ncei_cache` column named `file_size`. If your schema names it
differently, adjust the `SELECT` in `backend/src/aa_si_workbench/api/ncei.py`
(the query is parameterized on ship/survey/sonar, so only the column name needs
attention).

## What is not wired yet

- **Channels.** `/api/ncei/channels` returns `[]` (so aa-combine treats it as
  "all channels"). Channel names live in the echosounder config inside each
  file, not in the S3 listing or the cache, so surfacing them means reading a
  representative file's metadata (e.g. via echopype) — a later addition.
- **Download / Combine / Upload actions.** These still stage a preview only.
  Wiring them means backend endpoints that invoke the rest of the pipeline
  (`aa-fetch` for downloads; `aa-fetch → aa-raw → aa-combine` then a GCS upload
  for the derived `.nc`). Those steps need the GCP metadata DB and the
  derived-assets bucket, unlike the anonymous browse above.

## Deploying on the Cloud Workstation

For a single-origin deployment, build the frontend (`npm run build`) and serve
`frontend/dist` behind the same host that proxies `/api` to uvicorn (e.g. nginx,
or FastAPI static files). Then the browser calls one origin and neither the dev
proxy nor CORS is involved. Alternatively set `VITE_AASI_API_BASE` to the
backend's absolute URL and add that origin to `AASI_CORS_ORIGINS`.

## Troubleshooting

- **Panel says it can't reach the API** — backend not running, or the proxy
  target is wrong. Check terminal 1 and `VITE_AASI_API_PROXY`.
- **`API 502: NCEI backend error: No module named 'aalibrary'`** — the backend
  env doesn't have `aalibrary`; install it or use the aa-find venv.
- **Cache mode 502 on BigQuery auth** — run `gcloud auth application-default
  login` and confirm `AALIBRARY_GCP_PROJECT_ID`.
- **Cache mode errors on `file_size`** — adjust the column name in the
  `CacheProvider` query as noted above.
