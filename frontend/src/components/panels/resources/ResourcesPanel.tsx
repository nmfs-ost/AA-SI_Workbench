import { useCallback, useEffect, useState } from 'react';
import type { FunctionComponent, ReactNode } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import {
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import {
  ArchiveOutlined,
  BugReportOutlined,
  ForumOutlined,
  LaunchOutlined,
  MenuBookOutlined,
  PersonOutlineOutlined,
  RefreshOutlined,
  SecurityOutlined,
} from '@mui/icons-material';

import { repo } from '../../../config/repo';
import {
  COMMUNITY,
  DOCUMENTATION,
  FALLBACK_REPOS,
  ORG,
  type ResourceLink,
} from '../../../config/resources';
import {
  fetchProjectRepos,
  RateLimited,
  type GithubRepo,
} from '../../../services/githubApi';
import { loadIdentity, useIdentity } from '../../../state/identity';
import { panelDensity } from '../panelStyles';
import { formatRelativeTime } from '../rowFormat';

/**
 * The project, as a panel: its repositories, its documentation, and who you are
 * to it.
 *
 * ## Why one panel and not a row of buttons
 *
 * A button per link is the obvious build and it does not survive contact with
 * the organisation: there are more AA-SI repositories than a toolbar can hold,
 * the set changes, and a link with nothing but a name attached tells the reader
 * nothing about whether it is the one they want. So the repositories are
 * *fetched* and shown with the three facts that actually answer "is this the
 * one" — what it is, what it is written in, and when anything last happened in
 * it. A repository last pushed to two years ago is a different answer from one
 * pushed to this morning, and no button can say that.
 *
 * ## Live, with a floor
 *
 * The list comes from the GitHub API. When that is unreachable — an air-gapped
 * workstation, or the unauthenticated hourly limit — the panel falls back to the
 * curated list in `config/resources.ts` **and says so**. Silently showing a
 * hand-maintained list as though it were live is the failure mode that makes a
 * stale link look authoritative, which is the thing `toolCatalog.ts` already
 * carries a warning about.
 *
 * ## Identity
 *
 * The footer names the principal the Workbench is acting as, because the most
 * common confusion these links produce is a 404 on a private repository that
 * looks like a broken link and is actually "you are signed in as someone else".
 * It is reported, never enforced — see `services/identityApi.ts`. GitHub
 * decides what a click can see, and this panel is not in that path.
 */

/** Cached for the session: the org's repo list does not change while a tab is
    open, and the unauthenticated quota is 60 an hour for the whole address. */
let cache: GithubRepo[] | null = null;

function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <Box sx={{ mb: 2 }}>
      <Typography
        sx={{
          px: 1.25,
          py: 0.5,
          fontSize: 9.5,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          color: theme.aa.color.text.muted,
        }}
      >
        {title}
      </Typography>
      {children}
    </Box>
  );
}

/** A row that opens something in a browser tab. */
function LinkRow({
  label,
  description,
  href,
  icon,
}: {
  label: string;
  description: string;
  href: string;
  icon: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Box
      component="a"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1,
        px: 1.25,
        py: 0.75,
        textDecoration: 'none',
        color: 'inherit',
        cursor: 'pointer',
        '&:hover': { backgroundColor: theme.aa.color.bg.hover },
        '&:hover .aa-launch': { opacity: 1 },
        '&:focus-visible': {
          outline: `1px solid ${theme.aa.color.accent.main}`,
          outlineOffset: -2,
        },
      }}
    >
      <Box sx={{ flexShrink: 0, pt: '2px', color: theme.aa.color.text.muted, display: 'flex' }}>
        {icon}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          sx={{
            fontSize: panelDensity.font.row,
            color: theme.aa.color.text.primary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </Typography>
        <Typography sx={{ fontSize: 10.5, color: theme.aa.color.text.muted }}>
          {description}
        </Typography>
      </Box>
      <LaunchOutlined
        className="aa-launch"
        sx={{
          fontSize: 12,
          flexShrink: 0,
          mt: '3px',
          opacity: 0,
          transition: 'opacity .12s',
          color: theme.aa.color.text.muted,
        }}
      />
    </Box>
  );
}

/** A repository card: what it is, what it's in, and when anything last happened. */
function RepoCard({ entry }: { entry: GithubRepo }) {
  const theme = useTheme();
  const pushed = formatRelativeTime(entry.pushedAt);

  return (
    <Box
      component="a"
      href={entry.htmlUrl}
      target="_blank"
      rel="noopener noreferrer"
      sx={{
        display: 'block',
        px: 1.25,
        py: 0.85,
        textDecoration: 'none',
        color: 'inherit',
        borderLeft: '2px solid transparent',
        transition: 'background-color .12s, border-color .12s',
        '&:hover': {
          backgroundColor: theme.aa.color.bg.hover,
          borderLeftColor: theme.aa.color.accent.main,
        },
        '&:focus-visible': {
          outline: `1px solid ${theme.aa.color.accent.main}`,
          outlineOffset: -2,
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
        <Typography
          sx={{
            flex: 1,
            minWidth: 0,
            fontFamily: theme.aa.font.mono,
            fontSize: 11.5,
            fontWeight: 600,
            color: theme.aa.color.accent.main,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {entry.name}
        </Typography>
        {entry.archived && (
          <Tooltip title="Archived — read-only on GitHub">
            <ArchiveOutlined sx={{ fontSize: 12, color: theme.aa.color.text.muted }} />
          </Tooltip>
        )}
        {pushed && (
          <Tooltip title={`Last pushed ${new Date(entry.pushedAt).toLocaleString()}`}>
            <Typography
              sx={{
                fontSize: 10,
                color: theme.aa.color.text.muted,
                fontVariantNumeric: 'tabular-nums',
                flexShrink: 0,
              }}
            >
              {pushed}
            </Typography>
          </Tooltip>
        )}
      </Box>

      {entry.description && (
        <Typography
          sx={{
            fontSize: 10.5,
            color: theme.aa.color.text.secondary,
            mt: 0.15,
            lineHeight: 1.35,
          }}
        >
          {entry.description}
        </Typography>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.4 }}>
        {entry.language && (
          <Typography sx={{ fontSize: 10, color: theme.aa.color.text.muted }}>
            {entry.language}
          </Typography>
        )}
        {entry.openIssues > 0 && (
          <Typography sx={{ fontSize: 10, color: theme.aa.color.text.muted }}>
            {entry.openIssues} open
          </Typography>
        )}
      </Box>
    </Box>
  );
}

export const ResourcesPanel: FunctionComponent<IDockviewPanelProps> = () => {
  const theme = useTheme();
  const { identity } = useIdentity();

  const [repos, setRepos] = useState<GithubRepo[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);
  /** Why the live list is absent. Empty when it is present. */
  const [degraded, setDegraded] = useState('');

  const load = useCallback(async (force = false) => {
    if (cache && !force) {
      setRepos(cache);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const fetched = await fetchProjectRepos();
      cache = fetched;
      setRepos(fetched);
      setDegraded('');
    } catch (caught) {
      setRepos([]);
      setDegraded(
        caught instanceof RateLimited
          ? caught.message
          : 'GitHub is not reachable from this workstation, so the list below is the built-in one.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadIdentity();
  }, [load]);

  const showingFallback = repos.length === 0 && !loading;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1.25,
          py: 0.5,
          flexShrink: 0,
          borderBottom: `1px solid ${theme.aa.color.border.subtle}`,
        }}
      >
        <Typography
          sx={{
            flex: 1,
            fontSize: panelDensity.font.header,
            fontWeight: 600,
            color: theme.aa.color.text.secondary,
          }}
        >
          Project
        </Typography>
        {loading && <CircularProgress size={11} />}
        <Tooltip title="Re-read the repository list">
          <IconButton size="small" onClick={() => void load(true)}>
            <RefreshOutlined sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0, py: 0.5 }}>
        <Section title={`Repositories · ${ORG}`}>
          {degraded && (
            <Typography
              sx={{
                px: 1.25,
                pb: 0.75,
                fontSize: 10.5,
                lineHeight: 1.4,
                color: theme.aa.color.status.warning,
              }}
            >
              {degraded}
            </Typography>
          )}

          {showingFallback
            ? FALLBACK_REPOS.map((entry) => (
                <LinkRow
                  key={entry.name}
                  label={entry.name}
                  description={entry.description}
                  href={`https://github.com/${ORG}/${entry.name}`}
                  icon={<LaunchOutlined sx={{ fontSize: 13 }} />}
                />
              ))
            : repos.map((entry) => <RepoCard key={entry.name} entry={entry} />)}

          {!loading && !showingFallback && repos.length === 0 && (
            <Typography
              sx={{ px: 1.25, fontSize: 11.5, color: theme.aa.color.text.muted }}
            >
              No matching repositories.
            </Typography>
          )}
        </Section>

        <Section title="Documentation">
          {DOCUMENTATION.map((link: ResourceLink) => (
            <LinkRow
              key={link.id}
              label={link.label}
              description={link.description}
              href={link.href}
              icon={<MenuBookOutlined sx={{ fontSize: 13 }} />}
            />
          ))}
          {COMMUNITY.map((link: ResourceLink) => (
            <LinkRow
              key={link.id}
              label={link.label}
              description={link.description}
              href={link.href}
              icon={<LaunchOutlined sx={{ fontSize: 13 }} />}
            />
          ))}
        </Section>

        <Section title="Contribute">
          <LinkRow
            label="Report a problem"
            description="Open an issue against this Workbench."
            href={repo.issuesUrl}
            icon={<BugReportOutlined sx={{ fontSize: 13 }} />}
          />
          <LinkRow
            label="Discussions"
            description="Ask a question, or propose something."
            href={repo.discussionsUrl}
            icon={<ForumOutlined sx={{ fontSize: 13 }} />}
          />
          <LinkRow
            label="Security policy"
            description="How to report a vulnerability privately."
            href={repo.securityUrl}
            icon={<SecurityOutlined sx={{ fontSize: 13 }} />}
          />
        </Section>
      </Box>

      {/*
        Who the Workbench is acting as.

        Here because the commonest confusion these links produce is a 404 on a
        private repository that reads as a broken link and is really "you are
        signed in as someone else" — or as a service account, whose grants are
        not yours. Reported, never enforced: GitHub and GCP decide what a click
        can reach, and nothing in this panel is in that path.
      */}
      <Box
        sx={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 0.75,
          px: 1.25,
          py: 0.75,
          borderTop: `1px solid ${theme.aa.color.border.subtle}`,
          backgroundColor: theme.aa.color.bg.base,
        }}
      >
        <PersonOutlineOutlined
          sx={{ fontSize: 13, mt: '2px', color: theme.aa.color.text.muted }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            title={identity.principal}
            sx={{
              fontSize: 11,
              fontFamily: theme.aa.font.mono,
              color: theme.aa.color.text.secondary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {identity.principal || 'no account detected'}
          </Typography>
          {identity.detail && (
            <Typography
              sx={{
                fontSize: 10,
                lineHeight: 1.35,
                mt: 0.15,
                color: identity.restricted && !identity.member
                  ? theme.aa.color.status.warning
                  : theme.aa.color.text.muted,
              }}
            >
              {identity.detail}
            </Typography>
          )}
        </Box>
        {identity.project && (
          <Chip
            label={identity.project}
            size="small"
            variant="outlined"
            sx={{ height: 17, fontSize: 9.5, flexShrink: 0 }}
          />
        )}
      </Box>
    </Box>
  );
};
