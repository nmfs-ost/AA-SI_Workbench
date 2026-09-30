import { useEffect, useState } from 'react';
import {
  Box,
  ButtonBase,
  Collapse,
  InputAdornment,
  TextField,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import { ErrorOutlineRounded, WarningAmberRounded } from '@mui/icons-material';

import { compactFieldSx } from '../panelStyles';
import { formatBytes } from '../ncei/nceiService';
import type { PlanFile, RangePlan } from './plan';
import { extentOf, formatDuration, formatUtc, parseUtc } from './plan';
import { Timeline } from './Timeline';
import { Note } from './ui';

interface Props {
  files: readonly PlanFile[];
  start: string;
  end: string;
  plan: RangePlan | null;
  gapSeconds: number;
  gapFactor: number;
  strict: boolean;
  onRange: (from: number, to: number) => void;
  onText: (patch: { start?: string; end?: string }) => void;
}

const PRESETS: { label: string; hours: number }[] = [
  { label: '1 h', hours: 1 },
  { label: '6 h', hours: 6 },
  { label: '12 h', hours: 12 },
  { label: '24 h', hours: 24 },
];

/**
 * Step 2: which stretch of the survey.
 *
 * Three ways to say the same thing — drag on the timeline, type the times, or
 * take a preset length from the current start — because a demo wants the
 * first and an analyst the second. Whatever the input, the answer underneath
 * is the same: how many files, how much data, what they span, and any gap the
 * combine would bridge.
 */
export function RangeStep({
  files,
  start,
  end,
  plan,
  gapSeconds,
  gapFactor,
  strict,
  onRange,
  onText,
}: Props) {
  const theme = useTheme();
  const c = theme.aa.color;
  const [showFiles, setShowFiles] = useState(false);

  const from = parseUtc(start);
  const to = parseUtc(end);
  const extent = extentOf(files);
  const badStart = start !== '' && from === null;
  const badEnd = end !== '' && to === null;
  const inverted = from !== null && to !== null && to <= from;

  // Local drafts, so typing half a time does not fight the parser.
  const [draftStart, setDraftStart] = useState(start);
  const [draftEnd, setDraftEnd] = useState(end);
  useEffect(() => setDraftStart(start), [start]);
  useEffect(() => setDraftEnd(end), [end]);

  const preset = (hours: number) => {
    const a = from ?? extent?.from;
    if (a === undefined || a === null) return;
    onRange(a, a + hours * 3600e3);
  };

  const field = (
    label: string,
    value: string,
    setValue: (v: string) => void,
    key: 'start' | 'end',
    bad: boolean,
  ) => (
    <TextField
      size="small"
      label={label}
      value={value}
      error={bad}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onText({ [key]: value.trim() })}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onText({ [key]: value.trim() });
      }}
      placeholder="YYYY-MM-DD HH:MM"
      InputLabelProps={{ shrink: true }}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <Typography sx={{ fontSize: 9.5, fontWeight: 700, color: c.text.muted }}>UTC</Typography>
          </InputAdornment>
        ),
      }}
      inputProps={{ spellCheck: false, 'aria-label': `${label} (UTC)` }}
      sx={{
        ...compactFieldSx,
        flex: 1,
        minWidth: 0,
        '& .MuiInputBase-input': { fontFamily: theme.aa.font.mono, fontSize: 11.5 },
      }}
    />
  );

  const span = from !== null && to !== null && to > from ? to - from : 0;

  return (
    <Box>
      <Timeline
        files={files}
        from={from}
        to={to}
        plan={plan}
        gapSeconds={gapSeconds}
        gapFactor={gapFactor}
        onChange={onRange}
      />

      <Box sx={{ display: 'flex', gap: 1, mt: 1.25 }}>
        {field('From', draftStart, setDraftStart, 'start', badStart)}
        {field('To', draftEnd, setDraftEnd, 'end', badEnd || inverted)}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.9, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: 10.5, color: c.text.muted, mr: 0.25 }}>Length</Typography>
        {PRESETS.map((p) => {
          const active = span === p.hours * 3600e3;
          return (
            <ButtonBase
              key={p.label}
              onClick={() => preset(p.hours)}
              sx={{
                px: 0.9,
                height: 20,
                borderRadius: 10,
                fontSize: 10.5,
                fontWeight: 600,
                fontFamily: theme.aa.font.ui,
                color: active ? c.accent.main : c.text.secondary,
                backgroundColor: active ? c.accent.soft : 'transparent',
                border: `1px solid ${active ? alpha(c.accent.main, 0.5) : c.border.subtle}`,
                '&:hover': { borderColor: c.accent.main, color: c.text.primary },
              }}
            >
              {p.label}
            </ButtonBase>
          );
        })}
        {extent && (
          <ButtonBase
            onClick={() => onRange(extent.from, extent.to)}
            sx={{
              px: 0.9,
              height: 20,
              borderRadius: 10,
              fontSize: 10.5,
              fontWeight: 600,
              fontFamily: theme.aa.font.ui,
              color: c.text.secondary,
              border: `1px solid ${c.border.subtle}`,
              '&:hover': { borderColor: c.accent.main, color: c.text.primary },
            }}
          >
            Whole survey
          </ButtonBase>
        )}
      </Box>

      {/* What the range means */}
      <Box sx={{ mt: 1.25 }}>
        {badStart || badEnd ? (
          <Note tone="error" icon={<ErrorOutlineRounded className="note-icon" />}>
            Write times as <b>2016-07-03 06:00</b> (UTC).
          </Note>
        ) : inverted ? (
          <Note tone="error" icon={<ErrorOutlineRounded className="note-icon" />}>
            The range ends before it starts.
          </Note>
        ) : !plan ? (
          from !== null && to !== null ? (
            <Note tone="warning" icon={<WarningAmberRounded className="note-icon" />}>
              No files cover this range: the ship was not logging, or it lies outside the
              survey ({extent ? `${formatUtc(extent.from, false)} – ${formatUtc(extent.to, false)}` : 'no files'}).
            </Note>
          ) : null
        ) : (
          <Box
            sx={{
              borderRadius: `${theme.aa.radius.md}px`,
              border: `1px solid ${c.border.subtle}`,
              backgroundColor: alpha(c.text.primary, 0.02),
              overflow: 'hidden',
            }}
          >
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', px: 1.1, py: 0.9 }}>
              <Figure value={String(plan.files.length)} label={plan.files.length === 1 ? 'raw file' : 'raw files'} />
              <Figure value={formatBytes(plan.bytes)} label="to fetch" />
              <Figure value={formatDuration(span / 1000)} label="of survey" />
            </Box>
            <Box
              sx={{
                px: 1.1,
                py: 0.7,
                borderTop: `1px solid ${c.border.subtle}`,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
              }}
            >
              <Typography sx={{ fontSize: 10.5, color: c.text.muted, flex: 1, minWidth: 0 }}>
                Files span{' '}
                <Box component="span" sx={{ fontFamily: theme.aa.font.mono, color: c.text.secondary }}>
                  {formatUtc(plan.coverFrom).slice(11)}
                </Box>
                {plan.coverTo - plan.coverFrom > 86400e3 ? ' … ' : ' – '}
                <Box component="span" sx={{ fontFamily: theme.aa.font.mono, color: c.text.secondary }}>
                  {plan.coverTo - plan.coverFrom > 86400e3
                    ? formatUtc(plan.coverTo).slice(0, 16)
                    : formatUtc(plan.coverTo).slice(11)}
                </Box>
                {plan.cadenceSeconds > 0 && ` · a file every ${formatDuration(plan.cadenceSeconds)}`}
              </Typography>
              <ButtonBase
                onClick={() => setShowFiles((v) => !v)}
                sx={{ fontSize: 10.5, color: c.accent.main, fontFamily: theme.aa.font.ui, fontWeight: 600 }}
              >
                {showFiles ? 'Hide files' : 'Show files'}
              </ButtonBase>
            </Box>
            <Collapse in={showFiles} unmountOnExit>
              <Box
                sx={{
                  maxHeight: 160,
                  overflowY: 'auto',
                  borderTop: `1px solid ${c.border.subtle}`,
                  py: 0.5,
                }}
              >
                {plan.files.map((f) => (
                  <Box
                    key={f.name}
                    sx={{ display: 'flex', px: 1.1, height: 20, alignItems: 'center', gap: 1 }}
                  >
                    <Typography sx={{ fontFamily: theme.aa.font.mono, fontSize: 10.5, color: c.text.secondary, flex: 1 }}>
                      {f.name}
                    </Typography>
                    <Typography sx={{ fontSize: 10, color: c.text.muted }}>
                      {formatBytes(f.sizeBytes)}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Collapse>
          </Box>
        )}
        {plan && plan.gaps.length > 0 && (
          <Box sx={{ mt: 1 }}>
            <Note tone="warning" icon={<WarningAmberRounded className="note-icon" />}>
              {plan.gaps.length === 1 ? 'A gap' : `${plan.gaps.length} gaps`} in logging (
              {plan.gaps.map((g) => formatDuration(g.seconds)).join(', ')}).{' '}
              {strict
                ? 'Strict QC is on, so the combine will stop at it. Narrow the range, or turn strict off under Advanced.'
                : 'The combine will bridge it and record it in the QC report; binned products should not average across it.'}
            </Note>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  const theme = useTheme();
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        sx={{
          fontSize: 15,
          fontWeight: 600,
          color: theme.aa.color.text.primary,
          lineHeight: 1.2,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </Typography>
      <Typography sx={{ fontSize: 10, color: theme.aa.color.text.muted }}>{label}</Typography>
    </Box>
  );
}
