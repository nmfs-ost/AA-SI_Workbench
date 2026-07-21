import type { SxProps, Theme } from '@mui/material';

/**
 * One density scale for the three browsers — NCEI, Files, Derived.
 *
 * They do the same job on different storage (a public S3 archive, the
 * workstation's disk, a GCS bucket of derived products) and sit in the same
 * dock, one icon apart, so reading as three different applications was the
 * problem. Files and Derived had already converged by hand; NCEI hadn't, in two
 * specific ways worth recording because both are easy to reintroduce:
 *
 *  1. Its search controls are MUI `TextField`s, and a `TextField` with no
 *     explicit `fontSize` inherits `body1` — about 14.9px against the 12px the
 *     trees use. That is the "the text looks too big" everyone sees first, and
 *     it comes from *not* styling something rather than from styling it wrong.
 *  2. Its file rows were two lines (name above size · timestamp) where a tree
 *     row is one, so an NCEI row stood roughly 38px against 24px and half as
 *     many files fitted on screen.
 *
 * The scale below is the tree's, nudged up: rows went 22 -> 24 to give NCEI's
 * checkbox somewhere to sit without crowding the filename, which costs Files
 * and Derived two pixels a row and buys all three the same rhythm.
 *
 * These are numbers, not components. A panel still writes its own `sx`; it just
 * spends these values doing it, so "make the lists denser" is one edit here
 * rather than three files and a guess at which numbers were load-bearing.
 */
export const panelDensity = {
  /** Height of one row in a list or tree. */
  rowHeight: 24,

  font: {
    /** The name of the thing — file, folder, object. */
    row: 12,
    /** Size, timestamp: present but never competing with the name. */
    meta: 10.5,
    /** Panel header title. */
    header: 12,
    /** Empty states, errors, hints. */
    hint: 11.5,
    /** Text typed into a filter or search control. */
    input: 12,
  },

  icon: {
    /** The kind icon beside a row. */
    row: 14,
    /** Expand/collapse chevron — larger, because it is also the hit target. */
    chevron: 16,
    /** Icons in a panel header or toolbar. */
    header: 15,
  },
} as const;

/**
 * Density for MUI form controls inside a side panel.
 *
 * Only type size and vertical rhythm are touched. Horizontal padding, the
 * notched outline and the floating label's geometry are left at MUI's defaults
 * on purpose: the label's position, the notch's width and the legend's font
 * size are three numbers that have to agree, and overriding one of them is how
 * you get a label clipped by its own outline. Callers pass
 * `InputLabelProps={{ shrink: true }}` so the label is always parked on the
 * notch and never has to animate down into a field this short.
 *
 * Scoped to the panels rather than set on the theme, because dialogs are read
 * at a conversational distance and should stay comfortable.
 */
export const compactFieldSx: SxProps<Theme> = {
  '& .MuiInputBase-root': { fontSize: panelDensity.font.input },
  '& .MuiInputBase-input': { fontSize: panelDensity.font.input },
  '& .MuiInputBase-input::placeholder': { fontSize: panelDensity.font.input },
  '& .MuiAutocomplete-endAdornment .MuiSvgIcon-root': { fontSize: 16 },
};

/** Options in an Autocomplete's popup, which renders in a portal. */
export const compactPopupSx: SxProps<Theme> = {
  '& .MuiAutocomplete-option': {
    fontSize: panelDensity.font.input,
    minHeight: 28,
  },
  '& .MuiAutocomplete-noOptions, & .MuiAutocomplete-loading': {
    fontSize: panelDensity.font.hint,
  },
};
