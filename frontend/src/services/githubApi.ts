/**
 * Reading the organisation's repository list from GitHub.
 *
 * Called from the browser rather than proxied through the backend, on purpose.
 * The backend has no outbound-network dependency today and adding one for a
 * link list would mean a workstation with no egress fails to *start* rather
 * than fails to show a panel. Straight from the page, this degrades to the
 * curated floor in `config/resources.ts` and nothing else notices.
 *
 * Unauthenticated, so GitHub allows 60 requests an hour per address. That is
 * ample for a list that is fetched once per session and cached — and when it is
 * not, the rate-limit response is reported as itself rather than as a generic
 * failure, because "wait an hour" and "you are offline" call for different
 * things from the reader.
 */

import { ORG, REPO_PREFIX } from '../config/resources';

export interface GithubRepo {
  name: string;
  fullName: string;
  description: string;
  htmlUrl: string;
  language: string;
  stars: number;
  openIssues: number;
  /** ISO 8601. The last push, not the last commit date — a repo can carry old
      commits pushed yesterday, and "when did anything happen here" is the
      question a reader of this list is asking. */
  pushedAt: string;
  archived: boolean;
  topics: string[];
}

/** The subset of GitHub's payload this reads. */
interface RawRepo {
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  open_issues_count: number;
  pushed_at: string | null;
  archived: boolean;
  topics?: string[];
  fork: boolean;
}

export class RateLimited extends Error {
  constructor() {
    super(
      'GitHub’s hourly limit for unauthenticated requests has been reached. ' +
        'The list below is the built-in one; live details return within the hour.',
    );
    this.name = 'RateLimited';
  }
}

function adapt(raw: RawRepo): GithubRepo {
  return {
    name: raw.name,
    fullName: raw.full_name,
    description: raw.description ?? '',
    htmlUrl: raw.html_url,
    language: raw.language ?? '',
    stars: raw.stargazers_count,
    openIssues: raw.open_issues_count,
    pushedAt: raw.pushed_at ?? '',
    archived: raw.archived,
    topics: raw.topics ?? [],
  };
}

/**
 * Every AA-SI repository in the organisation, most recently pushed first.
 *
 * Filtering happens here rather than through the search API because listing an
 * organisation costs one request and search costs one against a much smaller
 * quota — and because the org's own `?q=AA` link does the same prefix match, so
 * this panel and that page show the same set.
 *
 * Forks are excluded: a fork of an unrelated repository that happens to carry
 * the prefix is not part of the project, and the list is short enough that one
 * wrong row is noticeable.
 */
export async function fetchProjectRepos(): Promise<GithubRepo[]> {
  const response = await fetch(
    `https://api.github.com/orgs/${ORG}/repos?per_page=100&sort=updated`,
    { headers: { Accept: 'application/vnd.github+json' } },
  );

  if (response.status === 403 || response.status === 429) {
    // GitHub reports the limit on a header; a 403 with it exhausted is a quota
    // refusal rather than a permissions one, and saying "forbidden" would send
    // the reader looking for a credential they do not need.
    if (response.headers.get('x-ratelimit-remaining') === '0') throw new RateLimited();
  }
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} ${response.statusText}.`);
  }

  const payload = (await response.json()) as RawRepo[];
  return payload
    .filter((raw) => !raw.fork && raw.name.startsWith(REPO_PREFIX))
    .map(adapt)
    .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));
}
