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
 * Faithful miniatures of real files in AA-SI_recipe_manager/example_recipes —
 * names, descriptions, input declarations and step lists transcribed from that
 * repo, trimmed but not invented, so the panel exercises the shapes the real
 * system produces: defaults that make inputs optional, `include:` steps, and
 * sub-recipe inputs (dataset/echodata) that only a parent can wire.
 */
const MOCK_RECIPES: RecipeSummary[] = [
  {
    id: 'processing_lvl_1.yaml',
    path: '/home/user/AA-SI_recipe_manager/example_recipes/processing_lvl_1.yaml',
    fileName: 'processing_lvl_1.yaml',
    name: 'processing_lvl_1',
    version: '1.0',
    description: 'Initial setup through calibration parameter extraction.',
    author: '<Your Name>',
    schemaVersion: '1',
    inputs: [
      {
        name: 'raw_input_folder',
        type: 'path',
        description: 'Folder containing the raw acoustic files.',
        required: true,
      },
      {
        name: 'cal_input_folder',
        type: 'path',
        description: 'Folder containing standardized calibration files.',
        required: true,
      },
      {
        name: 'cruise_id',
        type: 'str',
        description: 'Cruise identifier used in calibration mapping.',
        required: true,
      },
      {
        name: 'record_author',
        type: 'str',
        default: '<Your Name>',
        required: false,
      },
      { name: 'sonar_model', type: 'str', default: 'EK60', required: false },
      {
        name: 'raw_file_names',
        type: 'list',
        default: [],
        description:
          'Optional subset of filenames within raw_input_folder to use. Empty means every .raw file.',
        required: false,
      },
    ],
    steps: [
      { id: 'initial_setup', op: 'initial_setup' },
      { id: 'gen_cal_mapping', op: 'generate_standardized_cal_mapping' },
      { id: 'read_raw', op: 'read_raw_files' },
      { id: 'combine_raw', op: 'combine_raw_files' },
      { id: 'extract_cal_params', op: 'extract_standardized_cal_params' },
    ],
  },
  {
    id: 'hb1603_survey_pipeline_modular.yaml',
    path: '/home/user/AA-SI_recipe_manager/example_recipes/hb1603_survey_pipeline_modular.yaml',
    fileName: 'hb1603_survey_pipeline_modular.yaml',
    name: 'hb1603_survey_pipeline_modular',
    version: '1.0',
    description: 'Modular HB1603 pipeline composed from generic sub-recipes.',
    author: '<Your Name>',
    schemaVersion: '1',
    inputs: [
      {
        name: 'raw_input_folder',
        type: 'path',
        default: './raw_file_inputs',
        required: false,
      },
      {
        name: 'cal_input_folder',
        type: 'path',
        default: './calibration_files/HB201607_cal',
        required: false,
      },
      {
        name: 'line_file_path',
        type: 'path',
        default: './line_files/SpermWhaleClicks_click_data_HB1603.csv',
        required: false,
      },
      { name: 'range_bin', type: 'str', default: '10m', required: false },
      { name: 'ping_time_bin', type: 'str', default: '20s', required: false },
    ],
    steps: [
      { id: 'query_ncei', op: 'query_ncei_data' },
      { id: 'download_raw', op: 'download_ncei_data' },
      { include: 'processing_lvls_1_to_3.yaml' },
      { id: 'add_line_overlay', op: 'add_line_overlay' },
      { include: 'visualization.yaml' },
      { include: 'machine_learning.yaml' },
    ],
  },
  {
    id: 'machine_learning.yaml',
    path: '/home/user/AA-SI_recipe_manager/example_recipes/machine_learning.yaml',
    fileName: 'machine_learning.yaml',
    name: 'machine_learning',
    version: '1.0',
    description: 'ML reshape, normalization, and HDBSCAN clustering.',
    author: '<Your Name>',
    schemaVersion: '1',
    inputs: [
      {
        name: 'mvbs_with_lines',
        type: 'dataset',
        description: 'MVBS dataset with line overlay variables added.',
        required: true,
      },
      {
        name: 'echodata',
        type: 'echodata',
        description: 'EchoData object used for auxiliary ML features.',
        required: true,
      },
      {
        name: 'overlay_line_var',
        type: 'str',
        default: 'overlay_line',
        required: false,
      },
    ],
    steps: [
      { id: 'reshape_for_ml', op: 'reshape_for_ml' },
      { id: 'normalize', op: 'normalize_ml_data' },
      { id: 'run_hdbscan', op: 'run_hdbscan' },
      { id: 'clustering_report', op: 'plot_clustering_report' },
    ],
  },
  {
    id: 'broken_example.yaml',
    path: '/home/user/AA-SI_recipe_manager/example_recipes/broken_example.yaml',
    fileName: 'broken_example.yaml',
    name: 'broken_example',
    inputs: [],
    steps: [],
    error:
      "YAML parse error: while parsing a flow sequence — expected ',' or ']' (line 3).",
  },
];

export const mockRecipesSource: RecipesSource = {
  capabilities: { filesOnDisk: false },
  async list() {
    return {
      root: '/home/user/AA-SI_recipe_manager/example_recipes',
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
