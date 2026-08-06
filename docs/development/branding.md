# Branding

The Workbench shows the NOAA mark in two places: the browser tab, and the
top-left of the menu bar. Both are the official emblem, shipped as a real
asset. Neither is a drawing of one.

## Where the asset came from

    nmfs-opensci/NOAA-NMFS-Brand-Resources
    logo-icons/noaa_digital_logo-2022_icon.png     1501x1501 RGBA

NOAA Fisheries' own brand-resources repository, sibling to the `nmfs-ost` org
this project ships from. The file is the 2022 NOAA digital logo in its **icon**
form:

- no circumscribed *NATIONAL OCEANIC AND ATMOSPHERIC ADMINISTRATION / U.S.
  DEPARTMENT OF COMMERCE* ring
- no NOAA wordmark
- transparent background
- exactly two brand colours — `#0085CA` and `#003087` — plus white for the gull

That the ring text is absent is NOAA's decision, not ours. It is illegible below
roughly 64px, and an emblem whose outer third is grey mush at 19px reads as a
smudge rather than as NOAA, which is why the icon variant exists.

## The three files

All in `frontend/public/`, all derived from that one master:

| File | Size | Used for |
|------|------|----------|
| `favicon.ico` | 16, 32, 48 in one file | tabs, bookmarks, Windows shortcuts |
| `noaa-mark-32.png` | 32 | the tab icon modern browsers prefer |
| `noaa-mark.png` | 180 | apple-touch icon, and the 18px mark in the menu bar |

Three declarations in `index.html` rather than one, because they answer
different questions. The `.ico` is what older browsers and Windows reach for and
carries all three small sizes; the 32px PNG is what modern browsers prefer for
the tab; the 180 is the home-screen tile, which looks soft if it has to upscale
a 32.

## Regenerating them

    python scripts/build_noaa_mark.py path/to/noaa_digital_logo-2022_icon.png

The output is committed, so a normal checkout and a normal build never run this.
It exists so the three files are reproducible rather than mysterious — running
it against the same master reproduces them byte for byte.

Two things it does, both load-bearing:

**It normalises the frame.** The published asset sits in a canvas with its own
margins, which is why the mark appeared a different size in each place it was
used. The script trims to the ink and centres on a square, so every size frames
the mark identically.

**It resamples on premultiplied alpha.** The master's fully transparent pixels
are `(0, 0, 0, 0)` — transparent *black*. A straight RGBA resize averages those
zeros into the colour channel of every partially covered edge pixel, so the mark
picks up a dark fringe: invisible at 180px, obvious at 16. Measured on this
asset, minimum edge luminance is 24 without premultiplication and 62 with it.

## What was there before

A hand-drawn SVG — a disc, a gull, water — in `NoaaMark.tsx`, with a matching
monochrome `public/favicon.svg` that followed the browser's light/dark scheme.
Both are gone. The drawn mark was always documented as a stand-in until the real
asset arrived; with the emblem present, an approximation of a federal agency
insignia is the one thing this component must not contain, because it looks like
the real mark while not being it.

The favicon losing its light/dark adaptation is deliberate and not a regression.
It is NOAA's mark, and an agency emblem that changes colour to suit the tab
strip is no longer the emblem. It carries its own contrast against either.

## If the mark ever needs to move or resize

`NoaaMark` renders at 18px, not the strip's 20. It is a *solid* mark sitting
beside outlined icons that are mostly whitespace, and matched by the number a
filled disc reads a size larger than everything next to it.

Its horizontal position is not a magic number: `MenuBar` gives it a slot exactly
`theme.aa.size.sideStrip` wide and centres it, so it shares an axis with the
Files / Derived / Project icons directly below. They live in different bars — the
menu bar spans the window, the icon strip starts under it — which is why this has
to be arithmetic rather than eyeballing. `tests/chromeGeometry.test.ts` pins it;
a `pl` or a `gap` on the menu bar is exactly what knocked it 3.5px off before.
