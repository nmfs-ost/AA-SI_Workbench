/**
 * The NOAA mark in the menu bar.
 *
 * This is the official emblem, shipped as a real asset — not a drawing of one.
 * An earlier version of this file rendered hand-written SVG geometry (a disc, a
 * gull, water) as a stand-in, with a comment saying the drawn mark was there
 * only until the real file arrived. It has arrived, so the geometry is gone:
 * an approximation of a federal agency emblem is the one thing this component
 * must not be, because it looks like the real mark while not being it.
 *
 * ## Provenance
 *
 * `public/noaa-mark.png`, `noaa-mark-32.png` and `favicon.ico` are all derived
 * from a single official file:
 *
 *   nmfs-opensci/NOAA-NMFS-Brand-Resources
 *   logo-icons/noaa_digital_logo-2022_icon.png  (1501x1501, RGBA)
 *
 * — NOAA Fisheries' own brand-resources repository, sibling to the nmfs-ost org
 * this project ships from. That file is the 2022 NOAA digital logo in its icon
 * form: no circumscribed "NATIONAL OCEANIC AND ATMOSPHERIC ADMINISTRATION / U.S.
 * DEPARTMENT OF COMMERCE" ring, no NOAA wordmark, transparent background, and
 * exactly two brand colours (#0085CA and #003087) plus white for the gull.
 *
 * Nothing was redrawn. The build (see `docs/development/branding.md`) trims the
 * master to its own ink, squares it, and resamples it on **premultiplied**
 * alpha — the master's clear pixels are (0,0,0,0), so a straight RGBA resize
 * bleeds black into every antialiased edge and the mark picks up a grey halo at
 * 16px.
 *
 * The ring text was dropped rather than shrunk because it is illegible below
 * about 64px; a 19px emblem whose outer third is grey mush reads as a smudge,
 * not as NOAA. The icon variant is NOAA's own answer to the same question.
 *
 * ## Why a raster
 *
 * The brand repository publishes no SVG. Tracing one would be redrawing the
 * emblem, which is the thing this file exists not to do, so the mark ships at
 * 180px and is drawn at 18 — enough for a 6x display and still 13KB.
 */

/** The mark. One file, used by the menu bar and as the apple-touch icon. */
const MARK_SRC = '/noaa-mark.png';

/**
 * Rendered size in px.
 *
 * 18 rather than the strip's 20, because this is a *solid* mark sitting beside
 * outlined icons that are mostly whitespace. Matched by the number, a filled
 * disc reads a size larger than everything next to it; 18 is where the two
 * weigh the same. See `MenuBar.tsx` for how it is centred on the strip.
 */
export function NoaaMark({ size = 18 }: { size?: number }) {
  return (
    <img
      src={MARK_SRC}
      width={size}
      height={size}
      alt="NOAA"
      draggable={false}
      style={{ display: 'block', objectFit: 'contain' }}
    />
  );
}
