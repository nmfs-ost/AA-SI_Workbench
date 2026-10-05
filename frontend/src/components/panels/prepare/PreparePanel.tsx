import { useEffect, useMemo, useState } from 'react';
import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { Box, Button, CircularProgress, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import { CallMergeRounded, ErrorOutlineRounded, PlayArrowRounded } from '@mui/icons-material';

import { useLayout } from '../../../context/LayoutContext';
import { setActiveArtifact } from '../../../state/activeSubject';
import { revealInDerived } from '../../../state/derivedReveal';
import {
  buildRequest,
  currentPlan,
  dismissRun,
  initPrepare,
  setRange,
  startRun,
  update,
  usePrepare,
} from '../../../state/prepare';
import type { PrepareState } from '../../../state/prepare';
import type { Asset, RunStatus, StageStatus } from '../../../services/baselineApi';
import { BASELINE_SIMULATED } from '../../../services/baselineApi';
import { AdvancedSection } from './AdvancedSection';
import { CommandsSection } from './CommandsSection';
import { DestinationStep } from './DestinationStep';
import type { PlannedFile } from './DestinationStep';
import { LifecycleRoute } from './LifecycleRoute';
import type { NodeState, RouteNode } from './LifecycleRoute';
import { ProductsStep } from './ProductsStep';
import { RangeStep } from './RangeStep';
import { RunView } from './RunView';
import { SourceStep } from './SourceStep';
import { WorkspaceStep, formatSize, useWorkspace } from './WorkspaceStep';
import { baseProblem, defaultBase, destinationUri, formatDuration, parseUtc } from './plan';
import { Disclosure, Note, Step } from './ui';

/**
 * Prepare EchoData — the baseline operation, as a first-class workflow.
 *
 *     NCEI survey → time range → EchoData (L1, + Sv L2A) → project bucket
 *
 * This is the one operation almost everything else starts from, and the card
 * is built so that doing it takes no knowledge of the console tools: choose a
 * survey, choose a stretch of time, press the button. The files that stretch
 * needs, the order of the tools, their flags, where the products go and what
 * they are called are the card's business, and it shows each of them rather
 * than hiding them — the exact commands are one click away, and every product
 * carries the tools' provenance.
 *
 * What the card deliberately does not offer is the tools' full option space.
 * The Pipelines panel is where arbitrary chains live; this is the one chain
 * that should be the same every time, so its few real choices are named for
 * what they mean and the rest are fixed.
 *
 * The run itself happens on the server (api/baseline.py), one ordinary job per
 * tool, so it survives this tab closing and every stage appears in the
 * Processing Queue with its log. The card re-attaches to a running run.
 */
export const PreparePanel: FunctionComponent<IDockviewPanelProps> = () => {
  const theme = useTheme();
  const c = theme.aa.color;
  const s = usePrepare();
  const { openPanel } = useLayout();
  const [advanced, setAdvanced] = useState(false);
  const [commands, setCommands] = useState(false);

  useEffect(() => initPrepare(), []);

  const plan = useMemo(
    () => currentPlan(s),
    // The plan depends on these fields only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.files, s.start, s.end, s.gapSeconds, s.gapFactor],
  );

  const from = parseUtc(s.start);
  const to = parseUtc(s.end);
  const rangeOk = from !== null && to !== null && to > from;
  const named =
    s.survey && s.sonar && rangeOk ? defaultBase(s.survey.id, s.sonar.id, from!, to!) : '';
  const base = s.base.trim() || named;
  const baseError = baseProblem(s.base.trim());
  const bucket = s.bucket.trim() || s.config?.bucket || '';
  const folder =
    bucket && base && s.vessel && s.survey
      ? destinationUri(bucket, s.config?.user ?? '', s.vessel.id, s.survey.id, base)
      : '';
  const single = plan?.files.length === 1;
  const sourceReady = Boolean(s.vessel && s.survey && s.sonar && s.files.length);

  const planned: PlannedFile[] = base
    ? [
        { name: `${base}.${single ? 'nc' : s.format}`, kind: 'echodata', level: 'L1',
          what: 'The EchoData asset (aa-combine)' },
        ...(single ? [] : [{ name: `${base}.qc.json`, kind: 'report' as const, level: '',
          what: "aa-combine's QC report: gaps, overlaps, calibration changes" }]),
        ...(s.sv ? [{ name: `${base}_‹recipe›.nc`, kind: 'sv' as const, level: 'L2A',
          what: 'Sv (aa-sv); ‹recipe› names the processing' }] : []),
        ...(s.sv && s.echogram ? [{ name: `${base}_‹recipe›.png`, kind: 'echogram' as const,
          level: 'L2A', what: 'Echogram of that Sv (aa-graph)' }] : []),
        { name: `${base}.yaml`, kind: 'request', level: '',
          what: 'The request that defined the data (aa-request)' },
      ]
    : [];

  const request = plan && sourceReady && !baseError ? buildRequest(s, plan) : null;
  const space = useWorkspace(request);
  const ws = space.workspace;
  const blocker = whyNot(s, {
    rangeOk,
    plan: Boolean(plan),
    baseError,
    bucket,
    gaps: plan?.gaps.length ?? 0,
    workspaceProblem: space.error || ws?.problem || '',
  });

  const inspect = (asset: Asset) => {
    const label = asset.uri.replace(/\/$/, '').split('/').pop() ?? asset.uri;
    setActiveArtifact({ uri: asset.uri, label, origin: 'Prepare' });
    openPanel('metadata');
  };
  const reveal = (asset: Asset) => {
    revealInDerived(asset.uri);
    openPanel('derived');
  };

  const nodes: RouteNode[] = s.run
    ? runNodes(s.run)
    : [
        { label: 'NCEI', level: '', state: sourceReady ? 'ready' : 'idle', title: 'Source: the NCEI water-column archive' },
        { label: 'Time range', level: 'L0', state: plan ? 'ready' : 'idle', title: 'Retrieve the raw files that cover the range' },
        { label: 'EchoData', level: 'L1', state: plan ? 'ready' : 'idle', title: 'Convert and combine into one EchoData' },
        { label: 'Sv', level: 'L2A', state: !s.sv ? 'off' : plan ? 'ready' : 'idle', title: 'Calibrate: volume backscattering strength' },
        { label: 'Bucket', level: 'GCS', state: request && folder ? 'ready' : 'idle', title: 'Stored in the project bucket, provenance attached' },
      ];

  // request, fetch, convert and record always; combine unless one file.
  const toolCount = 4 + (single ? 0 : 1) + (s.sv ? 1 : 0) + (s.sv && s.echogram ? 1 : 0);
  const products = ['EchoData', s.sv && 'Sv', s.sv && s.echogram && 'echogram'].filter(Boolean).join(' + ');

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        backgroundColor: c.bg.panel,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.25,
          height: 32,
          flexShrink: 0,
          borderBottom: `1px solid ${c.border.subtle}`,
        }}
      >
        <CallMergeRounded sx={{ fontSize: 15, color: c.accent.main }} />
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: c.text.primary }}>
          Prepare EchoData
        </Typography>
        {BASELINE_SIMULATED && (
          <Tooltip title="The Workbench is running on sample data: runs are simulated and nothing is fetched or written. aa-workbench build turns on the real API.">
            <Box
              sx={{
                ml: 'auto',
                px: 0.75,
                height: 17,
                display: 'flex',
                alignItems: 'center',
                borderRadius: 9,
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: '0.04em',
                color: c.status.warning,
                backgroundColor: alpha(c.status.warning, 0.12),
              }}
            >
              SAMPLE DATA
            </Box>
          </Tooltip>
        )}
      </Box>

      {/* Body */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <Box sx={{ px: 1.5, pt: 1.5, pb: 1.75 }}>
          <Typography sx={{ fontSize: 11.5, color: c.text.secondary, lineHeight: 1.55, mb: 1.5 }}>
            A stretch of an NCEI survey, made into one EchoData asset in the project bucket, ready
            for what comes next.
          </Typography>
          <LifecycleRoute nodes={nodes} />
        </Box>

        {s.configError && !s.run && (
          <Box sx={{ px: 1.5, pb: 1.25 }}>
            <Note tone="error" icon={<ErrorOutlineRounded className="note-icon" />}>
              {s.configError}
            </Note>
          </Box>
        )}
        {s.config && !s.config.ready && !s.run && (
          <Box sx={{ px: 1.5, pb: 1.25 }}>
            <Note tone="warning" icon={<ErrorOutlineRounded className="note-icon" />}>
              {s.config.problems.map((p) => (
                <div key={p}>{p}</div>
              ))}
            </Note>
          </Box>
        )}
        {s.catalogError && !s.run && (
          <Box sx={{ px: 1.5, pb: 1.25 }}>
            <Note tone="error" icon={<ErrorOutlineRounded className="note-icon" />}>
              {s.catalogError}
            </Note>
          </Box>
        )}

        {s.run ? (
          <Box sx={{ px: 1.5, pb: 2, borderTop: `1px solid ${c.border.subtle}`, pt: 1.5 }}>
            <RunView
              run={s.run}
              runError={s.runError}
              onInspect={inspect}
              onReveal={reveal}
              onQueue={() => openPanel('processingQueue')}
              onDone={dismissRun}
              onAgain={() => void startRun(s.run!.request)}
            />
          </Box>
        ) : (
          <>
            <Box sx={{ px: 1.5, pt: 1.5, borderTop: `1px solid ${c.border.subtle}` }}>
              <Step
                n={1}
                title="Source"
                done={sourceReady}
                summary={s.survey && s.sonar ? `NCEI · ${s.survey.id} · ${s.sonar.id}` : 'NCEI'}
              >
                <SourceStep s={s} />
              </Step>
              <Step
                n={2}
                title="Time range"
                done={Boolean(plan)}
                summary={rangeOk ? `${formatDuration((to! - from!) / 1000)} · UTC` : undefined}
              >
                {s.files.length > 0 ? (
                  <RangeStep
                    files={s.files}
                    start={s.start}
                    end={s.end}
                    plan={plan}
                    gapSeconds={s.gapSeconds}
                    gapFactor={s.gapFactor}
                    strict={s.strict}
                    onRange={setRange}
                    onText={update}
                  />
                ) : (
                  <Typography sx={{ fontSize: 11, color: c.text.muted }}>
                    {s.loading.files ? 'Listing raw files…' : 'Choose a survey first.'}
                  </Typography>
                )}
              </Step>
              <Step n={3} title="Products" done={Boolean(plan)} summary={products}>
                <ProductsStep
                  sv={s.sv}
                  echogram={s.echogram}
                  format={s.format}
                  single={Boolean(single)}
                  onChange={update}
                />
              </Step>
              <Step
                n={4}
                title="Destination"
                done={Boolean(request && folder)}
                summary={bucket ? `gs://${bucket}` : undefined}
              >
                {folder ? (
                  <DestinationStep
                    folder={folder}
                    base={s.base}
                    defaultBase={named}
                    baseError={baseError}
                    files={planned}
                    onBase={(b) => update({ base: b })}
                  />
                ) : (
                  <Typography sx={{ fontSize: 11, color: c.text.muted }}>
                    {bucket ? 'Named once a survey and range are chosen.' : 'Waiting for the Workbench bucket…'}
                  </Typography>
                )}
              </Step>
              <Step
                n={5}
                title="Working space"
                done={Boolean(request && ws && !ws.problem && !space.error)}
                summary={
                  ws && ws.rawBytes > 0
                    ? `${formatSize(ws.needBytes)} of ${formatSize(ws.freeBytes)} free`
                    : undefined
                }
                rail={false}
              >
                {request ? (
                  <WorkspaceStep
                    workspace={ws}
                    error={space.error}
                    busy={space.busy}
                    workRoot={s.workRoot}
                    defaultRoot={ws?.defaultRoot || s.config?.runRoot || ''}
                    freeAsYouGo={s.freeAsYouGo}
                    keepLocal={s.keepLocal}
                    onChange={update}
                  />
                ) : (
                  <Typography sx={{ fontSize: 11, color: c.text.muted }}>
                    Shown once a survey and range are chosen.
                  </Typography>
                )}
              </Step>
            </Box>

            <Box sx={{ mt: 1 }}>
              <Disclosure
                label="Advanced settings"
                hint={s.strict ? 'strict QC' : undefined}
                open={advanced}
                onToggle={() => setAdvanced((v) => !v)}
              >
                <AdvancedSection s={s} bucketDefault={s.config?.bucket ?? ''} />
              </Disclosure>
              <Disclosure
                label="Console commands"
                hint={request ? `${toolCount} tools` : undefined}
                open={commands}
                onToggle={() => setCommands((v) => !v)}
              >
                <CommandsSection request={request} />
              </Disclosure>
            </Box>
          </>
        )}
      </Box>

      {/* The one button */}
      {!s.run && (
        <Box
          sx={{
            flexShrink: 0,
            px: 1.5,
            pt: 1.1,
            pb: 1.4,
            borderTop: `1px solid ${c.border.subtle}`,
            backgroundColor: c.bg.panel,
          }}
        >
          <Typography
            sx={{
              fontSize: 11,
              mb: 0.9,
              minHeight: 16,
              color: blocker ? c.text.muted : c.text.secondary,
              lineHeight: 1.45,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={blocker || (folder ? `Into ${folder}` : '')}
          >
            {blocker ||
              (plan && (
                <>
                  <b>{plan.files.length}</b> raw {plan.files.length === 1 ? 'file' : 'files'} →{' '}
                  {products} → the bucket
                </>
              ))}
          </Typography>
          {s.runError && (
            <Typography sx={{ fontSize: 11, color: c.status.error, mb: 0.75 }}>{s.runError}</Typography>
          )}
          <Button
            fullWidth
            variant="contained"
            disableElevation
            disabled={Boolean(blocker) || s.starting || !request}
            onClick={() => request && void startRun(request)}
            startIcon={
              s.starting ? <CircularProgress size={14} color="inherit" /> : <PlayArrowRounded />
            }
            sx={{ textTransform: 'none', fontSize: 13, fontWeight: 600, height: 34 }}
          >
            Prepare EchoData
          </Button>
        </Box>
      )}
    </Box>
  );
};

/** The first thing standing between the card and a run, in words. '' when ready. */
function whyNot(
  s: PrepareState,
  x: {
    rangeOk: boolean;
    plan: boolean;
    baseError: string;
    bucket: string;
    gaps: number;
    workspaceProblem: string;
  },
): string {
  if (s.configError) return 'The Workbench API is not reachable.';
  if (s.config && !s.config.ready) return 'The console tools this needs are not installed.';
  if (!s.vessel) return 'Choose a vessel to start.';
  if (!s.survey) return 'Choose a survey.';
  if (!s.sonar) return 'Choose an echosounder.';
  if (s.loading.files) return 'Listing the raw files…';
  if (s.files.length === 0) return 'This echosounder has no raw files in NCEI.';
  if (!x.rangeOk) return 'Choose a time range.';
  if (!x.plan) return 'No files cover this time range.';
  if (x.baseError) return x.baseError;
  if (!x.bucket) return 'Waiting for the Workbench bucket…';
  if (s.strict && x.gaps > 0) return 'Strict QC is on and the range has a gap.';
  if (x.workspaceProblem) return `Working space: ${x.workspaceProblem.split('. ')[0].replace(/\.$/, '')}.`;
  return '';
}

function toNode(states: StageStatus['state'][]): NodeState {
  const live = states.filter((st) => st !== 'skipped');
  if (live.length === 0) return 'off';
  if (live.some((st) => st === 'failed')) return 'failed';
  if (live.some((st) => st === 'running')) return 'active';
  if (live.every((st) => st === 'done')) return 'done';
  if (live.some((st) => st === 'done')) return 'active';
  return 'idle';
}

function runNodes(run: RunStatus): RouteNode[] {
  const st = (id: string) => run.stages.find((x) => x.id === id)?.state ?? 'skipped';
  const bucket: NodeState =
    run.state === 'succeeded' ? 'done' : run.state === 'failed' ? 'idle' : toNode([st('record')]);
  return [
    { label: 'NCEI', level: '', state: toNode([st('request')]) },
    { label: 'Time range', level: 'L0', state: toNode([st('fetch')]) },
    { label: 'EchoData', level: 'L1', state: toNode([st('convert'), st('combine')]) },
    { label: 'Sv', level: 'L2A', state: toNode([st('sv'), st('echogram')]) },
    { label: 'Bucket', level: 'GCS', state: bucket },
  ];
}
