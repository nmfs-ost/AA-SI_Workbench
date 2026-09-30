import { Box, Typography, alpha, keyframes, useTheme } from '@mui/material';

import { levelColor } from './ui';

/**
 * The progression this card exists to make obvious, drawn as a route:
 *
 *     NCEI ── Time range ── EchoData ── Sv ── Bucket
 *    source       L0           L1       L2A     GCS
 *
 * Before a run, each stop lights up as the card gains an answer for it; during
 * a run, as the tools reach it. It is the one picture a person watching a demo
 * should leave with: raw data in, a well-defined asset out, in a known place.
 */

export type NodeState = 'idle' | 'ready' | 'active' | 'done' | 'failed' | 'off';

export interface RouteNode {
  label: string;
  level: string;
  state: NodeState;
  title?: string;
}

const pulse = keyframes`
  0% { box-shadow: 0 0 0 0 var(--pulse); }
  70% { box-shadow: 0 0 0 6px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
`;

export function LifecycleRoute({ nodes }: { nodes: RouteNode[] }) {
  const theme = useTheme();
  const c = theme.aa.color;

  const dotColor = (node: RouteNode): string => {
    switch (node.state) {
      case 'done':
      case 'ready':
        return levelColor(theme, node.level) === c.text.muted ? c.accent.main : levelColor(theme, node.level);
      case 'active':
        return c.accent.main;
      case 'failed':
        return c.status.error;
      default:
        return c.border.strong;
    }
  };

  return (
    <Box
      role="list"
      aria-label="From source data to an asset in the bucket"
      sx={{ display: 'flex', alignItems: 'flex-start', px: 0.5 }}
    >
      {nodes.map((node, i) => {
        const color = dotColor(node);
        const lit = node.state === 'done' || node.state === 'ready' || node.state === 'active';
        const next = nodes[i + 1];
        const lineLit = lit && next && next.state !== 'idle' && next.state !== 'off';
        return (
          <Box
            key={node.label}
            role="listitem"
            title={node.title}
            sx={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              position: 'relative',
              opacity: node.state === 'off' ? 0.45 : 1,
            }}
          >
            {/* The line to the next stop, drawn from this dot's centre. */}
            {next && (
              <Box
                sx={{
                  position: 'absolute',
                  top: 5,
                  left: '50%',
                  width: '100%',
                  height: '1px',
                  backgroundColor: lineLit ? alpha(c.accent.main, 0.55) : c.border.subtle,
                  transition: 'background-color .3s',
                }}
              />
            )}
            <Box
              sx={{
                position: 'relative',
                width: 11,
                height: 11,
                borderRadius: '50%',
                boxSizing: 'border-box',
                border: `1.5px solid ${color}`,
                backgroundColor:
                  node.state === 'done' || node.state === 'ready'
                    ? color
                    : c.bg.panel,
                transition: 'all .3s',
                '--pulse': alpha(c.accent.main, 0.5),
                ...(node.state === 'active' && {
                  animation: `${pulse} 1.6s ease-out infinite`,
                  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                }),
              }}
            />
            <Typography
              sx={{
                mt: 0.6,
                fontSize: 10.5,
                fontWeight: lit ? 600 : 500,
                color: lit ? c.text.primary : c.text.muted,
                whiteSpace: 'nowrap',
                lineHeight: 1.2,
              }}
            >
              {node.label}
            </Typography>
            <Typography
              sx={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.05em',
                color: lit ? levelColor(theme, node.level) : c.text.disabled,
                lineHeight: 1.4,
              }}
            >
              {node.level || 'source'}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}
