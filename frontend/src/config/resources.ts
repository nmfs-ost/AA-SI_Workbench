/**
 * The project's own links — repositories, documentation, and where to ask.
 *
 * Sits beside `repo.ts`, which answers "where does *this* application live".
 * This answers the broader question the Resources panel exists for: what else
 * is part of AA-SI, and where is it.
 *
 * ## Live first, floor second
 *
 * The repository list is fetched from the GitHub API at runtime, because a
 * hand-maintained list of an organisation's repositories is exactly the kind of
 * thing this codebase has already been bitten by — `toolCatalog.ts` carries an
 * ACCURACY WARNING about precisely this shape of duplication, and the
 * discovery endpoint was built to route around it.
 *
 * `FALLBACK_REPOS` is therefore **a floor, not a catalogue**. Every entry is one
 * this repository can point at evidence for, and the panel says plainly when it
 * is showing this list rather than a live one. It exists so an air-gapped
 * workstation, or one that has hit GitHub's unauthenticated rate limit, still
 * offers somewhere to go — not so that the list can be treated as complete. It
 * almost certainly is not.
 */

/** The GitHub organisation the project's repositories live in. */
export const ORG = 'nmfs-ost';

/**
 * Repositories are selected by name rather than by topic.
 *
 * The organisation hosts far more than this project — stock assessment, survey
 * tooling, the fisheries toolbox — and the AA-SI ones are distinguished by
 * their `AA-SI_` prefix. Matching the prefix is what the org's own repository
 * search does with `?q=AA`, so this shows the same set for the same reason.
 */
export const REPO_PREFIX = 'AA-SI';

export interface ResourceLink {
  id: string;
  label: string;
  href: string;
  /** One line, shown under the label. */
  description: string;
}

export interface KnownRepo {
  name: string;
  description: string;
  /** Where the claim that this repo exists comes from. Not shown in the UI —
      it is here so the next person can tell a verified entry from a guess. */
  evidence: string;
}

/**
 * The floor. See the note above before adding to this.
 *
 * A repository belongs here only when something in this codebase or a checked
 * source names it. Adding one from memory reintroduces exactly the problem the
 * live fetch exists to solve, and it is worse than an empty list: a wrong link
 * is followed and a missing one is looked up.
 */
export const FALLBACK_REPOS: readonly KnownRepo[] = [
  {
    name: 'AA-SI_Workbench',
    description: 'This application — the workflow shell and its backend.',
    evidence: 'config/repo.ts; backend/pyproject.toml [project.urls]',
  },
  {
    name: 'AA-SI_aalibrary',
    description: 'The Python library the aa-* tools and this backend fetch data through.',
    evidence: 'backend/pyproject.toml install note; the documentation URL below',
  },
  {
    name: 'AA-SI_GCPSetup',
    description: 'The environment bootstrap and update script (aa-setup).',
    evidence: 'config/repo.ts setupGuideUrl',
  },
  {
    name: 'AA-SI_DataRoadMap',
    description: 'The data road map for the initiative.',
    evidence: 'the published site linked below',
  },
  {
    name: 'AA-SI_main',
    description: 'Software and idea sharing for the Active Acoustics Strategic Initiative.',
    evidence: 'the organisation listing',
  },
  {
    name: 'AA-SI_echoSMs',
    description: 'Acoustic scattering models for fish and plankton.',
    evidence: 'the organisation listing',
  },
];

/** Published documentation — the sites, not the repositories behind them. */
export const DOCUMENTATION: readonly ResourceLink[] = [
  {
    id: 'aalibrary',
    label: 'aalibrary API documentation',
    href: 'https://nmfs-ost.github.io/AA-SI_aalibrary/documentation/aalibrary/',
    description: 'Reference for the library the aa-* tools are built on.',
  },
  {
    id: 'roadmap',
    label: 'Data road map',
    href: 'https://nmfs-ost.github.io/AA-SI_DataRoadMap/',
    description: 'Where the initiative’s data work is going.',
  },
];

/** Where to ask, report, and read the policies. */
export const COMMUNITY: readonly ResourceLink[] = [
  {
    id: 'org',
    label: `All ${ORG} repositories`,
    href: `https://github.com/orgs/${ORG}/repositories?q=${REPO_PREFIX}`,
    description: 'The organisation’s own search, filtered the same way this panel is.',
  },
];
