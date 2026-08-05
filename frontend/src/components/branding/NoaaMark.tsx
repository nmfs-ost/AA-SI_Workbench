/**
 * A simplified NOAA-inspired mark: a circle, a gull, water.
 *
 * Original geometry rather than a reproduction of the agency seal — three
 * strokes at the same weight as the outlined icons it sits beside, so it reads
 * as a member of the same set rather than a logo pasted into a toolbar. Circle,
 * bird and wave are the three things that make the NOAA emblem recognisable at
 * 20px; everything else in it disappears at this size anyway.
 *
 * It carries no colour of its own. `currentColor` means it inherits from
 * whatever it is placed in, so it follows the palette, hover states and
 * disabled states for free, and neither theme needs a variant of it.
 *
 * `strokeWidth` is in user units against a 24-unit box, matching the visual
 * weight of `@mui/icons-material`'s outlined set at the sizes used here. The
 * favicon at public/favicon.svg repeats this geometry — a static file can't
 * import a component — so a change to the shape belongs in both.
 */
import { useState } from 'react';

/**
 * Where the official emblem goes, when there is one.
 *
 * Drop the real asset at `frontend/public/noaa-emblem.svg` (or .png) and it
 * appears here and in the tab. Until then the drawn mark below is used.
 *
 * Deliberately a file rather than something reproduced in code: the NOAA
 * emblem is an official agency insignia with its own usage guidance, and an
 * approximation of it drawn from memory would be worse than an honest original
 * mark — it would look like the real thing while not being it. The file is
 * loaded at runtime and falls back silently when absent, so a build with no
 * emblem is not a broken build.
 */
const EMBLEM_SRC = '/noaa-emblem.svg';

export function NoaaMark({ size = 20 }: { size?: number }) {
  const [emblemFailed, setEmblemFailed] = useState(false);

  if (!emblemFailed) {
    return (
      <img
        src={EMBLEM_SRC}
        width={size}
        height={size}
        alt="NOAA"
        // A missing file is the normal case, not an error worth logging.
        onError={() => setEmblemFailed(true)}
        style={{ display: 'block', objectFit: 'contain' }}
      />
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="NOAA"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" />
      {/* Gull: two wings meeting low, the shape a bird makes at a distance. */}
      <path d="M6.6 11.6 Q9.3 8 12 10.9 Q14.7 8 17.4 11.6" />
      {/* Water, below it. */}
      <path d="M7.2 15.3 Q9.6 13.7 12 15.3 T16.8 15.3" />
    </svg>
  );
}
