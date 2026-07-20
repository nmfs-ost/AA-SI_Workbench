# Architecture overview

The AA-SI Workbench is a monorepo with three logical tiers.

1. **Frontend (`frontend/`)** — a React + TypeScript single-page application. An
   IDE-style *shell* (menu bar, toolbar, status bar, docking surface) hosts a set
   of tool *panels* registered through a central panel registry. Built with Vite,
   Material UI, and Dockview.

2. **API service (`backend/src/aa_si_workbench/api/`)** — a FastAPI application
   that exposes Workbench operations (dataset discovery, workflow execution,
   result retrieval) to the frontend over HTTP.

3. **Processing engine (`backend/src/aa_si_workbench/processing/`, `io/`,
   `models/`)** — Python routines for reading raw water-column sonar data and
   producing calibrated, gridded, analysis-ready products, built on
   echopype/xarray.

```
┌───────────────┐      HTTP      ┌───────────────────────────────┐
│  Frontend UI  │  ───────────▶  │  API service (FastAPI)         │
│  (browser)    │  ◀───────────  │        │                      │
└───────────────┘                │        ▼                      │
                                 │  Processing engine (echopype) │
                                 │        │                      │
                                 │        ▼                      │
                                 │  Data products (xarray/Zarr)  │
                                 └───────────────────────────────┘
```

<!-- TODO: expand with data-flow diagrams, deployment topology (Cloud
     Workstation), and interface contracts as the design solidifies. -->
