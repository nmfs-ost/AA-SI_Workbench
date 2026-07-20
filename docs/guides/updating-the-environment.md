# Updating the Python environment

The Workbench is an orchestrator: every scientific operation is an `aa-*` console
tool running in a Python virtual environment. On a GCP workstation that
environment is `~/venv313` (Python 3.13), created by
[AA-SI_GCPSetup](https://github.com/nmfs-ost/AA-SI_GCPSetup)'s `init.sh`.

Updating the toolset therefore means reinstalling that environment, which is what
`aa-setup` does. **Tools → Update Python Environment (aa-setup)…** runs it from
the UI and streams the output; the same dialog is on the right-hand end of the
toolbar.

## What the dialog shows

| Section | Meaning |
| --- | --- |
| Virtualenv / Location / Python | The interpreter *this server process* is running in (`sys.prefix`). |
| Warning banner | Appears when that is not `venv313` — updating would rewrite the wrong environment. |
| Command | The exact argv that will be executed. Nothing is hidden. |
| Output | Live stdout+stderr, polled from the server. |
| Installed AA-SI tools | Every `aa-*` console script found, with its distribution and version. |
| Version chips (after a run) | What actually changed, diffed against the versions captured before the run. |

## Running an update

1. Start the Workbench **from the environment you want to update**:

   ```bash
   source ~/venv313/bin/activate
   aa-workbench
   ```

2. Open **Tools → Update Python Environment (aa-setup)…** and press **Run
   update**. The status bar shows the run, so you can close the dialog and keep
   working; reopening it (or clicking the status bar) reattaches to the same job.

3. When it finishes, **restart `aa-workbench`**. The update replaces packages
   underneath the running process — including, potentially, the backend's own
   dependencies — so the server keeps whatever it imported at startup until it is
   restarted.

Cancelling terminates the process group, so `pip` and its children stop too. A
cancelled or failed install can leave the environment half-updated; rerun it.

## If `aa-setup` isn't there

The dialog says so and disables the button. Either the Workbench was started
outside the AA-SI environment (activate it and restart), or the toolset was never
installed on this workstation. In the latter case bootstrap it from a terminal as
per the setup guide:

```bash
cd && \
sudo rm -f init.sh && \
sudo wget https://raw.githubusercontent.com/nmfs-ost/AA-SI_GPCSetup/main/init.sh && \
sudo chmod +x init.sh && \
./init.sh && \
cd ~ && source venv313/bin/activate
```

Then `gcloud auth application-default login` for GCP access. See the
[GCPSetup README](https://github.com/nmfs-ost/AA-SI_GCPSetup) for the current
version of this procedure — it owns that script, not this repo.

## Security model

The updater runs a program with the user's privileges, so it is deliberately
narrow:

- **The browser cannot choose a command.** A request names an *action id*; the
  argv is built on the server from an allow-list (`UPDATE_ACTIONS` in
  `backend/src/aa_si_workbench/api/environment.py`) and executed with
  `shell=False`. Nothing from the request body reaches the argv.
- **Loopback only.** `aa-workbench` publishes its bind host as `AASI_BIND_HOST`.
  If that is not a loopback address the updater refuses to start (HTTP 403) and
  the dialog explains why. Override with `AASI_ALLOW_REMOTE_UPDATE=true` only on
  a host where every user who can reach the port is trusted.
- **One at a time.** A second start returns HTTP 409.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `AASI_UPDATE_COMMAND` | `aa-setup` | The update command (parsed with `shlex`). Point it at a wrapper or add flags. |
| `AASI_EXPECTED_VENV` | `venv313` | The virtualenv name the UI expects; drives the mismatch warning. |
| `AASI_ENV_WATCH_PACKAGES` | `aalibrary,echopype,xarray,numpy,aa-si-workbench` | Distributions to report versions for. |
| `AASI_ALLOW_REMOTE_UPDATE` | unset | Allow updating when bound to a non-loopback address. |
| `AASI_BIND_HOST` | set by `aa-workbench` | The address the server is bound to. |

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/env` | Interpreter, virtualenv, tools, packages, available actions. |
| `GET` | `/api/env/update?since=N` | Job state plus log lines from cursor `N`. |
| `POST` | `/api/env/update` | Start an allow-listed action. 409 if one is running. |
| `POST` | `/api/env/update/cancel` | Terminate the running job's process group. |

Output is buffered server-side (last 4000 lines) and polled with a cursor rather
than streamed, because a long-lived response is the first thing an intermediate
proxy buffers — and this app is normally reached through the Cloud Workstation
web preview.
