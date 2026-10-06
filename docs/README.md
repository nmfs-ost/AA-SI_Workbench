# AA-SI Workbench — Documentation

- [`architecture/overview.md`](architecture/overview.md) — system design and how
  the components fit together.
- [`guides/getting-started.md`](guides/getting-started.md) — for people using the
  Workbench.
- [`guides/prepare-echodata.md`](guides/prepare-echodata.md) — the baseline
  workflow: an NCEI time range made into one EchoData asset in the bucket.
- [`guides/pipelines.md`](guides/pipelines.md) — console tools chained and run
  on products in the bucket (Products panel → Pipelines), and the hashes each
  product carries.
- [`guides/echograms-and-analysis.md`](guides/echograms-and-analysis.md) —
  echograms, lines and regions (Echoview files), calibration (ECS),
  integration and its results, and the dataflow of a product.
- [`guides/storage-costs.md`](guides/storage-costs.md) — what the bucket's
  storage costs, per file, folder, month and year, and the price used.
- [`guides/connecting-ncei.md`](guides/connecting-ncei.md) — pointing the NCEI
  catalogue Prepare EchoData plans from at real data (S3 or the BigQuery
  cache).
- [`guides/updating-the-environment.md`](guides/updating-the-environment.md) —
  the in-app `aa-setup` updater, and how to report issues.
- [`development/setup.md`](development/setup.md) — for people developing the
  Workbench.

<!-- TODO: consider publishing this folder as a documentation site (e.g. MkDocs
     or Quarto), consistent with NOAA Fisheries open-science tooling. -->
