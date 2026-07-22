/**
 * Which palette the shell is painted in. Dark is the default: this is an
 * instrument that gets read for hours in a ship's lab or a dim office, and it
 * is what every screenshot and every user so far has been looking at.
 *
 * Adding a member here is not enough to make a theme work — the palette itself
 * lives in `theme/tokens.ts`, and `Record<ThemeMode, PaletteDefinition>` there
 * is what turns a missing palette into a type error rather than a blank screen.
 */
export type ThemeMode = 'dark' | 'light' | 'noaa' | 'spring';

/**
 * Whether a palette is fundamentally light or dark.
 *
 * Three things outside our own stylesheets only understand those two words and
 * would silently do the wrong thing with a palette id: MUI's `palette.mode`
 * (which decides the default contrast text and elevation maths), the CSS
 * `color-scheme` property (native scrollbars, select dropdowns and the caret),
 * and Dockview's base class (`dockview-theme-dark|light`, the defaults we don't
 * override). Each palette therefore declares which of the two it behaves like,
 * and every one of those three sites asks for the base rather than the id.
 *
 * Before this existed all three interpolated the mode directly — a fourth
 * palette would have produced `dockview-theme-noaa`, a class that matches
 * nothing, and `color-scheme: noaa`, which the browser discards. Neither fails
 * loudly; both just look subtly broken.
 */
export type ThemeBase = 'light' | 'dark';
