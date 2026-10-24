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

1. **Source.** First where the raw files come from: **NCEI** (the default),
   **OMAO**, or an archive added under **Sources…** (see
   [data-sources.md](data-sources.md)). A source that is not connected yet
   says so, with a link to connect it. Then choose the vessel and survey. An
   echosounder that is the survey's only one is chosen for you. The line under
   the fields says how many raw files the source lists and the dates they span.
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
5. **Working space.** Where the run works on this workstation, and whether the
   range fits there (below). **File by file into the bucket** is the switch for
   long ranges: the workstation then holds one raw file at a time (below).
6. **Prepare EchoData.** One button. It says why when it cannot run yet.

**Advanced settings** holds the few real choices most runs never touch: the gap
rule, strict QC (stop at gaps instead of recording them), the echogram's colour
scale, EK80 calibration modes (shown for EK80 surveys only) and another bucket.

**Console commands** shows the exact `aa-*` commands the run will execute, built
by the same server function that runs them, and copies them as a shell script
that runs on its own.

## Working space: how long a range can be

A run works through a folder on the workstation: the raw files, the per-file
EchoData, and local copies of the combined EchoData and the Sv on their way to
the bucket. With aalibrary's memory fix, aa-combine, aa-sv and aa-graph stream
the range through that folder a slice at a time, so memory stays about 1 GB
whatever the length (the card's *Memory* line says so, or says the installed
tools are older and how much memory they would need). What limits a long range
is the free space under the folder. The step shows:

- **The working folder** (default `~/aa-workbench-runs`, or `AASI_RUN_ROOT`).
  Type another full path to use a bigger disk; it is made when the run starts.
  A folder on the bucket's **gcsfuse mount is refused**, because the tools
  rewrite their files in place, which a bucket mount does only by copying each
  whole file locally first, and a failed run would leave partial files in the
  bucket. A folder **in memory** (tmpfs, such as `/dev/shm`) gets a warning:
  files there take RAM. The products still go to the bucket either way; this
  is only where the work happens.
- **Needs at most / free.** The most space the range holds at once, against the
  free space there. It is an estimate from the raw size (each EchoData is about
  2.2 times the raw size, the Sv about 4.5 times, plus 15%). A range that does
  not fit is refused before anything is downloaded.
- **Free space as it goes** (on by default). Each kind of working file is
  deleted as soon as no later tool reads it: the raw files once converted, the
  per-file EchoData once combined, and the local copy of the EchoData once Sv is
  made. Kept until the end, they add up (about 11 times the raw size, with
  the allowance); freed, the most at once is the EchoData and the Sv together
  (about 7.7 times). The products are unaffected. A run that fails keeps its
  folder, less what was already deleted (so the raw files are gone once
  conversion has succeeded).
  The console commands show each deletion (*then deletes …*), and the copied
  script makes the same ones.
- **Keep the raw files and per-file EchoData.** Keeps the run's folder after a
  success (it is always kept after a failure). Turns freeing off.

While a run goes, the card shows the working space it holds and the most so
far; the finished run notes what it actually used against the estimate.
`aa-workbench check` prints the folder's free space and the memory mode.

### Large raw files: memory

Converting one raw file takes far more memory than the file: echopype parses
its pings and then expands them into rectangular float64 arrays, every ping
padded to the longest. Held in memory, a 1 GB EK80 file needs more than a 7 GB
workstation has, and the system stops the process without an error of its own
(*exit -9*). aalibrary therefore expands any file of **200 MB or more on disk**
instead, a block of pings at a time, in a temporary store inside the run's
working folder that is deleted as soon as the file is written (`aa-ed --swap
on|off` overrides; the values are the same either way).

That caps a conversion at about **3 times the largest file** in memory, and
needs about **2 times the largest file** of extra working space while it runs;
the step counts both (the *Memory* line names the largest file when it sets the
figure). Measured on a 1 GB file: 2.75 GB of memory at most and 2.1 GB of swap,
2½ minutes, to Zarr. With an aalibrary older than this, the step says the
largest file may need about 7 times its size in memory and to update aalibrary.

## File by file into the bucket: ranges longer than the disk

Zarr stores are indexed: each array is its own small objects, with the index
beside them, so a store in the bucket can be read where it is, a slice at a
time, without copying it here. Turned on, **File by file into the bucket**
uses that, and the workstation only orchestrates:

1. There is no fetch stage. One `aa-ed` is given every raw file of the range and
   converts them **one at a time**: each is fetched (downloaded from NCEI, copied
   from a bucket archive, or read where it is in a folder archive), written as its
   **own Zarr store in the bucket**, and deleted here, before the next. Each runs
   in a fresh process, so memory is given back between files.
2. `aa-combine` then reads those stores **where they are** (their provenance from
   the store's own metadata, their data lazily, through a gcsfuse mount or
   gcsfs) and writes the combined EchoData as a store in the bucket, a slice at
   a time. Nothing is copied to the workstation. The QC pass (gaps, overlaps,
   sonar model, channels) runs exactly as before.
3. Sv, if asked for, is made **file by file too** (*Calibrate each file*, right
   after the conversion): one `aa-sv` is given every file's store and
   calibrates them one at a time, each read where it is, its Sv written here,
   uploaded beside its store and deleted here before the next.
4. *Calibrate* then **joins** those, read where they are, into the range's Sv:
   `aa-combine` appends each file's Sv in time order, a chunk at a time, into a
   store written straight to the bucket. `aa-graph` draws the echogram from it
   where it is.

The working folder then holds **one raw file and its store, or one file's Sv, at
a time**, however long the range; memory stays at about 3 times the largest
file while it converts and about 1.3 GB otherwise. Measured on a 1 GB file:
converting 2.8 GB of memory and 4.7 GB of working space; its Sv 0.9 GB and 2
GB; the join and the echogram nothing here. Rehearsed on a 40-hour EK60 range
(24 files, 540 MB raw, against the stand-in bucket): file by file peaked at 72
MB of working space, where the whole range on this disk peaked at 1.9 GB; the
combined store held all 72,000 pings, with the same values. *Free space as it
goes* does not apply (it is how this works); *Keep the raw files* keeps each raw
file in the run's folder, so the folder holds the whole range again.

The range's Sv is a product of its own: each file calibrated, then joined.
For EK60 its values are exactly those of calibrating the combined EchoData. For
EK80, where sound speed and absorption are recorded once per file, each file is
calibrated with its own, while calibrating a combined EchoData interpolates them
between files; they differ only where those values changed between files. The
provenance records which way it was made (`aa-sv ×N → aa-combine`), and its
name carries its own recipe.

Where things go:

- **Per-file stores**: `derived_products/<you>/<vessel>/<survey>/<echosounder>/<raw file>.zarr`
  (the same shape as NCEI's `raw/<ship>/<survey>/<echosounder>/`), and each
  file's Sv beside it, `<raw file>_<recipe>.zarr`, each with a `.aa.json`
  provenance record beside it. They belong to the survey, not to one range: a
  longer range later, or the same range again, reuses every store already there
  (aa-ed finds it from the raw file's MD5, or for NCEI from the recorded NCEI
  object, without downloading anything; aa-sv from the store's own hash). A run
  that stops part-way leaves the files it finished; running again picks up from
  there.
- **The asset**: `<asset>.zarr` in the usual folder (always Zarr: a NetCDF would
  be written here whole before upload), with its QC report; the range's Sv
  `<asset>_<recipe>.zarr` and its echogram `<asset>_<recipe>.png` beside it.
- **Stores made before catch-up 15** went to a `per_file/` folder
  (`<survey>/per_file/<echosounder>/`). The tools no longer look there: move
  them with `scripts/move_per_file_stores.sh` (it lists what it would move and changes
  nothing until run with `--apply`; it copies inside the bucket, checks every
  object and each store's hash arrived, and only then deletes the old copy), or
  they are made again.

`aa-workbench` needs the aalibrary that can do this (`aa-ed` with several files
and `--format zarr`; for Sv, `aa-sv` with several files and `aa-combine`
joining Sv); with an older one the step says to update it (**Tools ▸ Update
Python Environment**). The same chain on the command line (*Console commands*
copies it as a script):

```bash
F=gs://BUCKET/…/HB1603/EK60/
aa-ed RAW1 RAW2 … --format zarr --dest $F --sonar_model EK60 --cleanup-raw --progress
SVFILES=$(aa-sv ${F}RAW1.zarr ${F}RAW2.zarr … --format zarr --dest $F --progress)
aa-combine ${F}RAW1.zarr ${F}RAW2.zarr … -o gs://BUCKET/…/ASSET/ASSET.zarr --sort time --report
SV=$(aa-combine $SVFILES --dest gs://BUCKET/…/ASSET/ --base ASSET --sort time --no-report)
aa-graph "$SV" --dest gs://BUCKET/…/ASSET/ --var Sv
```

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
| Fetch | `aa-fetch` | L0 | Downloads those raw files from NCEI into a scratch folder. From another source: `aa-download` (an archive in a bucket) or `cp` (a folder on the workstation) copies exactly the planned files. The card then checks that exactly the planned files arrived; missing files stop the run and are named; extra ones are set aside, not combined. |
| Convert | `aa-ed` | L1 | Each raw file to EchoData. With a single file, it writes the asset directly (there is nothing to combine). |
| Combine | `aa-combine` | L1 | The files, in time order, into one EchoData written to the bucket, with a QC report beside it. |
| *(file by file)* | `aa-ed`, `aa-combine` | L1 | No fetch stage: `aa-ed` fetches, converts and uploads each raw file in turn as its own Zarr store; `aa-combine` combines those stores where they are, into a store in the bucket. |
| Calibrate | `aa-sv` | L2A | Sv beside it, named `<asset>_<recipe8>.nc`. |
| Echogram | `aa-graph` | L2A | A PNG of that Sv, named after it. |
| Record | `aa-upload` | | The request document, kept with the products. |

Scratch space is `<working folder>/<asset>-<run>/` (see *Working space*),
with the tools' cache inside it. It is removed after a successful run (unless
*Keep the raw files* is on) and kept after a failure, as evidence.

## Settings

| Variable | Default | |
|---|---|---|
| (your choice) | none | The bucket the Derived panel shows and the card writes to is the one chosen in the Workbench (status bar ▸ project, *Change project or bucket* in the Destination step, or `aa-workbench project`). Until one is chosen, the card says so instead of guessing. |
| `AASI_GCP_PROJECT` / `AASI_DERIVED_BUCKET` | unset | A deployment's project and bucket, used when the user has not chosen. |
| `AASI_GCP_PROJECTS` | `ggn-nmfs-aa-prod-1,ggn-nmfs-aa-dev-1` | Projects discovery checks by name even when Resource Manager does not list them. |
| `AASI_BASELINE_BUCKET` | (the chosen bucket) | Write somewhere else than the Derived panel shows. |
| `AASI_NCEI_CACHE_PROJECT` | (the chosen project) | Read the NCEI cache from this project instead. |
| `AASI_CONFIG_DIR` | `~/.config/aa-si-workbench` | Where the user's choice is kept. |
| `AASI_RUN_ROOT` | `~/aa-workbench-runs` | The default working folder (the card can name another). |
| `AASI_PROVENANCE_TIMEOUT` | `120` | Seconds `aa-metadata` may take for the Metadata panel. |

## Requirements

The console tools come from **aalibrary** (Python 3.13), the provenance-aware
release: `aa-workbench check` lists the eight tools the card needs and says
where products will go. If `aa-metadata` is missing, the installed aalibrary is
older than the card, and the card says so rather than failing a run.

The file listing the card plans from is the backend's NCEI catalogue (the
public S3 archive by default, `--source cache` for the BigQuery cache);
`aa-fetch` downloads by the BigQuery cache. Serving with `--source cache` makes the two the same list,
so a file the cache does not know can never be promised.

## When something goes wrong

- **"aa-fetch delivered 3 of the 5 files…"** — the BigQuery cache does not list
  them (yet). Use `--source cache` so the card plans from the same list.
- **"This range needs about … of working space"** — turn on *File by file into
  the bucket* (one raw file here at a time), choose a folder on a bigger disk,
  turn on *Free space as it goes*, or choose a shorter range. File by file with
  Sv, it is the Sv: turn Sv off and calibrate later, or use a bigger disk.
- **"aa-ed made 22 of the 24 per-file stores"** (or **"aa-sv made … per-file Sv
  stores"**) — some files failed to convert (or calibrate); that stage's log
  names them. Run again: what is already in the bucket is reused.
- **"The installed aalibrary makes Sv for the whole range here"** — update it
  (**Tools ▸ Update Python Environment**): file by file, each file's Sv is made
  in turn and joined in the bucket.
- **"… failed (exit -9)"** or **"… was killed by the system (signal 9)"** — the
  system stopped the conversion for running out of memory (see *Large raw
  files* above). Update aalibrary (**Tools ▸ Update Python Environment**), close
  other memory-hungry work, and run again: finished stores are reused. The
  failed run's working folder can be deleted.
- **"… is on the gcsfuse mount of a bucket"** — choose a folder on the
  workstation's own disk; the products still go to the bucket.
- **A gap warning** — the combine bridges it and records it in the QC report.
  Turn on strict QC to refuse instead, or narrow the range.
- **"The Workbench server was restarted…"** — runs are kept in the server's
  memory. Run again: finished products are reused.
- **Anything else** — the error names the stage and quotes the tool. *Jobs and
  logs* opens the Processing Queue with the full output, and the scratch folder
  is kept.
