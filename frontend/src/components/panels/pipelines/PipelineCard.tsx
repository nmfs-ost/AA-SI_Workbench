import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  Box,
  Divider,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  ArrowForwardRounded,
  ContentCopyOutlined,
  DeleteOutlineRounded,
  EditOutlined,
  MoreVertRounded,
  WarningAmberRounded,
} from '@mui/icons-material';

import type { Catalogue, PipelineSpec } from '../../../services/pipelinesApi';
import { LevelChip } from '../prepare/ui';
import { kindLabel, toolOf, walk } from './chain';
import type { Fit } from './chain';

/**
 * One pipeline, as a card: its name, what it does, and its chain drawn as the
 * products it passes along (EchoData → aa-sv → Sv → aa-graph → Echogram), so
 * what goes in and what comes out read at a glance. Stages the selected input
 * is already past are drawn faint. The open card shows its plan beneath
 * (children).
 */
export function PipelineCard({
  pipeline,
  catalogue,
  inputKind,
  fit,
  active,
  edited,
  onOpen,
  onEdit,
  onDuplicate,
  onDelete,
  children,
}: {
  pipeline: PipelineSpec;
  catalogue: Catalogue | null;
  inputKind: string;
  fit: Fit | null;
  active: boolean;
  edited: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const misfit = fit && !fit.ok;

  return (
    <Box
      sx={{
        borderRadius: `${theme.aa.radius.md}px`,
        border: `1px solid ${active ? alpha(c.accent.main, 0.55) : c.border.subtle}`,
        backgroundColor: active ? c.bg.panel : alpha(c.bg.panel, 0.55),
        boxShadow: active ? `0 0 0 1px ${alpha(c.accent.main, 0.15)}` : 'none',
        transition: 'border-color .15s, background-color .15s',
        '&:hover': active ? undefined : { borderColor: c.border.strong, backgroundColor: c.bg.panel },
      }}
    >
      <Box
        role="button"
        tabIndex={0}
        aria-expanded={active}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
        sx={{
          px: 1.5,
          pt: 1.1,
          pb: 1.1,
          cursor: 'pointer',
          outline: 'none',
          '&:focus-visible': { boxShadow: `inset 0 0 0 1px ${c.accent.main}` },
          opacity: misfit && !active ? 0.62 : 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: c.text.primary }} noWrap>
            {pipeline.name}
          </Typography>
          <Tag color={pipeline.builtin ? c.text.muted : c.syntax.entity}>
            {pipeline.builtin ? 'Built in' : 'Yours'}
          </Tag>
          {edited && <Tag color={c.status.warning}>Edited</Tag>}
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: 11, color: c.text.muted, flexShrink: 0 }}>
            {pipeline.stages.length} {pipeline.stages.length === 1 ? 'stage' : 'stages'}
          </Typography>
          <IconButton
            size="small"
            aria-label={`Actions for ${pipeline.name}`}
            onClick={(e) => {
              e.stopPropagation();
              setMenu(e.currentTarget);
            }}
          >
            <MoreVertRounded sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
        {pipeline.description && (
          <Typography sx={{ fontSize: 11.5, color: c.text.secondary, lineHeight: 1.5, mt: 0.25, mb: 0.9 }}>
            {pipeline.description}
          </Typography>
        )}
        <Flow pipeline={pipeline} catalogue={catalogue} inputKind={inputKind} />
        {misfit && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mt: 0.9 }}>
            <WarningAmberRounded sx={{ fontSize: 14, color: c.status.warning }} />
            <Typography sx={{ fontSize: 11, color: c.text.secondary }}>{fit?.reason}</Typography>
          </Box>
        )}
      </Box>

      {active && children && (
        <>
          <Divider sx={{ borderColor: c.border.subtle }} />
          <Box sx={{ px: 1.5, py: 1.25 }}>{children}</Box>
        </>
      )}

      <Menu
        anchorEl={menu}
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
        onClick={(e) => e.stopPropagation()}
        slotProps={{ paper: { sx: { minWidth: 200 } } }}
      >
        {!pipeline.builtin && (
          <MenuItem
            dense
            onClick={() => {
              setMenu(null);
              onEdit();
            }}
          >
            <ListItemIcon>
              <EditOutlined sx={{ fontSize: 16 }} />
            </ListItemIcon>
            Edit stages…
          </MenuItem>
        )}
        <MenuItem
          dense
          onClick={() => {
            setMenu(null);
            onDuplicate();
          }}
        >
          <ListItemIcon>
            <ContentCopyOutlined sx={{ fontSize: 16 }} />
          </ListItemIcon>
          {pipeline.builtin ? 'Make my own copy…' : 'Duplicate…'}
        </MenuItem>
        {!pipeline.builtin && (
          <MenuItem
            dense
            onClick={() => {
              setMenu(null);
              onDelete();
            }}
            sx={{ color: c.status.error }}
          >
            <ListItemIcon>
              <DeleteOutlineRounded sx={{ fontSize: 16, color: c.status.error }} />
            </ListItemIcon>
            Delete
          </MenuItem>
        )}
      </Menu>
    </Box>
  );
}

function Tag({ color, children }: { color: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <Box
      component="span"
      sx={{
        flexShrink: 0,
        height: 17,
        px: 0.65,
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: `${theme.aa.radius.sm}px`,
        fontSize: 10,
        fontWeight: 600,
        color,
        backgroundColor: alpha(color, 0.1),
        border: `1px solid ${alpha(color, 0.25)}`,
      }}
    >
      {children}
    </Box>
  );
}

/** The chain as the products it passes along. */
export function Flow({
  pipeline,
  catalogue,
  inputKind,
}: {
  pipeline: PipelineSpec;
  catalogue: Catalogue | null;
  inputKind: string;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  if (!catalogue) return null;
  const steps = walk(pipeline.stages, catalogue, inputKind);
  const first = toolOf(catalogue, pipeline.stages[0]?.tool ?? '');
  const startKind = inputKind && !steps[0]?.skip ? inputKind : first?.consumes[0] ?? '';
  const level = (kind: string) => catalogue.levels[kind] ?? '';

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 0.75, columnGap: 0.5 }}>
      <KindNode kind={startKind} level={level(startKind)} catalogue={catalogue} faint={steps[0]?.skip} />
      {pipeline.stages.map((stage, i) => {
        const step = steps[i];
        const tool = toolOf(catalogue, stage.tool);
        const faint = step?.skip;
        return (
          <Box key={`${stage.tool}-${i}`} sx={{ display: 'contents' }}>
            <Tooltip
              disableInteractive
              title={
                step?.mismatch ||
                (faint ? `Not needed: the input is already ${kindLabel(inputKind, catalogue)}.` : tool?.summary || stage.tool)
              }
            >
              <Box
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.4,
                  color: step?.mismatch ? c.status.error : faint ? c.text.disabled : c.text.muted,
                  opacity: faint ? 0.55 : 1,
                }}
              >
                <ArrowForwardRounded sx={{ fontSize: 12 }} />
                <Typography
                  component="span"
                  sx={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: 'inherit',
                    textDecoration: faint ? 'line-through' : 'none',
                    textDecorationColor: alpha(c.text.muted, 0.6),
                  }}
                >
                  {stage.tool}
                </Typography>
                {Object.keys(stage.params).length > 0 && (
                  <Box
                    component="span"
                    title="Settings changed from the tool's defaults"
                    sx={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: c.accent.main, mt: '-6px' }}
                  />
                )}
                <ArrowForwardRounded sx={{ fontSize: 12 }} />
              </Box>
            </Tooltip>
            <KindNode
              kind={step?.writes || tool?.produces || ''}
              level={level(step?.writes || tool?.produces || '')}
              catalogue={catalogue}
              faint={faint}
              last={i === pipeline.stages.length - 1}
            />
          </Box>
        );
      })}
    </Box>
  );
}

function KindNode({
  kind,
  level,
  catalogue,
  faint = false,
  last = false,
}: {
  kind: string;
  level: string;
  catalogue: Catalogue;
  faint?: boolean;
  last?: boolean;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  if (!kind) return null;
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        height: 22,
        px: 0.75,
        borderRadius: 11,
        border: `1px solid ${last ? alpha(c.accent.main, 0.5) : c.border.strong}`,
        backgroundColor: last ? alpha(c.accent.main, 0.1) : c.bg.editor,
        opacity: faint ? 0.5 : 1,
      }}
    >
      <LevelChip level={level} />
      <Typography component="span" sx={{ fontSize: 11, fontWeight: 600, color: c.text.primary }}>
        {kindLabel(kind, catalogue)}
      </Typography>
    </Box>
  );
}
