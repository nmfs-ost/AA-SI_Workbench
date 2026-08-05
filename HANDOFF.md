# Handoff — the aa-* tools are wired to the Workbench

Paste this at the start of the next session with the Workbench zip. The tool
files (`aa_combine.py`, `aa_store.py`, `aa_request.py`, `aa_ed.py`, `aa_nc.py`,
`aa_fetch.py`, `aa_upload.py`) are useful but no longer required to answer
questions about flags — see **Discovery** below.

---

## What happened

The previous handoff asked for the right-dock panels to be wired to three new
tools, and listed nine open questions. Seven of the nine are now answered, two
of them by reading the tool source rather than by asking. The work grew a
backend, because a UI that can only print a command into a terminal cannot
report an exit code, and every interesting thing these tools say is in their
exit code.

**30 files: 18 new, 12 modified.** Backend `ruff` clean, 126 tests. Frontend
typecheck clean, 230 tests.

### Answered

| # | Question | Answer | How |
|---|---|---|---|
| 1 | `aa-combine --help` | 21 flags, `--describe` present | read |
| 2 | `aa-fetch` — positional? prompts? prints? | Positional YAML, **never prompts**, prints the run directory | source |
| 3 | `aa-ed`/`aa-nc` name and output | `aa-ed`, writes `.nc`; batch mode prints the **directory** | source |
| 5 | Terminal or job runner | Job runner. Nothing in the first tier is interactive | follows from 2 |
| 7 | `aa-upload` destination convention | `--as-is` + `--destination_prefix` for derived; echosounder mode is for raw | source |

### Still open

4, 6, 8, 9 from the previous list — chunk-shape policy at L1, a test bucket,
whether `aa-request` replaces `aa-get`, and the `aa-graph` rename. None blocks
anything now. Two new ones are at the end of this document.

---

## Discovery — read this first

**The Workbench no longer needs to be told what a tool takes.**

`GET /api/tools/describe` scans every installed distribution for `aa-*` console
scripts and reports the flags each one really accepts. Four layers, best answer
wins:

1. `--describe`, where a tool has it
2. **the tool's own source**, parsed with `ast` — no import, no execution
3. `--help` text, for prose and section grouping
4. the hand-written `toolCatalog.ts`, as a last resort

Layer 2 is the one that matters. It reads every `add_argument` call for flag
spellings, `dest`, `default`, `choices`, `action` and `nargs`, and it works
whether the parser lives in a tidy `build_parser()` or inline halfway down
`main()` — which matters, because only `aa-combine` does the former.

Measured on a real install of all seven tools: **7 of 7 discovered**, one via
`--describe` and six from source, in ~460 ms, with exactly one subprocess. Help
text and `--describe` support are both detected statically, so a tool that
imports echopype at module level (`aa-nc` does) is never started just to be
asked what flags it has.

Two consequences worth keeping in mind:

- **There is no "flags unconfirmed" state any more,** and a test asserts it
  cannot come back. Earlier versions of this work showed a badge whose only
  meaning was "go run `--help` yourself and correct a TypeScript file". If you
  see a tool reported as *not installed*, that is a real answer, not a shrug.
- **`toolCatalog.ts` is now a fallback.** Its `ACCURACY WARNING` header
  describes a real problem — a hand-maintained `verified` boolean in a
  different repo on a different cadence — and that problem is now routed
  around rather than managed. It is the reason the panel used to render
  `aa-raw` as the converter and `aa-fetch --ship_name` as a command.

---

## What is on screen

### Left dock — NCEI panel

The old `StageStrip` drew four numbered stages and ran one of them. It is gone.
In its place is a **sequence**: one row per stage, each of which either runs
something or says why it cannot.

```
1. Request   aa-request   Build │ Check°                → job
2. Fetch     aa-fetch     Fetch                         → job
3. Convert   aa-ed        Convert                       → job
4. Assemble  aa-combine   Check° │ Plan° │ Combine      → job
5. Verify    aa-store     Verify° │ Describe°           → job
6. Publish   aa-upload    Dry run° │ Upload   (optional)→ job
```

`°` = writes nothing. Assemble and Request **default to a checking mode**.

Rules the sequence enforces, each of which exists because of a specific
failure:

- **A stage waits for the one before it to succeed.** Combining against a
  directory Fetch never filled fails deep inside echopype on a missing group, a
  long way from the cause.
- **Any non-zero exit stops the sequence.** Including 4 — proceeding into a
  combine that `--check` just refused is the mistake `--check` exists to
  prevent.
- **A non-writing mode never emits an output path.** `aa-request --check` exits
  before its write block, so `-o` in check mode is silently ignored: the tool
  reports "0 problems", writes nothing, exits 0, and an `&&` chain then hands
  the next stage a path to a file that was never created. This was observed at
  a real terminal. A test now asserts it across every stage and mode.
- **Send to terminal renders the writing mode,** not whichever mode the picker
  is on, for the same reason. A check is something you run from its own row.
- **A mode flag is never emitted twice.** `--check` is both a mode and a
  discoverable boolean; ticking it in the form used to append a second one.

Each row expands to **its own flag controls, generated from discovery**.
`--sort` is a dropdown because argparse declares three choices; `--chunk-pings`
is a number field; `--strict` is a checkbox. Grouped by the tool's own `--help`
sections. Flags the sequence owns (`--workdir`, `-o`, the run directory) render
**locked with their value shown** — hiding them would put unexplained flags in
the preview, and making them editable would let you break the chain between
stages without being told.

Two fields above the steps: **Download to** (aa-fetch's `-o`, showing live where
files will land) and **Publish to** (aa-upload's `--destination_prefix`,
optional). Both were previously hardcoded.

Clicking a row's status icon opens that stage's log in Processing Queue.

### Right dock

- **Metadata** routes on what is selected. A raw file gets the NCEI view; a
  `.zarr` gets a **store view** reading `aa-store info --json`, leading with the
  two ratios that matter — `chunkCount.written / expected` and
  `bytes.stored / logical` — and rendering unknown as unknown rather than 0%.
  No Run button: this is an inspect widget, not an action one.
- **Processing Queue** is real. Job rows, progress from `--progress` NDJSON,
  and **Resume on exit 3 only**.
- **Configuration** gained a Plan button above Run.
- **Calibration** untouched. It belongs to the Sv sector, which is not this
  sector.

### Menu bar

`NoaaMark` now carries NOAA blues instead of inheriting the toolbar's grey.
**It is not the official emblem** — it is original geometry in the right
colours. Drop the real asset at `frontend/public/noaa-emblem.svg` and it is
used automatically, in the menu bar only. The favicon is deliberately untouched
and stays monochrome: a tab icon is painted outside the page and cannot read
the in-app theme, so it follows the browser's own light/dark scheme.

---

## Backend

Eight endpoints, three modules.

```
GET  /api/jobs                    every job, no log lines
POST /api/jobs                    { tool, args[], label, cwd }
GET  /api/jobs/{id}?since=N       one job, log from a cursor
POST /api/jobs/{id}/cancel
POST /api/jobs/{id}/resume
GET  /api/store/info?uri=&census=&arrays=
GET  /api/store/verify?uri=&strict=
GET  /api/tools/describe?refresh=
```

### `jobs.py` — generalised from `environment.py`

Three corrections to what that module does, each load-bearing:

- **`stdin=DEVNULL` on every child.** A tool with no positionals and an
  inherited open pipe blocks on `sys.stdin` forever. This is exactly how a job
  runner invokes a flags-only command, and it is a deadlock that was hit for
  real.
- **stdout and stderr pumped separately.** `environment.py` passes
  `stderr=subprocess.STDOUT`. For these tools that destroys the handle —
  stdout is a *value*, not a log.
- **Exit codes 0/1/2/3/4 map to distinct states.** `3 → partial`, resumable;
  `4 → qcFailed`, a finding, not a crash. Resume refuses anything but 3, so it
  cannot become a retry button that papers over a bad command line or hides a
  QC result.

Cancel sends **SIGTERM, not SIGKILL** — that is what lets `aa-combine`'s
handler stamp `complete: false`, which is what makes the interrupted store
report exit 3 rather than looking indistinguishable from a sparse one.

Argv is built server-side as `[resolved_aa_tool, *args]` with `shell=False`.
The client names a tool, never a command. `resolve_tool` refuses `sh` and
`../../bin/python`.

### `store.py`

Deliberately **not** routed through the job runner. `aa-store` never opens a
write handle and the answer is one JSON line, so it is a question with an
answer rather than something to watch. The payload is passed through
**verbatim** — adding the two computed ratios server-side would stop it being a
handle the next tool could read.

### `derived.py` — the `.zarr` listing fix

A `.zarr` prefix now lists as a leaf (`isDir: false, kind: "zarr"`), suffix
check first and one HEAD probe as fallback, never a listing. This was the
practical blocker: you cannot select a store to inspect if opening it enumerates
every chunk and hangs the panel.

---

## Files

**New (18)**

```
backend/src/aa_si_workbench/api/     jobs.py  store.py  tools.py
backend/tests/                       test_jobs.py
frontend/src/services/               jobsApi.ts  storeApi.ts  toolsApi.ts
frontend/src/state/                  jobs.ts  activeSubject.ts  storeInspection.ts
frontend/src/components/panels/metadata/    AssetView.tsx  StoreView.tsx
frontend/src/components/panels/ncei/        sequence.ts  useSequence.ts
                                            SequenceStrip.tsx  StageFlags.tsx
frontend/src/components/panels/pipelines/   PlanControls.tsx
frontend/tests/                      sequence.test.ts  toolWiring.test.ts
```

**Modified (12)** — `api/main.py`, `api/derived.py`, `MetadataPanel`,
`ProcessingQueuePanel`, `DerivedPanel`, `NceiActions`, `ConfigurationPanel`,
`PipelineRunControls`, `pipelineTypes`, `activeAsset`, `NoaaMark`, `MenuBar`.

Nothing was installed into the repo and no tool source is in it.

---

## Status, honestly

**Verified** — run against the real tools installed as console scripts:

- discovery across all seven, every layer
- exit-code mapping 0/1/2/3/4, resume gating, stdin non-blocking, stream
  separation, NDJSON progress, tool-name rejection
- argv construction for every stage and mode
- `aa-fetch` and `aa-ed` contracts, read from source
- the `--check` + `-o` failure, reproduced and then closed

**Untested** — written, never run end to end:

- **The whole sequence against real survey data.** Every stage has been tested
  in isolation; no complete acquire→verify run has happened.
- **Anything touching a bucket.** `aa-store` on `gs://`, Publish, and the
  `.zarr` leaf detection in `derived.py` — that last one is unit-tested against
  a fake provider but has never seen a real bucket.
- **The store view against a store `aa-combine` actually wrote.** It was built
  against the documented `aa/1` payload shape.

**Known wrong**

- **The sequence is one workflow, not the workflow.** It is survey assembly
  from NCEI. Files already on disk make Request and Fetch dead weight, and
  `aa-ed` given a bare filename does NCEI lookup, download and convert in a
  single step — so for a small job the real sequence is `aa-ed → aa-combine`,
  two rows, not six. Stages are gated in a fixed order and cannot be skipped.
  **This is the first thing to fix.**
- The Sv sector — `aa-sv`, `aa-clean`, `aa-mvbs` — has no UI at all.
- `aa-request` and `aa-store` still lack `--describe`. Harmless now that
  discovery reads source, but the curated labels and modes that only
  `--describe` can carry are unavailable for them.

---

## Next

In the order that unblocks the most.

1. **Make stages skippable, and add a short path.** See *Known wrong*. A
   sequence that cannot express `aa-ed → aa-combine` is wrong for the common
   small job.
2. **Run the sequence against real data, once, end to end.** Everything else is
   inference from source.
3. **A bucket to test against.** Publish, remote `aa-store`, and the derived
   listing fix are all unexercised, and all three touch credentials.
4. **`aa-split`.** Unchanged from the previous handoff and still the priority
   among new tools — the seam check finds the legs and nothing can act on them.
5. **The Sv sector**, when the Zarr/NetCDF boundary is decided.

## What would help

1. **The remaining tool files** — `aa-sv`, `aa-clean`, `aa-mvbs`, `aa-graph`,
   `aa-get`, `aa-recipe`, and anything else. Discovery finds them on install,
   but reading the source answers contract questions in a minute that otherwise
   take a round trip.
2. **Which workflows besides NCEI survey assembly matter**, so the sequence
   generalises against real paths rather than guessed ones.
3. **The official NOAA emblem file**, if the drawn mark is not acceptable.

---

## Two conventions worth not breaking

**A mode is a verb, never a variant of one.** `--recursive` is the same
operation over a wider glob, so it is a flag. At most one mode per stage may
write, and a test enforces it — that invariant is what keeps the mode picker
meaning "which verb" rather than "which spelling".

**Defaults are placeholders, not values.** An untouched field sends nothing, so
the tool's own default keeps applying and a later change to it still takes
effect. A field pre-filled with the default sends it explicitly on every run,
which is a different thing.
