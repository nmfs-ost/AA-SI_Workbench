# Development setup

## Prerequisites

- Node.js >= 18 (frontend)
- Python >= 3.11 (backend)
- Git

## Clone and install

```bash
git clone https://github.com/<org>/AA-SI_Workbench.git
cd AA-SI_Workbench
make setup        # installs frontend (npm) and backend (venv + pip) deps
```

## Run

```bash
make dev          # frontend dev server (http://localhost:5173)
# backend API run instructions will be added with the API service
```

## Quality gates

```bash
make lint         # ruff (backend) + eslint (frontend)
make test         # pytest (backend)
make build        # production frontend build
```

See [`CONTRIBUTING.md`](../../CONTRIBUTING.md) for branch naming and the pull
request process.
