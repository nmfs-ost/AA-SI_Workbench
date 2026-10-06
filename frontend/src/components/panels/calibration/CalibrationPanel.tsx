import { useEffect, useState } from 'react';
import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputBase,
  MenuItem,
  Select,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  PlayArrowRounded,
  RefreshOutlined,
  RestartAltOutlined,
  SaveOutlined,
  ScienceOutlined,
} from '@mui/icons-material';

import type { CalibrationValue } from '../../../services/echoviewApi';
import { useLayout } from '../../../context/LayoutContext';
import { useActiveSubject } from '../../../state/activeSubject';
import {
  FILE_WIDE,
  computeSv,
  editCount,
  loadCalibration,
  resetEdits,
  saveEcs,
  setChannel,
  setValue,
  useCalibration,
} from '../../../state/calibration';
import { PanelBar, PanelHeader } from '../PanelHeader';
import { PanelPlaceholder } from '../PanelPlaceholder';
import { HashTag } from '../products/ProductBits';

const EK80 = /EK80|ES80|EA640/i;

/**
 * Calibration: the values echopype will use to compute Sv from the selected
 * EchoData, channel by channel, read from echopype itself (aa-ecs). Change
 * them and save an Echoview calibration supplement (.ECS) beside the data;
 * compute Sv with it and the ECS is an input of the Sv, in its hash. Start
 * from the file's own values or from any ECS already saved.
 */
export const CalibrationPanel: FunctionComponent<IDockviewPanelProps> = () => {
  const theme = useTheme();
  const c = theme.aa.color;
  const subject = useActiveSubject();
  const s = useCalibration();
  const { openPanel } = useLayout();
  const [label, setLabel] = useState('cal');

  const uri = subject?.uri.startsWith('gs://') ? subject.uri : '';

  useEffect(() => {
    if (uri && uri !== s.subject) void loadCalibration(uri);
    // Only a new selection reloads; the same one keeps its edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  const report = s.report;
  const channel = report?.channels[s.channel];
  const edits = channel ? (s.edits[String(channel.frequency)] ?? {}) : {};
  const edited = editCount(s.edits);
  const ecsFile = s.files.find((f) => f.uri === s.ecs);
  // EK80 data needs its modes before echopype can say anything, so the
  // selects show when the report asks for them too.
  const ek80 = report ? EK80.test(report.sonarModel) : /waveform_mode|encode_mode/.test(s.error);

  if (!uri) {
    return (
      <Shell>
        <PanelPlaceholder
          icon={ScienceOutlined}
          title="No EchoData selected"
          description="Select an EchoData (or an Sv made from one) in Products to see the calibration echopype will use, change it, and save it as an ECS file."
        />
      </Shell>
    );
  }

  const groups: { title: string; note: string; values: CalibrationValue[] }[] = channel
    ? [
        {
          title: 'Transducer',
          note: 'Per channel.',
          values: channel.values.filter((v) => v.group === 'cal'),
        },
        {
          title: 'Environment',
          note: 'Temperature, salinity, pressure and pH are one value for every channel.',
          values: channel.values.filter((v) => v.group === 'env'),
        },
      ]
    : [];

  return (
    <Shell>
      <PanelHeader
        icon={<ScienceOutlined className="panel-header-icon" />}
        title="Calibration"
        subtitle={<span title={s.echodata || uri}>{(s.echodata || uri).split('/').pop()}</span>}
        actions={
          <Tooltip title="Read it again">
            <span>
              <IconButton size="small" disabled={s.loading} onClick={() => void loadCalibration(uri)}>
                <RefreshOutlined sx={{ fontSize: 15 }} />
              </IconButton>
            </span>
          </Tooltip>
        }
      />

      <PanelBar sx={{ gap: 1 }}>
        <Typography sx={{ fontSize: 11.5, color: c.text.secondary, flexShrink: 0 }}>Start from</Typography>
        <Select
          size="small"
          variant="standard"
          disableUnderline
          value={s.ecs}
          displayEmpty
          onChange={(e) => void loadCalibration(uri, { ecs: String(e.target.value) })}
          inputProps={{ 'aria-label': 'Start from' }}
          sx={{ fontSize: 12, flex: 1, minWidth: 0 }}
          renderValue={(v) => (v ? (ecsFile?.label ? `${ecsFile.label} · ` : '') + String(v).split('/').pop() : 'The file’s own values')}
        >
          <MenuItem value="" dense sx={{ fontSize: 12 }}>
            The file’s own values
          </MenuItem>
          {s.files.map((f) => (
            <MenuItem key={f.uri} value={f.uri} dense sx={{ fontSize: 12, display: 'flex', gap: 1 }}>
              <span style={{ flex: 1 }}>{f.name}</span>
              <span style={{ color: c.text.muted, fontSize: 11 }}>
                {f.createdAt.slice(0, 16).replace('T', ' ')}
                {f.createdBy ? ` · ${f.createdBy}` : ''}
              </span>
            </MenuItem>
          ))}
        </Select>
        {ek80 && (
          <>
            <Select
              size="small"
              variant="standard"
              disableUnderline
              value={s.waveformMode || report?.waveformMode || ''}
              displayEmpty
              renderValue={(v) => (v ? String(v) : 'Waveform')}
              onChange={(e) => void loadCalibration(uri, { waveformMode: String(e.target.value) })}
              inputProps={{ 'aria-label': 'Waveform mode' }}
              sx={{ fontSize: 12 }}
            >
              {['CW', 'BB'].map((m) => (
                <MenuItem key={m} value={m} dense sx={{ fontSize: 12 }}>
                  {m}
                </MenuItem>
              ))}
            </Select>
            <Select
              size="small"
              variant="standard"
              disableUnderline
              value={s.encodeMode || report?.encodeMode || ''}
              displayEmpty
              renderValue={(v) => (v ? String(v) : 'Encoding')}
              onChange={(e) => void loadCalibration(uri, { encodeMode: String(e.target.value) })}
              inputProps={{ 'aria-label': 'Encode mode' }}
              sx={{ fontSize: 12 }}
            >
              {['complex', 'power'].map((m) => (
                <MenuItem key={m} value={m} dense sx={{ fontSize: 12 }}>
                  {m}
                </MenuItem>
              ))}
            </Select>
          </>
        )}
      </PanelBar>

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {s.loading && (
          <Box sx={{ p: 1.5, display: 'flex', gap: 1, alignItems: 'flex-start' }}>
            <CircularProgress size={14} sx={{ mt: '2px' }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 12, color: c.text.secondary }}>
                Reading the calibration from echopype. The first time, the EchoData is fetched.
              </Typography>
              {s.progress && (
                <Typography sx={{ fontSize: 10.5, color: c.text.muted, fontFamily: theme.aa.font.mono }} noWrap>
                  {s.progress}
                </Typography>
              )}
            </Box>
          </Box>
        )}
        {s.error && <Typography sx={{ p: 1.5, fontSize: 12, color: c.status.warning, whiteSpace: 'pre-wrap' }}>{s.error}</Typography>}

        {report && channel && (
          <>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, px: 1.25, pt: 1 }}>
              {report.channels.map((ch, i) => {
                const n = Object.keys(s.edits[String(ch.frequency)] ?? {}).length;
                const on = i === s.channel;
                return (
                  <Box
                    key={ch.channel}
                    component="button"
                    onClick={() => setChannel(i)}
                    title={ch.channel}
                    sx={{
                      all: 'unset',
                      cursor: 'pointer',
                      fontSize: 11.5,
                      px: 1,
                      py: 0.3,
                      borderRadius: `${theme.aa.radius.md}px`,
                      border: `1px solid ${on ? c.accent.main : c.border.subtle}`,
                      backgroundColor: on ? alpha(c.accent.main, 0.12) : 'transparent',
                      color: on ? c.text.primary : c.text.secondary,
                    }}
                  >
                    {ch.frequency / 1000} kHz{n ? ` · ${n}` : ''}
                  </Box>
                );
              })}
            </Box>
            <Typography sx={{ px: 1.25, pt: 0.75, fontSize: 10.5, color: c.text.muted }}>
              {report.sonarModel}
              {report.waveformMode ? ` · ${report.waveformMode}` : ''}
              {report.encodeMode ? ` · ${report.encodeMode}` : ''} · values used{' '}
              {report.source === 'ecs' ? 'from the ECS' : 'from the file'} · {channel.channel}
            </Typography>

            {groups.map((g) => (
              <Box key={g.title} sx={{ px: 1.25, pt: 1.25 }}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.25 }}>
                  <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: c.text.primary }}>{g.title}</Typography>
                  <Typography sx={{ fontSize: 10.5, color: c.text.muted }}>{g.note}</Typography>
                </Box>
                <Box
                  component="table"
                  sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, tableLayout: 'fixed' }}
                >
                  <Box component="thead">
                    <Box component="tr" sx={{ color: c.text.muted, fontSize: 10.5 }}>
                      <Box component="th" sx={{ textAlign: 'left', fontWeight: 500, py: 0.25 }} />
                      <Box component="th" sx={{ textAlign: 'right', fontWeight: 500, width: '17%' }}>
                        In file
                      </Box>
                      <Box component="th" sx={{ textAlign: 'right', fontWeight: 500, width: '17%' }}>
                        Used
                      </Box>
                      <Box component="th" sx={{ textAlign: 'right', fontWeight: 500, width: '21%', pr: 0.5 }}>
                        New
                      </Box>
                    </Box>
                  </Box>
                  <Box component="tbody">
                    {g.values.map((v) => (
                      <ValueRow
                        key={v.name}
                        value={v}
                        typed={edits[v.name] ?? ''}
                        onType={(text) => setValue(channel.frequency, v.name, text)}
                      />
                    ))}
                  </Box>
                </Box>
              </Box>
            ))}
            <Typography sx={{ px: 1.25, py: 1.25, fontSize: 10.5, color: c.text.muted, lineHeight: 1.5 }}>
              “Used” is what echopype computes Sv with: the file’s values, or the ECS’s where it sets
              them (highlighted). Saving writes every value of every channel to a new ECS; echopype
              and Echoview both read it.
            </Typography>
          </>
        )}
      </Box>

      {report && (
        <Box
          sx={{
            borderTop: `1px solid ${c.border.subtle}`,
            backgroundColor: c.bg.chrome,
            p: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.75,
          }}
        >
          {s.ecs && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
              <Typography sx={{ fontSize: 11, color: c.text.secondary, flexShrink: 0 }}>ECS</Typography>
              <Typography sx={{ fontSize: 11, color: c.text.primary, flex: 1, minWidth: 0 }} noWrap title={s.ecs}>
                {s.ecs.split('/').pop()}
              </Typography>
              {ecsFile?.productHash && <HashTag hash={ecsFile.productHash} quiet />}
            </Box>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            <InputBase
              value={label}
              onChange={(e) => setLabel(e.target.value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40))}
              inputProps={{ 'aria-label': 'ECS label' }}
              sx={{
                fontSize: 12,
                width: 90,
                px: 0.75,
                border: `1px solid ${c.border.subtle}`,
                borderRadius: `${theme.aa.radius.sm}px`,
              }}
            />
            <Tooltip
              disableInteractive
              placement="top"
              title="Write the values used, with your changes, as a new ECS file beside the EchoData"
            >
              <span>
                <Button
                  size="small"
                  variant={edited ? 'contained' : 'outlined'}
                  disableElevation
                  startIcon={s.saving ? <CircularProgress size={12} /> : <SaveOutlined sx={{ fontSize: 15 }} />}
                  disabled={s.saving || !label}
                  onClick={() => void saveEcs(label)}
                  sx={{ fontSize: 11.5, textTransform: 'none' }}
                >
                  Save as ECS{edited ? ` (${edited} changed)` : ''}
                </Button>
              </span>
            </Tooltip>
            {edited > 0 && (
              <Tooltip disableInteractive title="Discard the changes">
                <IconButton size="small" onClick={resetEdits}>
                  <RestartAltOutlined sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            )}
            <Box sx={{ flex: 1 }} />
            <Tooltip
              disableInteractive
              placement="top"
              title={
                !s.ecs
                  ? 'Save an ECS (or start from one) to compute Sv with it.'
                  : edited
                    ? 'Save the changes first: Sv is computed with a saved ECS.'
                    : 'Run aa-sv --ecs on the EchoData (it shows in Pipelines)'
              }
            >
              <span>
                <Button
                  size="small"
                  startIcon={s.computing ? <CircularProgress size={12} /> : <PlayArrowRounded sx={{ fontSize: 16 }} />}
                  disabled={!s.ecs || edited > 0 || s.computing}
                  onClick={async () => {
                    if (await computeSv()) openPanel('pipelines');
                  }}
                  sx={{ fontSize: 11.5, textTransform: 'none' }}
                >
                  Compute Sv
                </Button>
              </span>
            </Tooltip>
          </Box>
          {(s.saveError || s.computeError) && (
            <Typography sx={{ fontSize: 11, color: c.status.error }}>{s.saveError || s.computeError}</Typography>
          )}
        </Box>
      )}
    </Shell>
  );
};

function Shell({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        backgroundColor: theme.aa.color.bg.panel,
      }}
    >
      {children}
    </Box>
  );
}

function show(v: number | string | null): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return v;
  if (!Number.isFinite(v)) return '—';
  // Six significant digits, no padding: 0.0098, 26.12, 1500 (the full value
  // is in the cell's title).
  return String(Number(v.toPrecision(6)));
}

const num = {
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  pl: 0.5,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

function ValueRow({
  value: v,
  typed,
  onType,
}: {
  value: CalibrationValue;
  typed: string;
  onType: (text: string) => void;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  const bad = typed !== '' && !Number.isFinite(Number(typed));
  const editable = typeof v.used === 'number' || v.used === null;
  return (
    <Box component="tr" sx={{ '&:hover': { backgroundColor: c.bg.hover } }}>
      <Box
        component="td"
        sx={{ py: 0.3, pr: 0.5, color: c.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={`${v.name}${v.ecs ? ` (ECS: ${v.ecs})` : ''}${FILE_WIDE.has(v.name) ? ' — the same for every channel' : ''}`}
      >
        {v.label}
        {v.unit && (
          <Box component="span" sx={{ color: c.text.muted, ml: 0.5, fontSize: 10.5 }}>
            {v.unit}
          </Box>
        )}
      </Box>
      <Box component="td" title={String(v.file ?? '')} sx={{ ...num, color: c.text.secondary }}>
        {show(v.file)}
      </Box>
      <Box
        component="td"
        title={String(v.used ?? '')}
        sx={{
          ...num,
          color: v.changed ? c.accent.main : c.text.secondary,
          fontWeight: v.changed ? 600 : 400,
        }}
      >
        {show(v.used)}
      </Box>
      <Box component="td" sx={{ textAlign: 'right', pl: 0.5, pr: 0.5 }}>
        {editable && (
          <InputBase
            value={typed}
            placeholder={show(v.used)}
            onChange={(e) => onType(e.target.value)}
            inputProps={{ 'aria-label': `New ${v.label}`, inputMode: 'decimal', style: { textAlign: 'right' } }}
            sx={{
              fontSize: 11.5,
              width: '100%',
              px: 0.5,
              borderRadius: `${theme.aa.radius.sm}px`,
              border: `1px solid ${bad ? c.status.error : typed ? c.accent.main : 'transparent'}`,
              backgroundColor: typed ? alpha(c.accent.main, 0.08) : 'transparent',
              '&:hover': { borderColor: bad ? c.status.error : c.border.subtle },
              '& input::placeholder': { color: c.text.disabled, opacity: 1 },
            }}
          />
        )}
      </Box>
    </Box>
  );
}
