/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to "true" to make the NCEI panel use the real backend API. */
  readonly VITE_AASI_USE_API?: string;
  /** Base URL for the backend API; empty = same-origin (via the dev proxy). */
  readonly VITE_AASI_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
