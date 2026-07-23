import type { RecipesListing, RecipeSummary } from './recipeTypes';

/**
 * The data seam for the Recipes panel — same shape as `nceiService`'s
 * `NceiCatalogSource`: one interface, an API-backed implementation and a mock,
 * bound once by `VITE_AASI_USE_API`.
 *
 * `capabilities.filesOnDisk` exists because the mock's paths are fictions:
 * offering "Open YAML in the editor" against a path that isn't there would
 * produce an honest-looking button and a confusing error. The API source's
 * paths are real files, so it can.
 */
export interface RecipesSource {
  list(): Promise<RecipesListing>;
  capabilities: {
    /** True when recipe paths are real files this machine can open/run. */
    filesOnDisk: boolean;
  };
}

const API_BASE = import.meta.env.VITE_AASI_API_BASE ?? '';

export const apiRecipesSource: RecipesSource = {
  capabilities: { filesOnDisk: true },
  async list() {
    const response = await fetch(`${API_BASE}/api/recipes`);
    if (!response.ok) {
      const detail = await response
        .json()
        .then((body: { detail?: string }) => body.detail)
        .catch(() => undefined);
      throw new Error(detail ?? `Recipe listing failed (${response.status})`);
    }
    return (await response.json()) as RecipesListing;
  },
};

/* ------------------------------------------------------------------ */
/* Mock data                                                           */
/* ------------------------------------------------------------------ */

/**
 * GENERATED from the bundled recipes — do not hand-edit entries.
 *
 * Four of the real files in `backend/src/aa_si_workbench/builtin_recipes/`
 * (verbatim copies of aa-recipe-manager's example_recipes), run through the
 * backend's own `summarize_recipe` and dumped here, so mock mode shows exactly
 * what the API would serve for those files — the hand-transcribed versions
 * this replaced had silently trimmed inputs and steps. Regenerate with the
 * snippet in docs/development/handoff.md (Recipes section) after updating the
 * bundle. The final `broken_example` entry is synthetic, kept so the error
 * card stays exercised; the real bundle has no broken file.
 *
 * Paths are fictions pointing at the canonical home clone; that is why mock
 * mode declares `filesOnDisk: false` and keeps Run/Open YAML disabled.
 */
const MOCK_RECIPES: RecipeSummary[] = [
  {
    "id": "processing_lvl_1.yaml",
    "path": "/home/user/AA-SI_recipe_manager/example_recipes/processing_lvl_1.yaml",
    "fileName": "processing_lvl_1.yaml",
    "name": "processing_lvl_1",
    "version": "1.0",
    "description": "Initial setup through calibration parameter extraction.",
    "author": "<Your Name>",
    "schemaVersion": "1",
    "inputs": [
      {
        "name": "raw_input_folder",
        "type": "path",
        "description": "Folder containing the raw acoustic files.",
        "required": true
      },
      {
        "name": "cal_input_folder",
        "type": "path",
        "description": "Folder containing standardized calibration files.",
        "required": true
      },
      {
        "name": "calibration_outputs",
        "type": "str",
        "description": "Subdirectory name under the pipeline outputs folder for calibration artifacts.",
        "default": "calibration",
        "required": false
      },
      {
        "name": "cruise_id",
        "type": "str",
        "description": "Cruise identifier used in calibration mapping.",
        "required": true
      },
      {
        "name": "record_author",
        "type": "str",
        "default": "<Your Name>",
        "required": false
      },
      {
        "name": "sonar_model",
        "type": "str",
        "default": "EK60",
        "required": false
      },
      {
        "name": "raw_file_names",
        "type": "list",
        "description": "Optional subset of filenames within raw_input_folder to use. Empty list means \"use every .raw file in the folder\". Note that generate_standardized_cal_mapping always scans the full folder; this input only constrains the set of files that get opened and processed.\n",
        "default": [],
        "required": false
      }
    ],
    "steps": [
      {
        "id": "initial_setup",
        "op": "initial_setup"
      },
      {
        "id": "gen_cal_mapping",
        "op": "generate_standardized_cal_mapping"
      },
      {
        "id": "read_raw",
        "op": "read_raw_files"
      },
      {
        "id": "combine_raw",
        "op": "combine_raw_files"
      },
      {
        "id": "extract_cal_params",
        "op": "extract_standardized_cal_params"
      }
    ]
  },
  {
    "id": "hb1603_survey_pipeline_modular.yaml",
    "path": "/home/user/AA-SI_recipe_manager/example_recipes/hb1603_survey_pipeline_modular.yaml",
    "fileName": "hb1603_survey_pipeline_modular.yaml",
    "name": "hb1603_survey_pipeline_modular",
    "version": "1.0",
    "description": "Modular HB1603 pipeline composed from generic sub-recipes.",
    "author": "<Your Name>",
    "schemaVersion": "1",
    "inputs": [
      {
        "name": "raw_input_folder",
        "type": "path",
        "default": "./raw_file_inputs",
        "required": false
      },
      {
        "name": "cal_input_folder",
        "type": "path",
        "default": "./calibration_files/HB201607_cal",
        "required": false
      },
      {
        "name": "line_file_path",
        "type": "path",
        "default": "./line_files/SpermWhaleClicks_click_data_HB1603_SpermWhaleDive_Span0.2_07252016_2120_UTC.csv",
        "required": false
      },
      {
        "name": "range_bin",
        "type": "str",
        "default": "10m",
        "required": false
      },
      {
        "name": "ping_time_bin",
        "type": "str",
        "default": "20s",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "query_ncei",
        "op": "query_ncei_data"
      },
      {
        "id": "download_raw",
        "op": "download_ncei_data"
      },
      {
        "include": "processing_lvls_1_to_3.yaml"
      },
      {
        "id": "add_line_overlay",
        "op": "add_line_overlay"
      },
      {
        "include": "visualization.yaml"
      },
      {
        "include": "machine_learning.yaml"
      }
    ]
  },
  {
    "id": "machine_learning.yaml",
    "path": "/home/user/AA-SI_recipe_manager/example_recipes/machine_learning.yaml",
    "fileName": "machine_learning.yaml",
    "name": "machine_learning",
    "version": "1.0",
    "description": "ML reshape, normalization, and HDBSCAN clustering.",
    "author": "<Your Name>",
    "schemaVersion": "1",
    "inputs": [
      {
        "name": "mvbs_with_lines",
        "type": "dataset",
        "description": "MVBS dataset with line overlay variables added.",
        "required": true
      },
      {
        "name": "echodata",
        "type": "echodata",
        "description": "EchoData object used for auxiliary ML features.",
        "required": true
      },
      {
        "name": "overlay_line_var",
        "type": "str",
        "description": "Line variable to overlay on the clustering report plot.",
        "default": "overlay_line",
        "required": false
      },
      {
        "name": "sv_clean_unmasked",
        "type": "dataset",
        "description": "Pre-sparse-mask Sv used for per-cell statistics and as the backdrop / ping-index reference for ML and cluster echogram plots.\n",
        "required": true
      },
      {
        "name": "range_bin",
        "type": "str",
        "description": "Range bin size shared with sparse masking and MVBS generation.",
        "default": "20m",
        "required": false
      },
      {
        "name": "ping_time_bin",
        "type": "str",
        "description": "Ping-time bin size shared with sparse masking and MVBS generation.",
        "default": "20s",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "compute_cell_stats",
        "op": "compute_per_cell_statistics"
      },
      {
        "id": "reshape_ml",
        "op": "reshape_for_ml"
      },
      {
        "id": "add_aux_features",
        "op": "add_auxiliary_features"
      },
      {
        "id": "normalize_ml",
        "op": "normalize_ml_data"
      },
      {
        "id": "plot_normalized_ml",
        "op": "plot_ml_echogram"
      },
      {
        "id": "run_hdbscan",
        "op": "run_hdbscan"
      },
      {
        "id": "embed_results",
        "op": "embed_clustering_results"
      },
      {
        "id": "plot_clustering_report",
        "op": "plot_clustering_report"
      }
    ]
  },
  {
    "id": "visualization.yaml",
    "path": "/home/user/AA-SI_recipe_manager/example_recipes/visualization.yaml",
    "fileName": "visualization.yaml",
    "name": "visualization",
    "version": "1.0",
    "description": "Echogram visualization (clean Sv and MVBS with line overlay).",
    "author": "<Your Name>",
    "schemaVersion": "1",
    "inputs": [
      {
        "name": "sv_clean",
        "type": "dataset",
        "description": "Clean Sv dataset (post mask + sparse-bin masking).",
        "required": true
      },
      {
        "name": "mvbs_with_lines",
        "type": "dataset",
        "description": "MVBS dataset with line overlay variables added.",
        "required": true
      },
      {
        "name": "overlay_line_var",
        "type": "str",
        "description": "Name of the line variable to plot on the MVBS echogram.",
        "default": "overlay_line_fit",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "plot_sv_clean",
        "op": "plot_sv_echogram"
      },
      {
        "id": "plot_mvbs",
        "op": "plot_sv_echogram"
      }
    ]
  },
  {
    "id": "broken_example.yaml",
    "path": "/home/user/AA-SI_recipe_manager/example_recipes/broken_example.yaml",
    "fileName": "broken_example.yaml",
    "name": "broken_example",
    "inputs": [],
    "steps": [],
    "error": "YAML parse error: while parsing a flow sequence — expected ',' or ']' (line 3)."
  }
];

export const mockRecipesSource: RecipesSource = {
  capabilities: { filesOnDisk: false },
  async list() {
    return {
      root: '/home/user/AA-SI_recipe_manager/example_recipes',
      builtin: false,
      recipes: MOCK_RECIPES,
      error: null,
    };
  },
};

/**
 * The binding, decided once at module load — the same rule `nceiSource` uses:
 *   VITE_AASI_USE_API=true → the real backend listing
 *   otherwise              → deterministic mock data
 */
export const recipesSource: RecipesSource =
  import.meta.env.VITE_AASI_USE_API === 'true' ? apiRecipesSource : mockRecipesSource;
