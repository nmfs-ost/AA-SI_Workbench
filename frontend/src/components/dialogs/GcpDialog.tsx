import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Radio,
  TextField,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  CloudOutlined,
  ExpandMoreRounded,
  RefreshOutlined,
  StorageOutlined,
} from '@mui/icons-material';

import type { BucketAccess, ContextSource, ProjectInfo } from '../../services/gcpApi';
import { GCP_SIMULATED } from '../../services/gcpApi';
import { chooseGcp, discoverGcp, forgetGcp, initGcp, useGcp } from '../../state/gcp';

interface Props {
  open: boolean;
  onClose: () => void;
}

const SOURCE_TEXT: Record<ContextSource, string> = {
  chosen: 'your choice',
  discovered: 'the only bucket you can write to',
  environment: "the Workbench's settings",
  unset: '',
};

/**
 * Which GCP project and bucket the Workbench works in.
 *
 * The list is what this person can actually use, found with the same Google
 * credentials the data is read and written with: projects they can see, plus
 * the AA-SI projects by name (bucket access is often granted without project
 * access), each with the buckets they can read or write. Writable first, so
 * the usual answer is the first row. A project or bucket not in the list can
 * be typed. The choice is remembered on the workstation and applies to the
 * Derived panel, Prepare EchoData, the NCEI cache and every console tool the
 * Workbench runs.
 */
export function GcpDialog({ open, onClose }: Props) {
  const theme = useTheme();
  const c = theme.aa.color;
  const gcp = useGcp();
  const context = gcp.context;
  const discovery = gcp.discovery;

  const [pick, setPick] = useState<{ project: string; bucket: string } | null>(null);
  const [manualProject, setManualProject] = useState('');
  const [manualBucket, setManualBucket] = useState('');
  const [showOthers, setShowOthers] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPick(context?.bucket ? { project: context.project, bucket: context.bucket } : null);
    setManualProject('');
    setManualBucket('');
    if (!context) initGcp(); // the first load failed: try again
    if (!discovery && !gcp.discovering) void discoverGcp();
    // Only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { usable, others } = useMemo(() => {
    const projects = discovery?.projects ?? [];
    return {
      usable: projects.filter((p) => p.buckets.some((b) => b.read || b.write) || p.listedBy === 'known'),
      others: projects.filter((p) => !p.buckets.some((b) => b.read || b.write) && p.listedBy !== 'known'),
    };
  }, [discovery]);

  const typedBucket = manualBucket.trim().replace(/^gs:\/\//, '').replace(/\/+$/, '');
  const typedProject = manualProject.trim();
  const typed = typedBucket || typedProject;
  // A project alone means its conventional bucket, <project>-data.
  const target = typed
    ? { project: typedProject, bucket: typedBucket || `${typedProject}-data` }
    : pick;
  const targetAccess = target
    ? discovery?.projects.flatMap((p) => p.buckets).find((b) => b.name === target.bucket)
    : undefined;
  const targetProject = target
    ? discovery?.projects.find(
        (p) => p.id === target.project || p.buckets.some((b) => b.name === target.bucket),
      )
    : undefined;
  const unchanged =
    !target ||
    (context?.bucket === target.bucket &&
      (context?.project === target.project || !target.project) &&
      context?.source !== 'environment');

  const use = async () => {
    if (!target) return;
    setSaving(true);
    const ok = await chooseGcp(target.project, target.bucket);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 0.5 }}>
        <CloudOutlined sx={{ fontSize: 20, color: c.accent.main }} />
        <Box sx={{ flex: 1 }}>GCP project and bucket</Box>
        {GCP_SIMULATED && (
          <Typography sx={{ fontSize: 10, fontWeight: 700, color: c.status.warning, letterSpacing: '0.04em' }}>
            SAMPLE DATA
          </Typography>
        )}
      </DialogTitle>
      <DialogContent sx={{ pt: 0.5 }}>
        <Typography sx={{ fontSize: 12.5, color: c.text.secondary, lineHeight: 1.55, mb: 1.5 }}>
          Where the Workbench works: the bucket the Products panel shows and Prepare EchoData
          writes to, the project's NCEI cache, and the project every console tool it runs is
          told to use.
        </Typography>

        {/* In use now */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.25,
            py: 1,
            mb: 1.5,
            borderRadius: `${theme.aa.radius.md}px`,
            border: `1px solid ${c.border.subtle}`,
            backgroundColor: c.bg.editor,
          }}
        >
          <Typography sx={{ fontSize: 11, color: c.text.muted, width: 48, flexShrink: 0 }}>In use</Typography>
          {context?.bucket ? (
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontFamily: theme.aa.font.mono, fontSize: 12, color: c.text.primary }}>
                gs://{context.bucket}
              </Typography>
              <Typography sx={{ fontSize: 11, color: c.text.muted }}>
                {context.project || 'project unknown'} · {SOURCE_TEXT[context.source]}
                {context.nceiCacheProject && context.nceiCacheProject !== context.project
                  ? ` · NCEI cache from ${context.nceiCacheProject}`
                  : ''}
              </Typography>
            </Box>
          ) : (
            <Typography sx={{ fontSize: 12, color: c.status.warning }}>
              Nothing chosen yet. Products cannot be written until a bucket is chosen.
            </Typography>
          )}
        </Box>

        {/* What this person can use */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: c.text.primary }}>
            What you can use
          </Typography>
          <Typography sx={{ fontSize: 11, color: c.text.muted, flex: 1, minWidth: 0 }} noWrap>
            {discovery?.account ? `as ${discovery.account}` : ''}
          </Typography>
          <Button
            size="small"
            startIcon={gcp.discovering ? <CircularProgress size={12} /> : <RefreshOutlined sx={{ fontSize: 15 }} />}
            disabled={gcp.discovering}
            onClick={() => void discoverGcp(true)}
            sx={{ textTransform: 'none', fontSize: 11.5 }}
          >
            Look again
          </Button>
        </Box>

        {discovery?.notes.map((note) => (
          <Alert key={note} severity="info" sx={{ fontSize: 11.5, py: 0, mb: 1 }}>
            {note}
          </Alert>
        ))}
        {gcp.error && (
          <Alert severity="error" sx={{ fontSize: 11.5, py: 0, mb: 1 }}>
            {gcp.error}
          </Alert>
        )}

        <Box
          sx={{
            borderRadius: `${theme.aa.radius.md}px`,
            border: `1px solid ${c.border.subtle}`,
            overflow: 'hidden',
            opacity: typed ? 0.5 : 1,
          }}
        >
          {!discovery && gcp.discovering && (
            <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={14} />
              <Typography sx={{ fontSize: 12, color: c.text.muted }}>
                Asking Google which projects and buckets you can use…
              </Typography>
            </Box>
          )}
          {!discovery && !gcp.discovering && (
            <Typography sx={{ p: 1.5, fontSize: 12, color: c.text.muted }}>
              Nothing listed yet. Look again, or type a project and bucket below.
            </Typography>
          )}
          {usable.map((project) => (
            <ProjectRows
              key={project.id}
              project={project}
              picked={!typed ? pick : null}
              onPick={(bucket) => {
                setPick({ project: project.id, bucket: bucket.name });
                setManualBucket('');
              }}
            />
          ))}
          {discovery && usable.length === 0 && (
            <Typography sx={{ p: 1.5, fontSize: 12, color: c.text.muted }}>
              No project with a bucket you can read was found. Type one below.
            </Typography>
          )}
        </Box>

        {others.length > 0 && (
          <Box sx={{ mt: 0.75 }}>
            <Button
              size="small"
              onClick={() => setShowOthers((v) => !v)}
              endIcon={
                <ExpandMoreRounded
                  sx={{ transform: showOthers ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
                />
              }
              sx={{ textTransform: 'none', fontSize: 11.5, color: c.text.secondary, ml: -0.5 }}
            >
              {others.length} more {others.length === 1 ? 'project' : 'projects'} you can see, without a bucket you can use
            </Button>
            <Collapse in={showOthers} unmountOnExit>
              <Typography
                sx={{ fontSize: 11, fontFamily: theme.aa.font.mono, color: c.text.muted, lineHeight: 1.7, pl: 0.5 }}
              >
                {others.map((p) => p.id).join(', ')}
              </Typography>
            </Collapse>
          </Box>
        )}

        {/* Typed */}
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: c.text.primary, mt: 2, mb: 0.75 }}>
          Or type a project and bucket
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            label="Bucket"
            placeholder="ggn-nmfs-aa-prod-1-data"
            value={manualBucket}
            onChange={(e) => setManualBucket(e.target.value)}
            InputLabelProps={{ shrink: true }}
            inputProps={{ spellCheck: false }}
            sx={{ flex: 3, '& input': { fontFamily: theme.aa.font.mono, fontSize: 12 } }}
          />
          <TextField
            size="small"
            label="Project"
            placeholder="from the bucket's name"
            value={manualProject}
            onChange={(e) => setManualProject(e.target.value)}
            InputLabelProps={{ shrink: true }}
            inputProps={{ spellCheck: false }}
            sx={{ flex: 2, '& input': { fontFamily: theme.aa.font.mono, fontSize: 12 } }}
          />
        </Box>

        {target && targetProject?.nceiCache === false && (
          <Alert severity="info" sx={{ fontSize: 11.5, mt: 1.5, py: 0 }}>
            {targetProject.id} has no NCEI cache table, so Prepare EchoData&apos;s fetch (and, with
            the cache source, its file list) uses the cache of a project that has one:
            production&apos;s, when you can read it.
          </Alert>
        )}
        {target && targetAccess && targetAccess.read && !targetAccess.write && (
          <Alert severity="warning" sx={{ fontSize: 11.5, mt: 1.5, py: 0 }}>
            You can read gs://{target.bucket} but not write to it: the Products panel will list it,
            and Prepare EchoData will not be able to save products there.
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {(context?.source === 'chosen' || context?.source === 'discovered') && (
          <Button
            size="small"
            onClick={() => void forgetGcp()}
            sx={{ textTransform: 'none', mr: 'auto', color: c.text.secondary }}
          >
            Forget my choice
          </Button>
        )}
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disableElevation
          disabled={unchanged || saving}
          onClick={() => void use()}
          sx={{ textTransform: 'none' }}
        >
          {saving ? 'Saving…' : 'Use this'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ProjectRows({
  project,
  picked,
  onPick,
}: {
  project: ProjectInfo;
  picked: { project: string; bucket: string } | null;
  onPick: (bucket: BucketAccess) => void;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  return (
    <Box sx={{ '& + &': { borderTop: `1px solid ${c.border.subtle}` } }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, px: 1.25, pt: 0.9, pb: 0.25 }}>
        <Typography sx={{ fontFamily: theme.aa.font.mono, fontSize: 12, fontWeight: 600, color: c.text.primary }}>
          {project.id}
        </Typography>
        <Typography sx={{ fontSize: 11, color: c.text.muted, flex: 1, minWidth: 0 }} noWrap>
          {project.name}
        </Typography>
        {project.nceiCache && <Badge color={c.syntax.reference}>NCEI cache</Badge>}
      </Box>
      {project.buckets.length === 0 && (
        <Typography sx={{ px: 1.25, pb: 0.9, pl: 4.5, fontSize: 11, color: c.text.muted }}>
          {project.detail || 'No bucket you can use.'}
        </Typography>
      )}
      {project.buckets.map((bucket) => {
        const usable = Boolean(bucket.read || bucket.write);
        const selected = picked?.bucket === bucket.name;
        return (
          <Box
            key={bucket.name}
            component="label"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              pl: 2,
              pr: 1.25,
              py: 0.1,
              cursor: usable ? 'pointer' : 'default',
              opacity: usable ? 1 : 0.5,
              backgroundColor: selected ? alpha(c.accent.main, 0.08) : 'transparent',
              '&:last-of-type': { pb: 0.5 },
            }}
          >
            <Radio
              size="small"
              checked={selected}
              disabled={!usable}
              onChange={() => onPick(bucket)}
              inputProps={{ 'aria-label': `gs://${bucket.name}` }}
            />
            <StorageOutlined sx={{ fontSize: 14, color: c.text.muted }} />
            <Typography
              sx={{ fontFamily: theme.aa.font.mono, fontSize: 12, color: c.text.secondary, flex: 1, minWidth: 0 }}
              noWrap
            >
              gs://{bucket.name}
            </Typography>
            {bucket.write ? (
              <Badge color={c.status.success}>read · write</Badge>
            ) : bucket.read ? (
              <Badge color={c.status.warning}>read only</Badge>
            ) : (
              <Badge color={c.text.muted}>{bucket.detail ? 'unknown' : 'no access'}</Badge>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function Badge({ color, children }: { color: string; children: string }) {
  const theme = useTheme();
  return (
    <Box
      component="span"
      sx={{
        flexShrink: 0,
        px: 0.75,
        height: 18,
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: `${theme.aa.radius.sm}px`,
        fontSize: 10,
        fontWeight: 600,
        color,
        backgroundColor: alpha(color, 0.12),
        border: `1px solid ${alpha(color, 0.3)}`,
      }}
    >
      {children}
    </Box>
  );
}
