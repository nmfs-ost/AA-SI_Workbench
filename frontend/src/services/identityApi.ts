/**
 * Client for /api/identity — who this is, and what to offer them.
 *
 * Mirrors backend/src/aa_si_workbench/api/identity.py, whose docstring is the
 * one to read. The short version, because it is the sort of thing that gets
 * forgotten between sessions and then relied on:
 *
 * **`capabilities` is a prediction, not a permission.** The Workbench runs on
 * the user's own workstation as that user, and the terminal panel is an
 * unrestricted shell. Nothing decided here can stop anyone doing anything. The
 * two real boundaries are GCP IAM (for the bucket) and AASI_FS_READONLY (for
 * the filesystem), and both live behind the API.
 *
 * So a capability that comes back false means "something downstream is going to
 * refuse this" — which is worth knowing *before* clicking, rather than three
 * minutes into a job that then fails with a 403 from a service the user has
 * never heard of. That is the whole job of this module.
 */

const API_BASE = (import.meta.env.VITE_AASI_API_BASE ?? '').replace(/\/$/, '');

export interface Capabilities {
  /** Create, rename and save. False under AASI_FS_READONLY. */
  writeFiles: boolean;
  /** Move to trash and restore. Same switch, separate flag: the panel says
      different things about "can't edit" and "can't remove". */
  trashFiles: boolean;
  runJobs: boolean;
  /** Publish to the bucket. The one capability with a real boundary behind it. */
  publish: boolean;
}

export interface Identity {
  principal: string;
  /** How the principal was found: env | gcloud | metadata | unknown. */
  source: 'env' | 'gcloud' | 'metadata' | 'unknown';
  project: string;
  /** Matches the configured allowlist. True when none is configured. */
  member: boolean;
  /** Whether an allowlist exists at all. The UI says nothing about membership
      when this is false — "member of nothing" is noise. */
  restricted: boolean;
  capabilities: Capabilities;
  /** Always false. Read the module docstring before changing anything here. */
  enforced: boolean;
  /** Already phrased for a person; shown verbatim. */
  detail: string;
}

/**
 * What to assume before the first response, and after a failed one.
 *
 * Permissive on purpose. This is not a security decision — see above — so the
 * failure mode to avoid is a workstation whose buttons are all greyed out
 * because the API took a moment to answer. If an action is genuinely going to
 * be refused, the refusal arrives from the boundary that means it.
 */
export const OPTIMISTIC_IDENTITY: Identity = {
  principal: '',
  source: 'unknown',
  project: '',
  member: true,
  restricted: false,
  capabilities: {
    writeFiles: true,
    trashFiles: true,
    runJobs: true,
    publish: true,
  },
  enforced: false,
  detail: '',
};

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      // Non-JSON error body — the status line is all we have.
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export const identityApi = {
  get: (refresh = false) => request<Identity>(`/api/identity?refresh=${refresh}`),
};
