import { useCallback, useMemo, useState } from 'react';
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
  DownloadOutlined,
  ExpandLessOutlined,
  ExpandMoreOutlined,
  TerminalOutlined,
} from '@mui/icons-material';

import { useLayout } from '../../../context/LayoutContext';
import { sendToTerminal } from '../../../state/terminal';
import { formatBytes } from './nceiService';
import type { NceiSearchController } from './useNceiSearch';
import {
  COMBINE_STAGES,
  DOWNLOAD_STAGES,
  OUTPUT_FORMATS,
  buildFlags,
  combineOptions,
  defaultsFor,
  downloadOptions,
  quote,
  withFormatExtension,
} from './combineOptions';
import type { OptionDef, OptionValues, OutputFormat, Stage } from './combineOptions';

interface Props {
  controller: NceiSearchController;
}

type Workflow = 'download' | 'combine';

const MIN_COMBINE_FILES = 2; // echopype.combine_echodata needs at least two

/**
 * What this operation will do, step by step.
 *
 * The tools chain together, and the chain is not obvious from a single command
 * line — "combine" quietly implies fetching and converting first. Showing the
 * steps means the panel explains the operation instead of assuming it's known.
 */
function StageStrip({ stages, skipped }: { stages: readonly Stage[]; skipped: Set<string> }) {
  const theme = useTheme();
  return (
    <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 0.5, flexWrap: 'wrap' }}>
      {stages.map((stage, index) => {
        const off = skipped.has(stage.id);
        return (
          <Tooltip key={stage.id} title={stage.description}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 0.75,
                py: 0.35,
                borderRadius: `${theme.aa.radius.sm}px`,
                border: `1px solid ${
                  off ? theme.aa.color.border.subtle : theme.aa.color.accent.main
                }`,
                opacity: off ? 0.45 : 1,
                cursor: 'help',
              }}
            >
              <Typography
                sx={{
                  fontSize: 10.5,
                  color: off ? theme.aa.color.text.muted : theme.aa.color.text.primary,
                }}
              >
                {index + 1}. {stage.label}
              </Typography>
              <Typography
                sx={{
                  fontSize: 10,
                  fontFamily: theme.aa.font.mono,
                  color: theme.aa.color.text.muted,
                }}
              >
                {stage.tool}
              </Typography>
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}

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
  const { targetFiles, totalTargetBytes, context, dateFrom, dateTo, selected } = controller;
  const count = targetFiles.length;

  const surveyName = context.survey?.name ?? 'survey';
  const sonarName = context.sonar?.name ?? 'sonar';
  const vesselId = context.vessel?.id ?? 'vessel';

  const [workflow, setWorkflow] = useState<Workflow>('download');
  const [format, setFormat] = useState<OutputFormat>('nc');
  const [showAll, setShowAll] = useState(false);
  const [extraFlags, setExtraFlags] = useState('');
  const [downloadValues, setDownloadValues] = useState<OptionValues>(() => ({
    ...defaultsFor(downloadOptions),
    destination: `${vesselId}_${surveyName}_${sonarName}_NCEI`,
  }));
  const [combineValues, setCombineValues] = useState<OptionValues>(() => ({
    ...defaultsFor(combineOptions),
    output: `combined_${surveyName}_${sonarName}.nc`,
  }));

  const formatInfo = OUTPUT_FORMATS.find((f) => f.id === format);
  const stages = workflow === 'download' ? DOWNLOAD_STAGES : COMBINE_STAGES;
  // Upload only happens when a destination was given — show that, don't imply it.
  const skippedStages = useMemo(() => {
    const skipped = new Set<string>();
    if (workflow === 'combine' && !String(combineValues.destination ?? '').trim()) {
      skipped.add('upload');
    }
    return skipped;
  }, [workflow, combineValues.destination]);

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

  /* The command, built from the schema. This is what the user sees and what
     gets typed into the terminal — there is no second, hidden version. */
  const command = useMemo(() => {
    const names = targetFiles.map((f) => f.name);
    if (workflow === 'download') {
      const flags = buildFlags(downloadOptions, downloadValues, format);
      return [
        'aa-fetch',
        '--ship_name',
        quote(vesselId),
        '--survey_name',
        quote(surveyName),
        '--sonar_model',
        quote(sonarName),
        ...(names.length === 1 ? ['--file_name', quote(names[0])] : []),
        ...flags,
        extraFlags.trim(),
      ]
        .filter(Boolean)
        .join(' ');
    }
    const flags = buildFlags(combineOptions, combineValues, format);
    return ['aa-combine', ...flags, extraFlags.trim()].filter(Boolean).join(' ');
  }, [
    workflow,
    targetFiles,
    downloadValues,
    combineValues,
    format,
    extraFlags,
    vesselId,
    surveyName,
    sonarName,
  ]);

  const tooFew = workflow === 'combine' && count < MIN_COMBINE_FILES;
  const blocked = count === 0 || tooFew;

  const run = useCallback(() => {
    openPanel('terminal');
    sendToTerminal(command, { origin: 'NCEI', execute: true });
  }, [command, openPanel]);

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

        {/* What is actually going to happen */}
        <Box>
          <Typography sx={{ fontSize: 11.5, color: theme.aa.color.text.muted, mb: 0.5 }}>
            Steps
          </Typography>
          <StageStrip stages={stages} skipped={skippedStages} />
        </Box>

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

        {/* The command, exactly as it will be typed */}
        <Box
          sx={{
            p: 1,
            borderRadius: `${theme.aa.radius.sm}px`,
            backgroundColor: theme.aa.color.bg.base,
            border: `1px solid ${theme.aa.color.border.subtle}`,
            fontFamily: theme.aa.font.mono,
            fontSize: 11.5,
            color: theme.aa.color.text.secondary,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {command}
        </Box>

        <Typography sx={{ fontSize: 10.5, color: theme.aa.color.text.muted }}>
          {workflow === 'download'
            ? 'aa-fetch is interactive — it runs in the Terminal panel so you can answer its prompts.'
            : 'Runs in the Terminal panel. Combining needs the raw files locally first.'}
        </Typography>

        <Tooltip
          title={
            tooFew
              ? `Combining needs at least ${MIN_COMBINE_FILES} files — widen the range or selection`
              : count === 0
                ? 'Select files first'
                : ''
          }
        >
          <span>
            <Button
              fullWidth
              variant="contained"
              size="small"
              disabled={blocked}
              startIcon={
                workflow === 'download' ? (
                  <DownloadOutlined sx={{ fontSize: 16 }} />
                ) : (
                  <TerminalOutlined sx={{ fontSize: 16 }} />
                )
              }
              onClick={run}
              sx={{ textTransform: 'none' }}
            >
              Run in terminal
            </Button>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}
