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
   skipped and drawn faint; so is a stage that only adds what the input
   already carries (`aa-depth` on an Sv that has depth), when its settings are
   the tool's own.
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

Some settings take another product rather than a value: `aa-sv`'s ECS file,
`aa-integrate`'s bottom line and regions, `aa-mask`'s masks. They list the
products of the right kind beside the input (newest first), or take any gs://
URI. The chosen product's content goes into the hash of what is made, so a
product made with a line saved again later is marked out of date in
**Dataflow** (see [echograms-and-analysis.md](echograms-and-analysis.md)).

Changed settings apply to the card's plan and runs straight away. *Save* keeps
them; a built-in pipeline is saved as your own copy. **New pipeline** (or a
card's ⋮ menu) builds a chain: only tools that read what the stage before
writes can be added after it.

Saved pipelines are kept per user on the workstation,
`~/.config/aa-si-workbench/pipelines.json`.

## Steps of your own: Bash and Python

Not every stage has to be a console tool. In **New pipeline** (or *Edit
stages…*), **Add a stage** lists *Your own* first:

- **Shell command**: any Bash, including pipes, `tee`, `grep`, `gsutil` and
  your own scripts.
- **Python step**: code run by aalibrary's Python, so `import aalibrary` works.

Either can go anywhere in the chain. A step gets the product the stage before
it made in three ways:

- on stdin, one line;
- as `$IN` (in Python, `os.environ["IN"]`);
- with `$DEST`, the folder products go to.

What it hands on:

- When the last line it prints is a product, the next stage reads that. A
  product is a `gs://` URI or a file that exists; a relative path is read from
  the home folder.
- Otherwise the input passes on unchanged. So `tee -a ~/sv.log` logs the Sv's
  path and hands the same Sv to `aa-graph`.

Set **Passes on** when the step makes a different kind of product, for example
a Python step that writes an Sv. The chain then checks that the next tool reads
that kind.

How a step runs:

- In your home folder, as you, the same as the Terminal.
- A Bash step stops at the first command that fails (`bash -eo pipefail`).
  Remember that `grep` with no match counts as a failure.
- Its output shows in the run's log.
- A failed step stops the run, like a tool that fails.

Steps of your own are planned but not hashed: the console tools after them
still record what they read, so the products keep their provenance. A step is
edited in **Configuration**, which shows its command.

The plan's copyable script runs a step the same way the Workbench does: from
the home folder, with the input on stdin and as `$IN`, and the same rule for
what it hands on. Run the script in the AA-SI environment
(`source ~/venv313/bin/activate`), so its `python3` is aalibrary's, as the
Workbench's is.

Steps of your own run code as you, as the Terminal does, and follow the
Terminal's rule. While the Workbench listens on more than this machine
(`aa-workbench serve --host 0.0.0.0`), they are refused unless
`AASI_ALLOW_REMOTE_TERMINAL=true`.

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

## Remaking a product anywhere

Select a product and **Metadata** shows, under *Remake it*, the console
commands that made it:

- **This file, from its inputs**: the last step, reading the inputs in the
  bucket.
- **The whole chain, from the raw files**: a Bash script, from the raw files
  to this product.

Neither has a path from the workstation that made it:

- raw files are `"$RAW/<name>"`;
- products go to `--dest "$DEST"`;
- inputs in the bucket keep their `gs://` URIs.

Anyone can copy the script or download it as a `.sh` file, set `RAW` and
`DEST`, and run it. The same inputs and settings make the same product hash,
so the script remakes the same products under the same names.

Lines and regions drawn in the Echogram, and calibrations saved from
Calibration, are referenced by their URI, not remade. The script comes from
`aa-metadata --commands`.

*File* above it shows the object itself:

- its size and level;
- its storage class and what it costs a month;
- whether its MD5 still matches the one its tool recorded;
- its generation.

*Made from* lists its inputs; click one to select it.

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
  project. A stage with `tool` `bash` or `python` is a step of your own
  (`command`, `label`, `produces`); `jobs.submit_step` runs it.
- `api/products.py`: one product's hashes and history from its metadata and
  `.aa.json` record (`GET /api/products/info`), never downloading it. The
  Products listing (`api/derived.py`) carries the same fields per row.
- Frontend: `components/panels/pipelines/*` (cards, plan, runs, settings,
  editor), `state/pipelines.ts`, `services/pipelinesApi.ts`,
  `components/panels/products/ProductBits.tsx` (the hash tags).
- Tests run the real tools' flags from a snapshot
  (`backend/tests/fixtures/aalibrary_tools.json`, made by
  `catalogue._introspect()`); refresh it when aalibrary's tools change.
