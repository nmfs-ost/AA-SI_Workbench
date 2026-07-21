# Development setup

## Prerequisites

- Node.js >= 18 (frontend)
- Python >= 3.11 (backend)
- Git

## Clone and install

```bash
git clone https://github.com/nmfs-ost/AA-SI_Workbench.git
cd AA-SI_Workbench
make setup        # installs frontend (npm) and backend (venv + pip) deps
```

## Upgrading an existing checkout

**Extract a new release into a clean directory, or delete `frontend/src` before extracting.**

Unzipping a release *over* an existing checkout adds and overwrites files but never removes
them, so any source file deleted in the new version stays behind. That matters more than it
sounds: `tsconfig.app.json` has `"include": ["src"]`, so TypeScript checks **every** file
under `frontend/src`, reachable from the entry point or not. One orphaned file referencing a
token that no longer exists fails `tsc -b`, which fails `npm run build`, which fails
`aa-workbench build` — and the error names a file you may not even know is still there.

If a build fails on a file you don't recognise, that's the cause. Remove the orphans:

```bash
cd AA-SI_Workbench/frontend
rm -f src/components/layout/AppToolbar.tsx \
      src/components/layout/toolbarConfig.tsx \
      src/components/panels/WorkspacePanel.tsx \
      src/components/panels/EchogramPanel.tsx \
      src/components/panels/ViewerScaffold.tsx
rm -f tsconfig*.tsbuildinfo
npm run build
```

That list is the set of files deleted so far; it will grow. If you're tracking this in git,
`git status` shows orphans as untracked files and the problem doesn't arise in the first
place.

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
