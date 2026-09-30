# Prepare EchoData

The baseline operation of the data lifecycle, as one card:

```
NCEI survey ──► time range ──► EchoData (L1) ──► Sv (L2A) ──► project bucket
   source          L0             aa-ed +           aa-sv       gs://…/derived_products/
                (aa-request,      aa-combine      (+ aa-graph)   <you>/<vessel>/<survey>/<asset>/
                 aa-fetch)
```

It is the first icon in the left strip and the panel a fresh layout opens on.
The Data Roadmap levels on the card are the roadmap's own: L0 retrieve, L1
convert to echopype EchoData, L2A calibrate.

## Using it

1. **Source.** Choose the vessel and survey. An echosounder that is the
   survey's only one is chosen for you. The line under the fields says how many
   raw files NCEI lists and the dates they span.
2. **Time range.** The top strip is the whole survey: where the ship was
   logging, and the gaps. Drag across it to choose a range, or drag the
   highlighted range to move it. The strip beneath shows the files around the
   range; drag its handles to adjust. Or type the times (UTC), or take a length
   from the start (1 h, 6 h, 12 h, 24 h, whole survey).
   Underneath: how many files, how much data, what they span, and any gap the
   combine would bridge. You never choose files: the card chooses the files that
   cover the range, including the one holding its first ping.
3. **Products.** EchoData is the asset and always made. Sv and an echogram are
   on by default. `.nc` or `.zarr` for the EchoData.
4. **Destination.** The folder is fixed by rule —
   `derived_products/<your account>/<vessel>/<survey>/<asset name>/` in the
   Workbench bucket (the one the Derived panel shows) — so products are found by
   what they are. The asset name defaults to
   `<survey>_<echosounder>_<from>-<to>`, for example
   `HB1603_EK60_20160703T060000-20160703T120000`. Below it, the folder as it will
   look afterwards.
5. **Prepare EchoData.** One button. It says why when it cannot run yet.

**Advanced settings** holds the few real choices most runs never touch: the gap
rule, strict QC (stop at gaps instead of recording them), the echogram's colour
scale, EK80 calibration modes (shown for EK80 surveys only), another bucket, and
keeping the local working files.

**Console commands** shows the exact `aa-*` commands the run will execute, built
by the same server function that runs them, and copies them as a shell script
that runs on its own.

## While it runs, and after

The run happens on the server, one ordinary job per tool, so it survives
closing the tab (reopen the Workbench and the card re-attaches) and every stage
appears in the Processing Queue with its log. The card shows each stage with its
level and progress ("12 of 24 files"); click a stage for its command and what it
printed.

When it finishes, the new EchoData **becomes the selection**: the Metadata panel
shows its provenance (tools, settings, the raw files it came from, software
versions, and a verified product hash), and the Pipelines panel takes it as
their input. The results list every product with its gs:// address; the folder
icon opens it in the Derived browser. The echogram is shown as a thumbnail.

Running the same range with the same settings again reuses what is already in
the bucket: the stages say *Already in the bucket: reused, not recomputed.* The
raw files are still downloaded and converted locally, because the products'
identity is checked against them.

## What it runs

| Stage | Tool | Level | What |
|---|---|---|---|
| Request | `aa-request` | L0 | The request document: vessel, survey, echosounder, and the file-aligned window (first file's start to last file's start). |
| Fetch | `aa-fetch` | L0 | Downloads those raw files from NCEI into a scratch folder. The card then checks that exactly the planned files arrived; missing files stop the run and are named; extra ones are set aside, not combined. |
| Convert | `aa-ed` | L1 | Each raw file to EchoData. With a single file, it writes the asset directly (there is nothing to combine). |
| Combine | `aa-combine` | L1 | The files, in time order, into one EchoData written to the bucket, with a QC report beside it. |
| Calibrate | `aa-sv` | L2A | Sv beside it, named `<asset>_<recipe8>.nc`. |
| Echogram | `aa-graph` | L2A | A PNG of that Sv, named after it. |
| Record | `aa-upload` | | The request document, kept with the products. |

Scratch space is `~/aa-workbench-runs/<asset>-<run>/` (`AASI_RUN_ROOT`), with
the tools' cache inside it. It is removed after a successful run (unless *Keep
the raw files* is on) and kept after a failure, as evidence.

## Settings

| Variable | Default | |
|---|---|---|
| `AASI_DERIVED_BUCKET` | `ggn-nmfs-aa-dev-1-data` | The bucket the Derived panel shows, and where the card writes. |
| `AASI_BASELINE_BUCKET` | (the Derived bucket) | Write somewhere else than the Derived panel shows. |
| `AASI_RUN_ROOT` | `~/aa-workbench-runs` | Scratch folders. |
| `AASI_PROVENANCE_TIMEOUT` | `120` | Seconds `aa-metadata` may take for the Metadata panel. |

## Requirements

The console tools come from **aalibrary** (Python 3.13), the provenance-aware
release: `aa-workbench check` lists the eight tools the card needs and says
where products will go. If `aa-metadata` is missing, the installed aalibrary is
older than the card, and the card says so rather than failing a run.

The file listing the card plans from is the NCEI panel's (the public S3 archive
by default, `--source cache` for the BigQuery cache); `aa-fetch` downloads by
the BigQuery cache. Serving with `--source cache` makes the two the same list,
so a file the cache does not know can never be promised.

## When something goes wrong

- **"aa-fetch delivered 3 of the 5 files…"** — the BigQuery cache does not list
  them (yet). Use `--source cache` so the card plans from the same list.
- **A gap warning** — the combine bridges it and records it in the QC report.
  Turn on strict QC to refuse instead, or narrow the range.
- **"The Workbench server was restarted…"** — runs are kept in the server's
  memory. Run again: finished products are reused.
- **Anything else** — the error names the stage and quotes the tool. *Jobs and
  logs* opens the Processing Queue with the full output, and the scratch folder
  is kept.
