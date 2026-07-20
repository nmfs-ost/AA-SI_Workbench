# AA-SI Workbench — Backend

The Python package behind the Workbench: the active-acoustics **processing
engine** and the **API service** the frontend calls.

## Stack

- **Python ≥ 3.11**, `src/` layout, packaged with `setuptools` (PEP 621).
- **echopype** / **xarray** / **numpy** for reading and processing water-column
  sonar data.
- **FastAPI** + **uvicorn** for the HTTP API.
- **ruff** (lint/format) and **pytest** (tests).

## Package layout

```
backend/
├── pyproject.toml
├── src/aa_si_workbench/
│   ├── __init__.py
│   ├── api/            HTTP API service (FastAPI) exposed to the frontend
│   ├── processing/     Calibration, gridding, and acoustic metrics
│   ├── io/             Readers/writers for raw + processed data products
│   └── models/         Pydantic schemas shared across API and processing
└── tests/
```

## Development

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
ruff check .
pytest
```

Copy `.env.example` to `.env` and adjust as needed for local runs.
