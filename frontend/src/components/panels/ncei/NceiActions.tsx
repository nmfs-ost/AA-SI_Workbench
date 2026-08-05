import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  Collapse,
  FormControlLabel,
  MenuItem,
  Select,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import {
  ExpandLessOutlined,
  ExpandMoreOutlined,
  PlayArrowOutlined,
  TerminalOutlined,
} from '@mui/icons-material';

import { useLayout } from '../../../context/LayoutContext';
import { sendToTerminal } from '../../../state/terminal';
import { formatBytes } from './nceiService';
import { compactFieldSx } from '../panelStyles';
import type { NceiSearchController } from './useNceiSearch';
import {
  OUTPUT_FORMATS,
  combineOptions,
  defaultsFor,
  downloadOptions,
  withFormatExtension,
} from './combineOptions';
import type { OptionDef, OptionValues, OutputFormat } from './combineOptions';
import { findSeams, formatGap } from './seams';
import { SequenceStrip } from './SequenceStrip';
import { useSequence, type SequenceContext } from './useSequence';
import { findMode } from './sequence';
import { StageFlags } from './StageFlags';
import { selectJob, startPolling, stopPolling } from '../../../state/jobs';

interface Props {
  controller: NceiSearchController;
}

type Workflow = 'download' | 'combine';

const MIN_COMBINE_FILES = 2; // echopype.combine_echodata needs at least two

/** One control, chosen by the option's declared type. */
function OptionControl({
  def,
  value,
  onChange,
}: {
  def: OptionDef;
  value: OptionValues[string];
  onChange: (next: OptionValues[string]) => void;
}) {
  const theme = useTheme();
  // Provenance is communicated once, by the group these controls sit in.
  const label = def.label;

  if (def.type === 'boolean') {
    return (
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
        }
        label={
          <Typography sx={{ fontSize: 12 }} component="span">
            {label}
          </Typography>
        }
        sx={{ ml: 0 }}
      />
    );
  }

  if (def.type === 'multi') {
    return (
      <Autocomplete
        multiple
        size="small"
        options={[...(def.options ?? [])]}
        value={(value as string[]) ?? []}
        onChange={(_, next) => onChange(next)}
        renderTags={(tags, getTagProps) =>
          tags.map((tag, index) => (
            <Chip
              size="small"
              label={tag}
              {...getTagProps({ index })}
              key={tag}
              sx={{ fontSize: 11 }}
            />
          ))
        }
        renderInput={(params) => (
          <TextField {...params} label={def.label} helperText={def.help} size="small" />
        )}
      />
    );
  }

  if (def.type === 'enum') {
    return (
      <Box>
        <Typography sx={{ fontSize: 11.5, color: theme.aa.color.text.muted, mb: 0.25 }}>
          {label}
        </Typography>
        <Select
          size="small"
          fullWidth
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          sx={{ fontSize: 12 }}
        >
          {(def.options ?? []).map((option) => (
            <MenuItem key={option} value={option} sx={{ fontSize: 12 }}>
              {option}
            </MenuItem>
          ))}
        </Select>
      </Box>
    );
  }

  return (
    <TextField
      size="small"
      fullWidth
      type={def.type === 'number' ? 'number' : 'text'}
      label={def.label}
      value={String(value ?? '')}
      placeholder={def.placeholder}
      helperText={def.help}
      onChange={(e) =>
        onChange(def.type === 'number' ? Number(e.target.value) : e.target.value)
      }
      InputProps={{ sx: { fontSize: 12 } }}
      InputLabelProps={{ sx: { fontSize: 12 } }}
      FormHelperTextProps={{ sx: { fontSize: 10.5 } }}
    />
  );
}

/**
 * The action area of the NCEI panel: pick a workflow, configure it, run it.
 *
 * Two workflows, both first-class:
 *   • Download files   — fetch each selected raw file as-is.
 *   • Combine dataset  — fetch, convert and merge them into one .nc or .zarr.
 *
 * **Commands are handed to the terminal, not executed in the background.**
 * `aa-get` and `aa-fetch` are interactive console UIs — they prompt, and they
 * expect a human. A job runner would hang on the first question with nobody to
 * answer it. So this composes the exact command, shows it, and types it into
 * the terminal panel where the user stays in control of the conversation.
 *
 * The options themselves live in `combineOptions.ts` as data, so the form is
 * generated rather than written, and adding a flag never touches this file.
 */
export function NceiActions({ controller }: Props) {
  const theme = useTheme();
  const { openPanel } = useLayout();
  const { targetFiles, totalTargetBytes, context, dateFrom, dateTo, selected, selectOnly } =
    controller;
  const count = targetFiles.length;

  const surveyName = context.survey?.name ?? 'survey';
  const sonarName = context.sonar?.name ?? 'sonar';
  const vesselId = context.vessel?.id ?? 'vessel';

  const [workflow, setWorkflow] = useState<Workflow>('download');
  const [format, setFormat] = useState<OutputFormat>('nc');
  const [showAll, setShowAll] = useState(false);
  const [extraFlags, setExtraFlags] = useState('');
  /* Where files land, and where they go afterwards.

     Both were hardcoded — downloads to '.', the publish prefix derived from the
     vessel and survey — which made them the two questions the panel could not
     answer. They are the parent of aa-fetch's run directory (-o) and
     aa-upload's --destination_prefix respectively, so they belong to the
     sequence rather than to any one stage's flag form. */
  const [downloadRoot, setDownloadRoot] = useState('.');
  const [publishPrefix, setPublishPrefix] = useState('');
  const [downloadValues, setDownloadValues] = useState<OptionValues>(() => ({
    ...defaultsFor(downloadOptions),
    destination: `${vesselId}_${surveyName}_${sonarName}_NCEI`,
  }));
  const [combineValues, setCombineValues] = useState<OptionValues>(() => ({
    ...defaultsFor(combineOptions),
    output: `combined_${surveyName}_${sonarName}.nc`,
  }));

  const formatInfo = OUTPUT_FORMATS.find((f) => f.id === format);

  const defs = workflow === 'download' ? downloadOptions : combineOptions;
  const values = workflow === 'download' ? downloadValues : combineValues;
  const setValues = workflow === 'download' ? setDownloadValues : setCombineValues;

  const visible = useMemo(
    () => defs.filter((d) => !d.onlyForFormat || d.onlyForFormat === format),
    [defs, format],
  );

  const setValue = useCallback(
    (id: string, next: OptionValues[string]) =>
      setValues((current) => ({ ...current, [id]: next })),
    [setValues],
  );

  const changeFormat = useCallback(
    (next: OutputFormat) => {
      setFormat(next);
      setCombineValues((current) => ({
        ...current,
        output: withFormatExtension(String(current.output ?? ''), next),
      }));
    },
    [],
  );

  /* The first-tier sequence: acquire -> convert -> assemble -> verify.

     The combine options form below still owns aa-combine's flags; the sequence
     owns the order, the flags of every *other* stage, and the running. */
  const sequenceCtx: SequenceContext = useMemo(() => {
    /* aa-fetch creates `<output_root>/<download_dir_name>` and prints it. Both
       halves are named rather than left to default to a timestamp, so the
       directory Convert and Assemble read is knowable before Fetch has run. */
    const runName =
      String(downloadValues.destination ?? '').trim() ||
      `${vesselId}_${surveyName}_${sonarName}_NCEI`;
    return {
      vesselId,
      surveyName,
      sonarName,
      fileNames: targetFiles.map((f) => f.name),
      dateFrom,
      dateTo,
      downloadRoot,
      runName,
      workdir: `${downloadRoot}/${runName}`,
      output:
        String(combineValues.output ?? '').trim() ||
        `combined_${surveyName}_${sonarName}${format === 'zarr' ? '.zarr' : '.nc'}`,
      combineFlags: extraFlags.trim() ? extraFlags.trim().split(/\s+/) : [],
      requestPath: `${vesselId}_${surveyName}_request.yaml`,
      destinationPrefix:
        publishPrefix.trim() || `derived/${vesselId}/${surveyName}/${sonarName}`,
    };
  }, [
    vesselId,
    surveyName,
    sonarName,
    targetFiles,
    dateFrom,
    dateTo,
    downloadValues.destination,
    combineValues.output,
    format,
    extraFlags,
    downloadRoot,
    publishPrefix,
  ]);

  const sequence = useSequence(sequenceCtx);

  /* The queue only polls while something is live, so a panel that can start a
     job is a panel that has to switch it on. */
  useEffect(() => {
    startPolling();
    return () => stopPolling();
  }, []);

  /* What Run would do next, and why it might not. The sequence gates itself,
     so "next" is the first required stage that has not succeeded. */
  const nextStage = sequence.stages.find(
    (item) =>
      !item.stage.optional &&
      item.runnable &&
      sequence.jobs[item.stage.id]?.state !== 'succeeded',
  );
  const sequenceDone =
    sequence.stages.filter((i) => !i.stage.optional && i.runnable).length > 0 &&
    !nextStage;
  const busy = Object.values(sequence.jobs).some(
    (job) => job?.state === 'running' || job?.state === 'queued',
  );
  const blockedReason = sequence.loading
    ? 'Still scanning the environment for aa-* tools'
    : busy
      ? 'A step is already running'
      : !nextStage
        ? sequenceDone
          ? 'Every step has finished'
          : 'No tools resolved in this environment'
        : count === 0
          ? 'Select files first'
          : count < MIN_COMBINE_FILES
            ? `Combining needs at least ${MIN_COMBINE_FILES} files — widen the range or selection`
            : '';


  /* Transit gaps in the selection. Only meaningful for Combine — downloading
     files across a gap is fine, it is *merging* them onto one ping axis that
     lets a later MVBS pass average across the discontinuity and produce
     something plausible and wrong. Computed from timestamps the panel already
     holds, so this costs nothing and needs no tool. */
  const seamReport = useMemo(
    () => (workflow === 'combine' ? findSeams(targetFiles) : null),
    [workflow, targetFiles],
  );
  const seams = seamReport?.seams ?? [];

  const scopeLabel =
    selected.size > 0 ? 'selected' : dateFrom || dateTo ? 'in range' : 'in view';

  return (
    <Box
      sx={{
        borderTop: `1px solid ${theme.aa.color.border.subtle}`,
        backgroundColor: theme.aa.color.bg.chrome,
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '55%',
        overflow: 'auto',
      }}
    >
      <Box sx={{ p: 1.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography sx={{ fontSize: 12, color: theme.aa.color.text.secondary }}>
          {count > 0
            ? `${count} file${count === 1 ? '' : 's'} ${scopeLabel} · ${formatBytes(totalTargetBytes)}`
            : 'No files to act on'}
        </Typography>

        {/* Workflow — the two are peers, not a primary and an afterthought */}
        <ToggleButtonGroup
          size="small"
          exclusive
          fullWidth
          value={workflow}
          onChange={(_, next: Workflow | null) => next && setWorkflow(next)}
        >
          <ToggleButton value="download" sx={{ fontSize: 11.5, textTransform: 'none' }}>
            Download files
          </ToggleButton>
          <ToggleButton value="combine" sx={{ fontSize: 11.5, textTransform: 'none' }}>
            Combine dataset
          </ToggleButton>
        </ToggleButtonGroup>

        {workflow === 'combine' && (
          <Box>
            <Typography sx={{ fontSize: 11.5, color: theme.aa.color.text.muted, mb: 0.5 }}>
              How to store the result
            </Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              fullWidth
              value={format}
              onChange={(_, next: OutputFormat | null) => next && changeFormat(next)}
            >
              {OUTPUT_FORMATS.map((f) => (
                <ToggleButton
                  key={f.id}
                  value={f.id}
                  sx={{ fontSize: 11.5, textTransform: 'none' }}
                >
                  {f.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>

            {/* The trade-off, at the point of choice. This decision matters for
                survey-sized data and shouldn't require knowing what a chunked
                array store is. */}
            {formatInfo && (
              <Box
                sx={{
                  mt: 0.75,
                  p: 1,
                  borderRadius: `${theme.aa.radius.sm}px`,
                  backgroundColor: theme.aa.color.bg.base,
                  border: `1px solid ${theme.aa.color.border.subtle}`,
                }}
              >
                <Typography sx={{ fontSize: 11.5, color: theme.aa.color.text.secondary }}>
                  {formatInfo.summary}
                </Typography>
                <Typography sx={{ fontSize: 11, color: theme.aa.color.text.muted, mt: 0.5 }}>
                  Good for: {formatInfo.goodFor}
                </Typography>
                <Typography sx={{ fontSize: 11, color: theme.aa.color.text.muted }}>
                  Watch out: {formatInfo.watchOut}
                </Typography>
              </Box>
            )}
          </Box>
        )}

        {/* Where files land, and where they are published to. Above the steps
            because both are answered once for the whole run rather than per
            stage, and because "where did my download go" is the first thing
            anyone asks. */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <TextField
            size="small"
            fullWidth
            label="Download to"
            value={downloadRoot}
            onChange={(e) => setDownloadRoot(e.target.value)}
            placeholder="."
            helperText={`Files land in ${sequenceCtx.workdir}`}
            InputLabelProps={{ shrink: true }}
            FormHelperTextProps={{
              sx: { fontSize: 10, fontFamily: theme.aa.font.mono, mt: 0.25 },
            }}
            sx={compactFieldSx}
          />
          <TextField
            size="small"
            fullWidth
            label="Publish to (optional)"
            value={publishPrefix}
            onChange={(e) => setPublishPrefix(e.target.value)}
            placeholder={`derived/${vesselId}/${surveyName}/${sonarName}`}
            helperText="Bucket-relative prefix for the Publish step. Leave empty for the default."
            InputLabelProps={{ shrink: true }}
            FormHelperTextProps={{ sx: { fontSize: 10, mt: 0.25 } }}
            sx={compactFieldSx}
          />
        </Box>

        {/* The sequence. Every row runs something or says why it cannot —
            the previous strip drew four numbered stages and executed one. */}
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, mb: 0.5 }}>
            <Typography sx={{ fontSize: 11.5, color: theme.aa.color.text.muted }}>
              Steps
            </Typography>
            <Typography sx={{ fontSize: 10, color: theme.aa.color.text.muted }}>
              {sequence.loading
                ? 'checking which tools are installed…'
                : 'each step runs on its own; a step waits for the one before it'}
            </Typography>
          </Box>
          <SequenceStrip
            stages={sequence.stages}
            modes={sequence.modes}
            onModeChange={sequence.setMode}
            jobs={sequence.jobs}
            onRun={sequence.run}
            preview={sequence.preview}
            blocked={sequence.blocked}
            renderFlags={(resolved) => (
              <StageFlags
                resolved={resolved}
                values={sequence.flags[resolved.stage.id] ?? {}}
                ownedValues={sequence.owned(resolved.stage.id)}
                onChange={(paramId, next) =>
                  sequence.setFlag(resolved.stage.id, paramId, next)
                }
              />
            )}
            onOpenJob={(jobId) => {
              selectJob(jobId);
              openPanel('processingQueue');
            }}
          />
          {sequence.error && (
            <Typography sx={{ fontSize: 10, color: theme.aa.color.status.warning, mt: 0.5 }}>
              {sequence.error}
            </Typography>
          )}
        </Box>

        {/* Transit gaps.
            Placed after the steps and before the options, because it changes
            what you should be doing rather than how you should configure it —
            and because the only cheap moment to catch this is before the
            command exists. Nothing downstream can detect a store that was
            combined across a gap; by then the discontinuity is indistinguishable
            from quiet water. */}
        {seamReport && seams.length > 0 && (
          <Box
            sx={{
              p: 1,
              borderRadius: `${theme.aa.radius.sm}px`,
              border: `1px dashed ${theme.aa.color.status.warning}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.75,
            }}
          >
            <Typography sx={{ fontSize: 11.5, color: theme.aa.color.status.warning }}>
              {seams.length === 1
                ? 'This selection spans a transit gap.'
                : `This selection spans ${seams.length} transit gaps.`}{' '}
              Combining across one puts both sides on a single ping axis, and a
              later MVBS pass will bin across the gap and produce plausible data
              that is not real.
            </Typography>

            {seams.map((seam) => (
              <Typography
                key={seam.before}
                sx={{
                  fontSize: 10.5,
                  fontFamily: theme.aa.font.mono,
                  color: theme.aa.color.text.secondary,
                  wordBreak: 'break-all',
                }}
              >
                {formatGap(seam.seconds)} ({Math.round(seam.factor)}× the usual{' '}
                {formatGap(seamReport.medianSeconds)}) between {seam.before} and{' '}
                {seam.after}
              </Typography>
            ))}

            {/* Actionable, not merely advisory: each group is a selection the
                user can adopt in one click and then combine safely. */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
              <Typography sx={{ fontSize: 10.5, color: theme.aa.color.text.muted }}>
                Combine one run at a time:
              </Typography>
              {seamReport.groups.map((group, index) => (
                <Button
                  key={`group-${index}`}
                  size="small"
                  variant="outlined"
                  onClick={() => selectOnly(group.map((f) => f.name))}
                  sx={{ fontSize: 10.5, textTransform: 'none', py: 0, minWidth: 0 }}
                >
                  Run {index + 1} ({group.length})
                </Button>
              ))}
            </Box>

            <Typography sx={{ fontSize: 10, color: theme.aa.color.text.muted }}>
              Only gaps in time are found here. A calibration change or a
              channel-config change is inside the files and is aa-combine’s own
              QC pass to report — a clean result here does not mean the
              selection is safe to combine.
            </Typography>
          </Box>
        )}

        {seamReport && seamReport.undated.length > 0 && (
          <Typography sx={{ fontSize: 10.5, color: theme.aa.color.text.muted }}>
            {seamReport.undated.length} file
            {seamReport.undated.length === 1 ? '' : 's'} had no readable
            acquisition time and {seamReport.undated.length === 1 ? 'was' : 'were'}{' '}
            left out of the gap check.
          </Typography>
        )}

        {/* Primary options inline; the rest behind a disclosure */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {visible
            .filter((d) => d.primary)
            .map((def) => (
              <OptionControl
                key={def.id}
                def={def}
                value={values[def.id]}
                onChange={(next) => setValue(def.id, next)}
              />
            ))}
        </Box>

        <Button
          size="small"
          onClick={() => setShowAll((v) => !v)}
          endIcon={
            showAll ? (
              <ExpandLessOutlined sx={{ fontSize: 16 }} />
            ) : (
              <ExpandMoreOutlined sx={{ fontSize: 16 }} />
            )
          }
          sx={{ alignSelf: 'flex-start', fontSize: 11.5, textTransform: 'none' }}
        >
          All options
        </Button>

        <Collapse in={showAll} unmountOnExit>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, pb: 1 }}>
            {/* These flag names came from this project's tool catalogue. */}
            {visible
              .filter((d) => !d.primary && d.verified !== false)
              .map((def) => (
                <OptionControl
                  key={def.id}
                  def={def}
                  value={values[def.id]}
                  onChange={(next) => setValue(def.id, next)}
                />
              ))}

            {/* And these did not. Grouping them is more honest than sprinkling
                warning icons: the whole block is provisional, and saying so once
                is clearer than saying it six times. */}
            {visible.some((d) => d.verified === false) && (
              <Box
                sx={{
                  p: 1,
                  borderRadius: `${theme.aa.radius.sm}px`,
                  border: `1px dashed ${theme.aa.color.status.warning}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1.25,
                }}
              >
                <Typography
                  sx={{ fontSize: 11, color: theme.aa.color.status.warning }}
                >
                  Proposed controls — these flag names have not been confirmed
                  against the installed tools, so they may not work yet. Check
                  with <code>--help</code> and correct them in combineOptions.ts.
                </Typography>
                {visible
                  .filter((d) => !d.primary && d.verified === false)
                  .map((def) => (
                    <OptionControl
                      key={def.id}
                      def={def}
                      value={values[def.id]}
                      onChange={(next) => setValue(def.id, next)}
                    />
                  ))}
              </Box>
            )}
            <TextField
              size="small"
              fullWidth
              label="Additional flags"
              value={extraFlags}
              onChange={(e) => setExtraFlags(e.target.value)}
              placeholder="--any-flag value"
              helperText="Appended verbatim — use this for anything the form doesn't cover yet."
              InputProps={{ sx: { fontSize: 12, fontFamily: theme.aa.font.mono } }}
              InputLabelProps={{ sx: { fontSize: 12 } }}
              FormHelperTextProps={{ sx: { fontSize: 10.5 } }}
            />
          </Box>
        </Collapse>

        {/* One Run, and it drives the sequence above.

            There used to be two: per-stage buttons in the strip, and this one,
            which emitted a single `aa-fetch --ship_name … --survey_name …
            --sonar_model … --file_name …` and typed it at the shell. Discovery
            reports that aa-fetch accepts none of those four — its flags are
            -o and -n and it takes the document positionally — so that command
            had never been able to run. Two systems, one of them broken, in one
            panel. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Typography sx={{ fontSize: 10.5, color: theme.aa.color.text.muted, flex: 1 }}>
            {sequenceDone
              ? 'Every step finished.'
              : nextStage
                ? `Next: ${nextStage.stage.label} — ${
                    findMode(nextStage.stage, sequence.modes[nextStage.stage.id] ?? '')
                      .label
                  }`
                : 'Nothing to run — no tools resolved.'}
          </Typography>
          <Button
            size="small"
            onClick={() => openPanel('processingQueue')}
            sx={{ fontSize: 10.5, textTransform: 'none' }}
          >
            Queue
          </Button>
          <Tooltip title={blockedReason}>
            <span style={{ display: 'flex' }}>
              <Button
                variant="contained"
                size="small"
                disabled={Boolean(blockedReason)}
                startIcon={<PlayArrowOutlined sx={{ fontSize: 16 }} />}
                onClick={sequence.runAll}
                sx={{ textTransform: 'none' }}
              >
                {nextStage ? `Run ${nextStage.stage.label}` : 'Run'}
              </Button>
            </span>
          </Tooltip>
        </Box>

        {/* The whole sequence, as it would be typed. `&&` rather than `|`
            because these compose by passing paths, not by streaming. */}
        <Box
          sx={{
            p: 1,
            borderRadius: `${theme.aa.radius.sm}px`,
            backgroundColor: theme.aa.color.bg.base,
            border: `1px solid ${theme.aa.color.border.subtle}`,
            fontFamily: theme.aa.font.mono,
            fontSize: 10.5,
            color: theme.aa.color.text.secondary,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {sequence.fullCommand || 'No runnable steps.'}
        </Box>
        <Button
          size="small"
          startIcon={<TerminalOutlined sx={{ fontSize: 14 }} />}
          onClick={() => {
            openPanel('terminal');
            // Typed, not executed: this is the escape hatch for running the
            // chain by hand, and a command that lands pre-run leaves nothing
            // to inspect or edit first.
            sendToTerminal(sequence.fullCommand, { origin: 'NCEI', execute: false });
          }}
          disabled={!sequence.fullCommand}
          sx={{ alignSelf: 'flex-start', fontSize: 10.5, textTransform: 'none' }}
        >
          Send to terminal
        </Button>
      </Box>
    </Box>
  );
}
