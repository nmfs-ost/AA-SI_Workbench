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
