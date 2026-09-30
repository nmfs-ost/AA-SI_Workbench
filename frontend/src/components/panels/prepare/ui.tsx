import type { ReactNode } from 'react';
import { Box, Collapse, Typography, alpha, useTheme } from '@mui/material';
import type { Theme } from '@mui/material';
import { CheckRounded, ExpandMoreRounded } from '@mui/icons-material';

/**
 * The small visual vocabulary of the Prepare card, shared by its sections.
 *
 * Levels get a colour each because the card's whole argument is a progression
 * through the Data Roadmap (L0 retrieve → L1 EchoData → L2A calibrated), and a
 * reader should be able to see which level a product or a tool belongs to
 * without reading the label. The colours are the theme's syntax hues, which
 * every theme already tunes for legibility on its own surfaces, so the three
 * themes need nothing of their own here.
 */

export type Level = 'L0' | 'L1' | 'L2A' | 'GCS' | '';

export function levelColor(theme: Theme, level: string): string {
  switch (level) {
    case 'L0':
      return theme.aa.color.syntax.reference;
    case 'L1':
      return theme.aa.color.accent.main;
    case 'L2A':
      return theme.aa.color.syntax.string;
    case 'GCS':
      return theme.aa.color.syntax.entity;
    default:
      return theme.aa.color.text.muted;
  }
}

/** "L1", as a quiet tinted tag. Renders nothing for an unlevelled item. */
export function LevelChip({ level, title }: { level: string; title?: string }) {
  const theme = useTheme();
  if (!level) return null;
  const color = levelColor(theme, level);
  return (
    <Box
      component="span"
      title={title ?? LEVEL_TITLES[level] ?? level}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 16,
        px: 0.6,
        borderRadius: `${theme.aa.radius.sm}px`,
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: '0.03em',
        lineHeight: 1,
        color,
        backgroundColor: alpha(color, 0.12),
        border: `1px solid ${alpha(color, 0.3)}`,
        flexShrink: 0,
        fontFamily: theme.aa.font.ui,
      }}
    >
      {level}
    </Box>
  );
}

export const LEVEL_TITLES: Record<string, string> = {
  L0: 'Level 0 — retrieve raw data and its metadata',
  L1: 'Level 1 — converted to echopype EchoData',
  L2A: 'Level 2A — calibrated (Sv)',
  GCS: 'Stored in the project bucket',
};

interface StepProps {
  n: number;
  title: string;
  /** One line at the right of the title: the step's answer, once it has one. */
  summary?: ReactNode;
  done?: boolean;
  /** False for the last step: no rail below its number. */
  rail?: boolean;
  children: ReactNode;
}

/**
 * One numbered step, with the rail that joins it to the next.
 *
 * The number turns into a tick when the step has an answer, so the column of
 * circles is also a progress read-out: four ticks means the card is ready.
 */
export function Step({ n, title, summary, done = false, rail = true, children }: StepProps) {
  const theme = useTheme();
  const c = theme.aa.color;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '22px 1fr', columnGap: 1.1 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Box
          sx={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10.5,
            fontWeight: 700,
            flexShrink: 0,
            color: done ? c.accent.main : c.text.secondary,
            backgroundColor: done ? c.accent.soft : 'transparent',
            border: `1px solid ${done ? alpha(c.accent.main, 0.6) : c.border.strong}`,
            transition: 'all .2s',
          }}
        >
          {done ? <CheckRounded sx={{ fontSize: 13 }} /> : n}
        </Box>
        {rail && (
          <Box
            sx={{
              flex: 1,
              width: '1px',
              minHeight: 12,
              my: 0.5,
              backgroundColor: done ? alpha(c.accent.main, 0.45) : c.border.subtle,
              transition: 'background-color .2s',
            }}
          />
        )}
      </Box>
      <Box sx={{ minWidth: 0, pb: rail ? 2 : 0.5 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 1,
            minHeight: 20,
            mb: 0.9,
          }}
        >
          <Typography
            sx={{ fontSize: 12.5, fontWeight: 600, color: c.text.primary, lineHeight: '20px' }}
          >
            {title}
          </Typography>
          {summary && (
            <Typography
              component="div"
              sx={{
                ml: 'auto',
                fontSize: 11,
                color: c.text.muted,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {summary}
            </Typography>
          )}
        </Box>
        {children}
      </Box>
    </Box>
  );
}

/** A quiet disclosure row: "Advanced settings ▾". */
export function Disclosure({
  label,
  hint,
  open,
  onToggle,
  children,
}: {
  label: string;
  hint?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  return (
    <Box sx={{ borderTop: `1px solid ${c.border.subtle}` }}>
      <Box
        component="button"
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        sx={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.5,
          py: 0.9,
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          color: c.text.secondary,
          fontFamily: theme.aa.font.ui,
          textAlign: 'left',
          '&:hover': { color: c.text.primary, backgroundColor: c.bg.hover },
          '&:focus-visible': { outline: `1px solid ${c.accent.main}`, outlineOffset: -1 },
        }}
      >
        <ExpandMoreRounded
          sx={{
            fontSize: 16,
            transform: open ? 'none' : 'rotate(-90deg)',
            transition: 'transform .15s',
          }}
        />
        <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: 'inherit' }}>{label}</Typography>
        {hint && (
          <Typography
            component="span"
            sx={{
              ml: 'auto',
              fontSize: 10.5,
              color: c.text.muted,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {hint}
          </Typography>
        )}
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 1.5, pb: 1.5 }}>{children}</Box>
      </Collapse>
    </Box>
  );
}

/** A field's small caption, above it. */
export function Caption({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <Typography
      sx={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: theme.aa.color.text.muted,
        mb: 0.5,
      }}
    >
      {children}
    </Typography>
  );
}

/** A tinted note: info, warning or error, with the words doing the work. */
export function Note({
  tone = 'info',
  icon,
  children,
}: {
  tone?: 'info' | 'warning' | 'error' | 'success';
  icon?: ReactNode;
  children: ReactNode;
}) {
  const theme = useTheme();
  const color = theme.aa.color.status[tone];
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 0.9,
        alignItems: 'flex-start',
        px: 1,
        py: 0.8,
        borderRadius: `${theme.aa.radius.md}px`,
        backgroundColor: alpha(color, 0.09),
        border: `1px solid ${alpha(color, 0.28)}`,
        color: theme.aa.color.text.primary,
        fontSize: 11.5,
        lineHeight: 1.5,
        '& .note-icon': { color, fontSize: 15, mt: '1px', flexShrink: 0 },
      }}
    >
      {icon}
      <Box sx={{ minWidth: 0, flex: 1 }}>{children}</Box>
    </Box>
  );
}

/**
 * A product's file name with its ending kept whole.
 *
 * Every file of an asset starts with the same long name; what tells them apart
 * is the ending (".nc", "_6c1f0e2a.png", ".qc.json"). So the shared start is
 * the part that gives way when space runs out, and the ending never does.
 */
export function FileName({
  name,
  base,
  strong = false,
  size = 10.5,
}: {
  name: string;
  base: string;
  strong?: boolean;
  size?: number;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  const cut = base && name.startsWith(base) ? base.length : 0;
  return (
    <Box
      component="span"
      title={name}
      sx={{
        display: 'flex',
        minWidth: 0,
        fontFamily: theme.aa.font.mono,
        fontSize: size,
        whiteSpace: 'nowrap',
      }}
    >
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, color: c.text.muted }}>
        {name.slice(0, cut)}
      </Box>
      <Box
        component="span"
        sx={{ flexShrink: 0, color: strong ? c.text.primary : c.text.secondary, fontWeight: strong ? 600 : 400 }}
      >
        {name.slice(cut)}
      </Box>
    </Box>
  );
}

/** A gs:// path that wraps at its slashes rather than mid-word. */
export function PathText({ path }: { path: string }) {
  const parts = path.split('/');
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && '/'}
          <wbr />
        </span>
      ))}
    </>
  );
}
