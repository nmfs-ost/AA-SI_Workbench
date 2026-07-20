/**
 * Where this Workbench lives on GitHub — the one place the org/repo appear.
 *
 * Anything that links out (issue reporting, discussions, security policy,
 * documentation) derives its URL from here, so a fork or a rename is a
 * one-line change. Overridable at build time for forks:
 *   VITE_AASI_GITHUB_ORG=my-org VITE_AASI_GITHUB_REPO=My_Fork npm run build
 */

const ORG = import.meta.env.VITE_AASI_GITHUB_ORG?.trim() || 'nmfs-ost';
const NAME = import.meta.env.VITE_AASI_GITHUB_REPO?.trim() || 'AA-SI_Workbench';

const BASE = `https://github.com/${ORG}/${NAME}`;

/**
 * GitHub rejects very long URLs (and browsers cap them). Issue bodies are
 * prefilled through the query string, so a big log paste has to be diverted to
 * the clipboard instead.
 */
export const MAX_PREFILL_URL_LENGTH = 6000;

export const repo = {
  org: ORG,
  name: NAME,
  slug: `${ORG}/${NAME}`,
  url: BASE,
  issuesUrl: `${BASE}/issues`,
  discussionsUrl: `${BASE}/discussions`,
  securityUrl: `${BASE}/security/policy`,
  docsUrl: `${BASE}/tree/main/docs`,
  /** The environment bootstrap/update guide (AA-SI_GCPSetup owns the script). */
  setupGuideUrl: 'https://github.com/nmfs-ost/AA-SI_GCPSetup',
} as const;

/**
 * Build a prefilled "new issue" URL for one of the repo's issue forms.
 * `fields` keys must match the `id:` of the corresponding field in
 * .github/ISSUE_TEMPLATE/<template>, which is how GitHub matches prefill values.
 */
export function newIssueUrl(
  template: string,
  title: string,
  fields: Record<string, string>,
): string {
  const params = new URLSearchParams({ template });
  if (title.trim()) params.set('title', title.trim());
  for (const [key, value] of Object.entries(fields)) {
    if (value.trim()) params.set(key, value);
  }
  return `${BASE}/issues/new?${params.toString()}`;
}
