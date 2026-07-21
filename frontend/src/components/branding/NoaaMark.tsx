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
export function NoaaMark({ size = 20 }: { size?: number }) {
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
