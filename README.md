# AA-SI Workbench

**Active Acoustics Strategic Initiative (AA-SI) — Workbench**

The Workbench is the AA-SI toolset in a browser window. You use it to turn a
stretch of an NCEI survey into EchoData, Sv and echograms in your project's
bucket, run the AA-SI console tools (`aa-sv`, `aa-clean`, `aa-mvbs`, `aa-nasc`,
`aa-graph`, …) on those products, and see where each product came from. It
runs on your Google Cloud Workstation, next to your data, and you open it in
your browser.

---

## Start it

This assumes your workstation was set up with the AA-SI setup script, which
installs the AA-SI tools and the Workbench into the `venv313` environment. You
only do steps 1–3 each time you want to use it.

**1. Activate the AA-SI environment** in a terminal on the workstation:

```bash
source ~/venv313/bin/activate
```

**2. Start the Workbench:**

```bash
aa-workbench
```

The first start takes about 20 seconds while it builds the interface; after
that it starts at once. Leave this terminal open: the Workbench runs as long as
it does. (To stop it, press `Ctrl+C` there.)

**3. Open it in your browser.** `aa-workbench` prints the address, like
`https://8000-<your-workstation>.<cluster>.cloudworkstations.dev/`. Open it and
bookmark it. It stays the same every session on this workstation, so next time
the bookmark is all you need after steps 1 and 2.

(Or, in the Google Cloud console: **Cloud Workstations → Workstations**, the
arrow beside **Launch**, **Connect to web app on port**, **8000**. A link that
ends in `?_workstationAccessToken=…` is a one-time sign-in; bookmark the
address without it. **Help ▸ Link to this Workbench…** shows it, and
[docs/guides/stable-address.md](docs/guides/stable-address.md) explains how to
get one address for any workstation or for a whole team.)

## Your first session

1. **Choose your GCP project and bucket.** Click the cloud button at the right
   of the status bar (bottom of the window). The Workbench lists the projects
   and buckets your Google account can use; most people choose
   **ggn-nmfs-aa-prod-1**. It remembers your choice.
2. **Prepare EchoData** (the panel the Workbench opens on): choose a vessel,
   survey and echosounder, then a time range, and press **Prepare EchoData**.
   The raw files are fetched from NCEI, converted, combined, calibrated, and
   saved to your bucket as one EchoData product with its Sv and an echogram.
3. **Run a pipeline on a product.** In the **Products** panel (left), click a
   product. It becomes the input of the **Pipelines** card in the middle. Open
   a pipeline (MVBS, NASC, noise removal, masks, …), check what it will do, and
   press **Run**. The results go into the bucket beside the input, each with its
   product hash, and can be fed to the next pipeline.

The **Terminal** (bottom) is a shell on the workstation in the same environment,
for anything you would rather type.

## What's in the window

| Panel | What it's for |
|---|---|
| **Prepare EchoData** | A survey and time range from a data source (NCEI, OMAO, or an archive you add) → EchoData, Sv and an echogram in the bucket. |
| **Products** | Your project's bucket: every product with its level (L1 EchoData, L2A Sv, L3 MVBS/NASC, …) and its product hash. Select one to run a pipeline on it. |
| **Pipelines** | The AA-SI console tools chained and run on the selected product, with Bash or Python steps of your own between them. |
| **Echogram** | An Sv, MVBS or mask product as an echogram: thresholds, colour schemes (EK500 and Matplotlib's), readout, the ship's track on a map; lines and regions drawn and saved as Echoview files. |
| **Results** | Integration results (NASC by interval and layer, or by region), as a chart and a table. |
| **Storage costs** | What the bucket costs to keep, per month and year, by folder, storage class and product. Products also shows each file's cost a month. |
| **Calibration** | The calibration echopype will use for an EchoData, changed and saved as an ECS file, and Sv computed with it. |
| **Dataflow** | What a product was made from and what was made from it; what is out of date. |
| **Configuration** | The settings of the open pipeline's tools, with each tool's own defaults and help. |
| **Metadata** | How the selected product was made: its tools, settings, inputs and hashes, its file and storage, and the console commands that remake it on any workstation. |
| **Processing Queue** | Every tool the Workbench is running or has run, with its log. |
| **Files** | The workstation's own files. |
| **Terminal** | A shell in the AA-SI environment. |
| **Project** | The AA-SI repositories, documentation, and who you are signed in as. |

## Where your products go

Products are written to the bucket you chose, under
`derived_products/<you>/<vessel>/<survey>/<product>/`. While a run works, its
temporary files are kept in `~/aa-workbench-runs` on the workstation and removed
when it finishes (a Prepare run that fails keeps what it had, so you can see
why). Nothing is written to anyone else's folder.

## Keeping up to date

**Tools → Update Python Environment (aa-setup)…** updates the AA-SI tools in
your environment. To update the Workbench itself, pull the latest version of
this repository and start it again; it rebuilds its interface on its own.

## If something isn't right

- **The browser says the page can't be reached.** The Workbench isn't running,
  or you opened a different port. Check the terminal from step 2 is still
  running, and that you connected to port 8000.
- **Step 2 says the address or port is already in use.** The Workbench is
  probably already running in another terminal; use that one. Or start it on
  another port and connect to that port in step 3: `aa-workbench --port 8001`.
- **"No Google credentials" or the Products panel can't reach the bucket.**
  Sign in for the tools once, then reload the page:
  `gcloud auth application-default login`
- **Faster survey and file lists.** `aa-workbench serve --source cache` reads
  the NCEI file list from the project's BigQuery cache, the same list the
  download uses. It needs the Google sign-in above.
- **Something else.** **Help → Report a Problem…** opens a prefilled issue
  form for this repository.

More detail: [`docs/guides/getting-started.md`](docs/guides/getting-started.md),
[`docs/guides/prepare-echodata.md`](docs/guides/prepare-echodata.md),
[`docs/guides/pipelines.md`](docs/guides/pipelines.md).

---

## For developers

The repository holds the browser interface (`frontend/`: React, TypeScript,
Vite, MUI, Dockview) and the Python service that serves it and runs the tools
(`backend/`: FastAPI). Documentation is in [`docs/`](docs/).

```bash
cd backend && pip install -e ".[dev]"   # in your AA-SI environment
aa-workbench dev                        # interface and service with live reload
pytest                                  # backend tests (from backend/)
cd ../frontend && npm test              # interface tests
```

See [`docs/development/setup.md`](docs/development/setup.md) for the full
walk-through and [`docs/architecture/overview.md`](docs/architecture/overview.md)
for how the pieces fit together.

## Contributing

Contributions are welcome. Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) and
our [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) before opening an issue or pull
request. Security issues should follow [`SECURITY.md`](SECURITY.md) and must not
be reported through public issues.

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

_Maintained by NOAA Fisheries — Active Acoustics Strategic Initiative._
