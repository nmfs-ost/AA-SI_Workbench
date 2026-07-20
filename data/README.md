# Data

This directory is a **local workspace for datasets**. Its contents are **not
committed** — only the folder structure is tracked (via `.gitkeep`).

```
data/
├── raw/         Unmodified source data (raw echosounder files, etc.)
└── processed/   Derived, analysis-ready products
```

## Rules

- **Do not commit data.** Raw and processed files are ignored by `.gitignore`.
- **Never commit sensitive, embargoed, or personally identifiable information.**
- Keep large or shared datasets in an appropriate managed store and reference
  them; document their provenance in your analysis or in `docs/`.

<!-- TODO: document canonical dataset locations / access instructions for the
     project once established. -->
