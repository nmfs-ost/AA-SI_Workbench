# AA-SI Workbench

**Active Acoustics Strategic Initiative (AA-SI) — Workbench**

An open-source scientific workbench for working with active-acoustics
(water-column sonar) data. The Workbench provides a browser-based, IDE-style
workspace for browsing datasets, assembling and running processing workflows,
inspecting metadata, and reviewing results — backed by a Python processing
engine built on the open-source active-acoustics stack.

> **Status:** early development. The application shell (windowing/docking
> framework) and the repository scaffold are in place; scientific features are
> being added incrementally.

---

## Repository layout

This is a monorepo. Each top-level component is developed and versioned together
but can be built and deployed independently.

```
AA-SI_Workbench/
├── frontend/     Browser UI — React + TypeScript + Vite + MUI + Dockview
├── backend/      Python package — processing engine + API service
├── docs/         Project, architecture, user, and developer documentation
├── notebooks/    Exploratory / example Jupyter notebooks
├── data/         Local sample & reference data (contents are NOT committed)
├── scripts/      Repository automation and developer helper scripts
└── .github/      Issue/PR templates, CODEOWNERS, and CI workflows
```

See the `README.md` inside each directory for component-specific detail.

## Quick start

Prerequisites: **Node.js ≥ 18** (frontend) and **Python ≥ 3.11** (backend).

```bash
# 1. Install & run the Workbench UI — from the repository root
npm install            # installs the frontend workspace (via postinstall)
npm run dev            # serves the Workbench UI at http://localhost:5173

# 2. Backend (processing engine / API) — in a separate terminal
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest                 # run the test suite
```

A top-level `Makefile` wraps the most common tasks (`make setup`, `make dev`,
`make lint`, `make test`).

## Documentation

Project documentation lives in [`docs/`](docs/). Start with
[`docs/architecture/overview.md`](docs/architecture/overview.md) for the system
design and [`docs/development/setup.md`](docs/development/setup.md) for a full
development environment walk-through.

## Contributing

Contributions are welcome. Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) and
our [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) before opening an issue or pull
request. Security issues should follow [`SECURITY.md`](SECURITY.md) and must not
be reported through public issues.

From inside the running app, **Help → Report a Problem… / Suggest an
Improvement…** opens a prefilled issue form for this repository, and **Tools →
Update Python Environment (aa-setup)…** refreshes the AA-SI toolset in your
virtual environment — see
[`docs/guides/updating-the-environment.md`](docs/guides/updating-the-environment.md).

## Citation

If you use the AA-SI Workbench in your work, please cite it using the metadata in
[`CITATION.cff`](CITATION.cff).

## Disclaimer

This repository is a scientific product and is not official communication of the
National Oceanic and Atmospheric Administration, or the United States Department
of Commerce. All NOAA GitHub project code is provided on an "as is" basis and the
user assumes responsibility for its use. Any claims against the Department of
Commerce or Department of Commerce bureaus stemming from the use of this GitHub
project will be governed by all applicable Federal law. Any reference to specific
commercial products, processes, or services by service mark, trademark,
manufacturer, or otherwise, does not constitute or imply their endorsement,
recommendation or favoring by the Department of Commerce. The Department of
Commerce seal and logo, or the seal and logo of a DOC bureau, shall not be used
in any manner to imply endorsement of any commercial product or activity by DOC
or the United States Government.

## License

Software code created by U.S. Government employees is not subject to copyright in
the United States (17 U.S.C. §105). See [`LICENSE.md`](LICENSE.md) for the full
statement.

---

<!-- TODO: fill in the owning NOAA Fisheries science center / program, the public
     contact email, and the GitHub organization once the repository is homed. -->
_Maintained by NOAA Fisheries — Active Acoustics Strategic Initiative._
