# Pipelines: console tools run on products in the bucket

A pipeline is a chain of aalibrary console tools (`aa-sv`, `aa-clean`, `aa-mvbs`,
`aa-graph`, …) run on a product that is already in the bucket: an EchoData from
Prepare EchoData, an Sv, an MVBS. Every product it makes is published beside its
input, with the provenance and hashes the tools record, and can be fed to the
next pipeline.

## Running one

1. **Choose the input** in the **Products** panel (left dock): click a product
   to make it the input, or tick several (Ctrl/Cmd-click) to run the same
   pipeline on each. The Pipelines card shows it with its hashes.
2. **Open a pipeline.** The cards that can take the input are shown (*All*
   shows the rest, with why each cannot). A
   card draws its chain as the products it passes along
   (EchoData → aa-sv → Sv → aa-graph → Echogram). If the input is already past
   a stage (an Sv into a pipeline that starts with `aa-sv`), that stage is
   skipped and drawn faint.
3. **Check the plan.** The open card shows what the server will run: each
   stage's settings, where the products go, anything wrong (a stage that needs
   depth with no `aa-depth` before it; a pipeline that cannot read the input),
   and the exact console commands, copyable as a script.
4. **Run.** The run appears under *Runs* with each stage's state, its command
   and log, and then the products it made. Each product can be inspected
   (Metadata), shown in the Products panel, or used as the next input.

A stage whose product is already in the bucket (the same inputs and settings
make the same product) is reused by the tool rather than recomputed, and marked
so. *Recompute products already in the bucket* forces it.

## Settings

Open a pipeline and its stages' settings show in **Configuration** (right
dock). They are read from the installed console tools: their flags, their
defaults, their own help. Only values that differ from a tool's default are
sent. A fingerprint marks a setting that changes the product (and so its hash
and the `_xxxxxxxx` in its name).

Changed settings apply to the card's plan and runs straight away. *Save* keeps
them; a built-in pipeline is saved as your own copy. **New pipeline** (or a
card's ⋮ menu) builds a chain: only tools that read what the stage before
writes can be added after it.

Saved pipelines are kept per user on the workstation,
`~/.config/aa-si-workbench/pipelines.json`.

## The hashes

Each product shows three identities, and the product hash leads:

| | What it answers | Where it comes from |
|---|---|---|
| **Product hash** (`aa:xxxxxxxx`) | Is this the same science? SHA-256 of the tool, its scientific settings, the software, and every input's identity. | `aa-product-hash` metadata; the provenance record |
| **Recipe** | Was it made the same way? The processing without the data. Its first eight characters are the `_xxxxxxxx` in the file name. | `aa-recipe` metadata |
| **MD5** | Are these the bytes the tool published? Google's checksum. | the object itself; checked against the `aa-content-md5` the tool recorded |

On the pipeline's input and a run's products, a tick means the object's MD5
still matches the one its tool recorded; a warning (also shown in the Products
panel) means it was rewritten after publishing, so its provenance may not
describe it. Click a hash to copy it whole.

## Where products go

Beside the input, in its folder, when the input is yours and in the bucket you
chose. An input in a colleague's folder, or in another bucket (one you can only
read), writes to your own folder in the chosen bucket instead, at the same
`derived_products/<you>/<vessel>/<survey>/<asset>/` path: a run never writes
into someone else's products. *Elsewhere…* sends one run's products to another
`gs://` folder.

## For developers

- `backend/…/api/catalogue.py`: the tools, introspected from the installed
  aalibrary (each console module's `SPEC`, `HELP` and argparse parser) through
  the tools' own interpreter; `TRAITS` holds what argparse cannot say (what a
  tool reads, writes, adds, needs). The argv builder lives here too.
- `api/pipelines.py`: built-in and saved pipelines, the plan (`POST
  /api/pipelines/plan`), runs (`/api/pipelines/runs`), one job per stage, each
  reading the product the stage before printed, pinned to the run's GCP
  project.
- `api/products.py`: one product's hashes and history from its metadata and
  `.aa.json` record (`GET /api/products/info`), never downloading it. The
  Products listing (`api/derived.py`) carries the same fields per row.
- Frontend: `components/panels/pipelines/*` (cards, plan, runs, settings,
  editor), `state/pipelines.ts`, `services/pipelinesApi.ts`,
  `components/panels/products/ProductBits.tsx` (the hash tags).
- Tests run the real tools' flags from a snapshot
  (`backend/tests/fixtures/aalibrary_tools.json`, made by
  `catalogue._introspect()`); refresh it when aalibrary's tools change.
