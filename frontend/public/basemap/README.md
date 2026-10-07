# Basemap

Land outlines for the echogram's track map, served by the Workbench itself so
the map never fetches anything from outside the workstation.

| File | Scale | Used when the map shows |
| --- | --- | --- |
| `land-110m.json` | 1:110 million | the whole world (the inset) |
| `land-50m.json` | 1:50 million | a region, a few degrees across or more |
| `land-10m.json` | 1:10 million | a survey close up (loaded only then) |

These are TopoJSON, unchanged from the `world-atlas` package (version 2.0.2,
ISC licence, `LICENSE-world-atlas`), which is made from
[Natural Earth](https://www.naturalearthdata.com/) data, in the public domain.
`src/components/panels/echogram/basemap.ts` reads them.
