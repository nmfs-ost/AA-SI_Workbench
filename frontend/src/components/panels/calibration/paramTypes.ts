/**
 * The parameter vocabulary of the Calibration panel: each parameter declares a
 * type, and ParamControl maps the type to a control.
 *
 * (It began as the old pipeline cards' schema; the pipelines now describe
 * their parameters from the installed console tools instead — see
 * services/pipelinesApi.ts.)
 */

/** Parameter kinds, each mapped to a specific control by ParamControl.tsx. */
export type ParamType =
  | 'string' // free text          -> TextField
  | 'number' // numeric            -> numeric TextField (min/max/step)
  | 'boolean' // on/off flag       -> Checkbox
  | 'enum' // one of a fixed set   -> Select dropdown
  | 'multi' // several of a set    -> multi Autocomplete (e.g. channels)
  | 'path' // directory / bucket   -> TextField + browse affordance
  | 'file'; // an input file       -> file selector (auto-injectable)

export type ParamValue = string | number | boolean | string[];

export interface ParamDef {
  id: string;
  label: string;
  type: ParamType;
  /** CLI flag this maps to, e.g. "-o" or "--channels". Omit for positionals. */
  flag?: string;
  default: ParamValue;
  /** Options for 'enum' / 'multi'. */
  options?: readonly string[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  /** One-line explanation shown as helper text / tooltip. */
  help?: string;
  /**
   * Shown in the card's compact widget. Non-primary params appear only in the
   * full Configuration panel, which keeps cards readable.
   */
  primary?: boolean;
  /**
   * What part this parameter plays in the stage's inputs.
   *
   * A single `'input'` was enough while every stage read one thing. It is not
   * enough now: several tools take *two* inputs with different mechanics, and
   * conflating them produces a command line with two candidate inputs and
   * nothing to say which the tool would read.
   *
   *   'input'     — arrives on the pipe. Auto-filled from the left-window
   *                 selection, shown read-only with an "injected" hint.
   *   'reference' — a sparse sidecar passed as an *argument* while the array
   *                 lineage arrives on stdin: `aa-mask regions.parquet`,
   *                 `aa-regrid bottom.parquet`.
   *   'target'    — the inverted case. The stage names its own subject as an
   *                 argument and whatever flows on the pipe is the modifier:
   *                 `aa-extract store.zarr` with regions on stdin, or
   *                 `aa-evr regions.evr` which starts a chain outright.
   *
   * The distinction is what stops `makeStage` from injecting the workspace
   * selection into a stage that already names its input.
   */
  role?: 'input' | 'reference' | 'target';
}
