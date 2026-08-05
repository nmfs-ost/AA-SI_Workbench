import { useState } from 'react';

/**
 * The NOAA mark in the menu bar.
 *
 * Unlike every other glyph in this application, this one carries its own
 * colour. That is the point of it: the toolbar icons are outlined, grey, and
 * inherit `currentColor` so they read as one set, and a logo that joins that
 * set stops reading as a logo. It is an emblem, not a control, and it should
 * look like the one thing on the bar you cannot click to do something.
 *
 * Two ways it renders, in order of preference.
 *
 * **The official emblem**, when the file is present. Drop the real asset at
 * `frontend/public/noaa-emblem.svg` (or .png — change EMBLEM_SRC) and it is
 * used here with no code change. This is the right answer and the drawn mark
 * below is a stand-in for it: the NOAA emblem is an official agency insignia
 * with its own usage guidance, and reproducing it exactly from memory would
 * produce something that looks like the real thing while not being it.
 *
 * **The drawn mark**, otherwise. Original geometry — a disc, a gull, water —
 * in NOAA's blues rather than in the toolbar's grey. It is recognisable at
 * 19px and honest about being an approximation, which a wrong reproduction of
 * the seal would not be.
 *
 * The favicon at public/favicon.svg is deliberately *not* this. A tab icon is
 * painted outside the page, cannot read the in-app theme, and sits in a strip
 * whose colour the browser chooses — so it stays a monochrome mark that follows
 * the browser's own light/dark scheme. Colour here, adaptability there.
 */

const EMBLEM_SRC = '/noaa-emblem.svg';

/* NOAA's blues. Named rather than inlined because the two of them have to hold
   a readable contrast against each other at 19px, and that is a relationship
   worth being able to see in one place. */
const DEEP = '#003087'; // the disc
const SEA = '#0085CA'; // water, and the rim highlight

export function NoaaMark({ size = 20 }: { size?: number }) {
  const [emblemMissing, setEmblemMissing] = useState(false);

  if (!emblemMissing) {
    return (
      <img
        src={EMBLEM_SRC}
        width={size}
        height={size}
        alt="NOAA"
        // A missing file is the expected case until the asset is added, not an
        // error worth logging or showing.
        onError={() => setEmblemMissing(true)}
        style={{ display: 'block', objectFit: 'contain' }}
      />
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="NOAA"
      focusable="false"
      style={{ display: 'block' }}
    >
      {/* The disc. Filled rather than outlined — an outline at this size reads
          as another icon, and filling it is most of what makes it read as a
          mark instead. */}
      <circle cx="12" cy="12" r="10" fill={DEEP} />

      {/* Water across the lower third, clipped to the disc. */}
      <clipPath id="aa-noaa-disc">
        <circle cx="12" cy="12" r="10" />
      </clipPath>
      <g clipPath="url(#aa-noaa-disc)">
        <path d="M2 15.6 Q6 13.6 10 15.6 T18 15.6 T26 15.6 V23 H2 Z" fill={SEA} />
      </g>

      {/* The gull, in white, above the water. Two wings meeting low — the shape
          a bird makes at a distance, and the one part of the emblem that
          survives being drawn at 19px. */}
      <path
        d="M5.6 11.4 Q8.8 7.2 12 10.6 Q15.2 7.2 18.4 11.4"
        fill="none"
        stroke="#ffffff"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
