# Getting started

The Workbench runs from a single console command, `aa-workbench`, which serves
the UI and the API together on one port. No Node, no second terminal, and no
proxy are needed to run it.

## Install (one time)

Install the backend into a Python environment. Use the environment where
`aa-find` already works, so `aalibrary` is importable.

```bash
cd backend
pip install -e .
```

This puts the `aa-workbench` command on your PATH.

> Node.js 18+ is required the first time only, to compile the UI. `aa-workbench`
> does this for you automatically on first launch.

## Run

```bash
aa-workbench
```

The first launch builds the UI (one-time, ~20 s), then serves everything at
**http://127.0.0.1:8000**. Open that URL. Subsequent launches are instant.

Common options:

```bash
aa-workbench --port 9000        # choose the port
aa-workbench --open             # also open a browser
aa-workbench --source cache     # use the fast BigQuery NCEI source (needs GCP)
```

That's the whole thing to teach a new user: install once, run `aa-workbench`,
open the URL.

## NCEI data source

By default the NCEI panel reads the **public** `noaa-wcsd-pds` bucket
anonymously — no credentials. For the faster BigQuery cache (and the datetime
range at full speed), add `--source cache`; that path needs GCP credentials.
See [connecting-ncei.md](./connecting-ncei.md) for the details and trade-offs.

## Keeping the toolset up to date

The Workbench drives the `aa-*` console tools installed in your Python
environment (`venv313` on a workstation). **Tools → Update Python Environment
(aa-setup)…** runs `aa-setup` for you and streams its output; the same dialog
lists every installed tool and its version, and is on the right-hand end of the
toolbar. Restart `aa-workbench` when it finishes. Details and the security model
are in [updating-the-environment.md](./updating-the-environment.md).

Start the Workbench from the environment you want to update — the dialog warns
you if you're not in `venv313`.

## Reporting problems and suggesting improvements

**Help → Report a Problem…** / **Suggest an Improvement…** (also the bug icon on
the toolbar) opens a prefilled GitHub issue form for
[nmfs-ost/AA-SI_Workbench](https://github.com/nmfs-ost/AA-SI_Workbench). Bug
reports can attach your environment details (versions and platform only) — you
see and can edit them first. You review and submit on GitHub under your own
account; the Workbench sends nothing itself. Report security vulnerabilities
privately through the repository's security policy, never as a public issue.

## Developing

For hot reload while working on the code, run both dev servers with one command:

```bash
aa-workbench dev                # UI with HMR + API with --reload
```

Open the printed dev URL (default http://localhost:5173). Ctrl+C stops both.
Rebuild a production bundle at any time with `aa-workbench build`.

## On a Google Cloud Workstation

Run `aa-workbench` on the workstation, then forward the port (default 8000) to
your laptop — one port carries the whole app. Because the UI and API share an
origin, nothing else needs configuring.

## Command summary

| Command | What it does |
| --- | --- |
| `aa-workbench` | Build the UI if needed, then serve UI + API on one port. |
| `aa-workbench serve …` | Same, with `--host/--port/--source/--open/--no-build`. |
| `aa-workbench dev` | Frontend + backend with hot reload (developers). |
| `aa-workbench build` | Compile the frontend for production. |
