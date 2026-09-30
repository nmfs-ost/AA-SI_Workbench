# Handoff — Prepare EchoData, the baseline workflow

Paste this at the start of the next session with the Workbench zip. The previous
handoff (the emblem, the terminal toolbar, the account) is kept as
`HANDOFF-previous.md`; it is still accurate and nothing in it was undone. Its
**What is still open** list is repeated at the end.

---

## What was asked

Make the baseline operation — an NCEI survey's time range, combined into one
EchoData asset (plus Sv), saved to the right place in the bucket and available
to what comes next — "reliable and obvious", as a first-class workflow in the
left dock rather than one more console-tool form. The user chooses a **time
range**, not files. Accurate, simple but configurable, and beautiful. Keep what
is good in the left panel. Put the console tools in the requirements.

## What exists now

**A new left-dock panel, *Prepare EchoData*** (`components/panels/prepare/`),
first in the strip and fronted on a fresh layout (`LAYOUT_VERSION` 16). The
NCEI, Files, Derived, OMAO and Project panels are unchanged beside it.

- A **route** across the top — NCEI → Time range (L0) → EchoData (L1) → Sv (L2A)
  → Bucket (GCS) — that lights up as the card gains answers and, during a run, as
  the tools reach each stop.
- Four numbered steps: **Source** (the NCEI drill-down, fuzzy search,
  single echosounder auto-chosen), **Time range** (survey overview + close-up
  timeline with a brush and handles, typed UTC times, length presets, a summary
  of files/bytes/span and any gap), **Products** (EchoData locked on, Sv and
  echogram toggles, `.nc`/`.zarr`), **Destination** (fixed rule, editable asset
  name, the folder as it will look).
- **Advanced settings** (gap rule, strict QC, echogram scale, EK80 modes for EK80
  only, bucket, keep local files) and **Console commands** (the exact argv from
  the server, copyable as a standalone script).
- One button, which says why when it cannot run.
- A **run view**: stages with level, progress and elapsed time; each expands to
  its command and output. On success the products lead — the EchoData with
  copy / select / show-in-bucket actions and an echogram thumbnail — and the
  EchoData becomes the active selection, so Metadata shows its provenance and
  Pipelines take it as input.

**A server-side runner, `api/baseline.py`** (`/api/baseline/*`). One ordinary job
per tool through the existing job runner (so the Processing Queue shows every
stage and its log), chaining each stage on the path the previous one printed:
`aa-request → aa-fetch → aa-ed → aa-combine → aa-sv → aa-graph → aa-upload`. It
checks the fetch delivered exactly the planned files (missing: stop and name
them; extra: set aside), handles the one-file case (`aa-ed -o` straight to the
asset; no combine), reports reuse, keeps scratch on failure and removes it on
success. `/preview` builds the same argv without running; `/provenance` runs
`aa-metadata --json --verify`; `/image` serves a PNG product for the thumbnail.

**Elsewhere:** Metadata panel describes products through their provenance
(`metadata/ProvenanceView.tsx`); Derived can be asked to reveal a URI
(`state/derivedReveal.ts`) and hides `*.aa.json` sidecars; Pipelines accept a
gs:// `.nc`/`.zarr` selection as input; `aa-workbench check` is a pre-flight;
`aa-workbench serve` rebuilds a stale UI (and serves the old one if that fails).

**Requirements.** `backend/pyproject.toml` now depends on `aalibrary>=1.2.0`
(Python ≥ 3.13 marker; CI on 3.11/3.12 is unaffected). aalibrary is not on
PyPI: install it first (see the note in the file). aalibrary's own
`requirements.txt` now lists the console tools' direct imports (matplotlib,
pyyaml, pillow).

## Status, honestly

- Backend: ruff clean, **216 passed**, 1 skipped. `tests/test_baseline.py` (19)
  drives the runner with stand-in tools through the real job runner.
- Frontend: typecheck clean, **359 tests** (planner: 15 new), production build
  clean.
- **Run with the real console tools**, twice, on synthetic EK60 data: once
  through the API (3 files; reuse on the second run; the one-file path) and once
  through the UI itself in API mode (a dress rehearsal with a local stand-in for
  NCEI's listing and `aa-fetch`, and `AA_GCS_FAKE_ROOT` for the bucket). Real
  `aa-ed`/`aa-combine`/`aa-sv`/`aa-graph`/`aa-upload`/`aa-metadata`; provenance
  verified; the echogram drawn. **Not yet run against real NCEI or the real
  bucket** — nothing in this session had credentials, by design.
- An independent review found nine issues; all are fixed (EK80 calibration
  modes, a planner case that could drop the file holding the range's start,
  stuck states after a server restart or a runner exception, a NUL byte wedging
  the job queue, a cancel race, stale-UI rebuild failures, big provenance
  downloads for pre-sidecar products, input validation).

## What is still open

New, from this session:

1. **One real run on a workstation** — `aa-workbench check`, then a 1-hour range
   of HB1603. The first real `aa-fetch` is the step never exercised here.
2. **Runs live in server memory.** A restart forgets them (the card says so and
   a re-run reuses the products). Persisting them is a small table away.
3. **Re-runs re-download.** Reuse is decided after conversion, because product
   identity rests on the raw files' content. A persistent download cache would
   make a repeated range cheap.
4. **Other sources.** The card is NCEI-only; OMAO and bucket-resident raw data
   would be the same card with a different Source step.
5. **The Pipelines panel still starts from NCEI files.** It now accepts a
   product as input, but its stock pipelines begin at `aa-fetch`; one that
   begins at L1 EchoData is the natural companion.

The previous handoff's list, unchanged:

6. Make sequence stages skippable, and add a short path.
7. Run the sequence against real survey data, once, end to end.
8. A bucket to test against.
9. `aa-split`.
10. The Sv sector (`aa-sv`, `aa-clean`, `aa-mvbs`).
11. Point `AASI_PROJECT_MEMBERS` at the real project list — or decide it should
    stay unset.
12. Multi-select in the two trees.
13. Decide the `Owner` column.
14. Click a terminal link on a real workstation and confirm the toolbar is still.
15. Confirm the account resolves where it previously did not.

---

## Conventions worth not breaking

All of the previous ones hold — *a mode is a verb*, *defaults are placeholders*,
*nothing here deletes*, *a disabled action says why*, *the UI predicts, the
boundary enforces*, *only the spacer flexes*, *the emblem is an asset*, *a number
two files must agree on belongs to neither*. Two more:

**The preview is the run.** The commands the card shows are built by the same
function (`stage_args`) the runner uses. Never format a command for display
anywhere else.

**The card chooses files; the server checks them.** The planner (`plan.ts`) is
generous — a file that might hold the range's first ping is included — and the
runner refuses to combine anything but what was planned. Keep both halves.
