# Scripts

Repository automation and developer helper scripts (setup, data preparation,
release tasks, etc.).

Keep scripts cross-platform where practical, give each a `--help`, and document
non-obvious ones here.

## move_per_file_stores.sh

Moves file-by-file stores made before catch-up 15 from
`derived_products/<you>/<vessel>/<survey>/per_file/<echosounder>/` to
`.../<survey>/<echosounder>/`, where Prepare EchoData now looks for them.

```bash
bash scripts/move_per_file_stores.sh gs://BUCKET/derived_products/YOU/            # lists, changes nothing
bash scripts/move_per_file_stores.sh gs://BUCKET/derived_products/YOU/ --apply    # moves
```

Copies inside the bucket (gcloud, else gsutil), checks every object arrived
with its size and each store's `aa-` metadata (its product hash) came along,
and only then deletes the `per_file/` copy; a folder it cannot list, or whose
contents changed while it copied, is left as it is. Refuses a folder whose new
place already holds a different store of the same name. Run it when no Prepare
is running; running it again carries on where it stopped.

## reseal_stores.py

Brings Zarr stores made before catch-up 16 up to date, in place, so echopype
can display their EchoData (no more `KeyError: 'aa_seal'`) and xarray can save
them to NetCDF. Only small metadata objects change, never data: an EchoData's
seal moves into its `Provenance` group and its `aa_seal` group goes; any
other store's seal gains its shape; every store's record and markers become
JSON text. Product hashes, the objects' `aa-` metadata and the `.aa.json`
records are unchanged, so everything is still found and reused.

```bash
~/venv313/bin/python scripts/reseal_stores.py gs://BUCKET/derived_products/YOU/            # lists, changes nothing
~/venv313/bin/python scripts/reseal_stores.py gs://BUCKET/derived_products/YOU/ --apply    # changes
```

A store is changed only when its record is its own and its listing of itself
matches its arrays, and each object only if it is still the version that was
read; the store is its own product at every step. Before `--apply`, update the
Python environment on every machine that uses these stores (an older
aalibrary would not recognise the new seal and would make those products
again), and run it when no Prepare is running. Running it again does what is
left.

## clear_store_sidecars.py

Deletes the `X.zarr.aa.json` files the console tools wrote beside Zarr stores
until catch-up 19. A store keeps its record in its own root metadata, and the
tools and the Workbench now read it from there. A copy beside a store adds
nothing, and once the store is replaced it describes the wrong one; a listing
of `X.zarr` without a trailing slash also picks it up.

```bash
~/venv313/bin/python scripts/clear_store_sidecars.py gs://BUCKET/derived_products/YOU/            # lists, changes nothing
~/venv313/bin/python scripts/clear_store_sidecars.py gs://BUCKET/derived_products/YOU/ --apply    # deletes
```

A copy is deleted only when its store holds a record the current tools
accept as its own. It's left where it is when the store has no record of its
own, when the store still needs `reseal_stores.py` (which checks stores
against the copy beside them, so run that first), or when there's no store
beside it. Each copy is deleted only if it hasn't changed since it was read.
Update aalibrary first (Tools > Update Python Environment, or aa-setup), or
the old tools write the copies again.

## check_prepare_run.py

Checks a finished Prepare EchoData run (file by file with Sv) from what is in
the bucket, read-only: each file's EchoData beam groups (EK80 complex CW/FM or
power) and which one Sv was calibrated from, with any channels or pings left
out; each file's raw, EchoData and Sv sizes against the Workbench's estimates;
the join (pings, order, gaps, depth padding, environment that differs between
files, and a few pings of the joined Sv against each file's own); when each
file was done; what else is in the folders; and this machine's memory and
space.

```bash
~/venv313/bin/python scripts/check_prepare_run.py gs://BUCKET/derived_products/YOU/VESSEL/SURVEY/BASE/
```
