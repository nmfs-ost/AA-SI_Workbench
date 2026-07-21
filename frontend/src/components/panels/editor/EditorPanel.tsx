import { useCallback, useEffect } from 'react';
import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { Box, CircularProgress, Tooltip, Typography, useTheme } from '@mui/material';
import {
  DescriptionOutlined,
  ImageOutlined,
  InsightsOutlined,
  RestoreOutlined,
  SaveOutlined,
} from '@mui/icons-material';

import { filesApi } from '../../../services/filesApi';
import {
  isDirty,
  revertDoc,
  saveDoc,
  setDocText,
  setFocusedEditor,
  useEditorDoc,
} from '../../../state/editors';
import { CopyPathButton } from '../CopyPathButton';
import { CodeEditor } from './CodeEditor';
import { NotebookEditor } from './NotebookEditor';
import { documentViewFor, languageFor, unsupportedReason } from './language';
import { basename, dirname, ellipsizePath } from './paths';

/**
 * One open file in the workspace.
 *
 * Every editor tab is this component with a different `path` parameter. It owns
 * no content — the buffer lives in the editors store — so a tab can be dragged
 * between dock groups (which unmounts and remounts it) without losing edits.
 *
 * The header is the same for every file type, because the questions are always
 * the same: what am I looking at, where is it, and is it saved.
 */

interface Params {
  path: string;
}

function Notice({ tone, children }: { tone: 'info' | 'warn'; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Typography
      sx={{
        px: 1.5,
        py: 0.75,
        fontSize: 11.5,
        lineHeight: 1.5,
        color:
          tone === 'warn' ? theme.aa.color.status.warning : theme.aa.color.text.secondary,
        backgroundColor: theme.aa.color.bg.panel,
        borderBottom: `1px solid ${theme.aa.color.border.subtle}`,
      }}
    >
      {children}
    </Typography>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1.25,
        px: 4,
        textAlign: 'center',
      }}
    >
      {children}
    </Box>
  );
}

export const EditorPanel: FunctionComponent<IDockviewPanelProps<Params>> = ({
  params,
  api,
}) => {
  const theme = useTheme();
  const path = params.path;
  const doc = useEditorDoc(path);
  const dirty = isDirty(doc);

  /* Keep the tab honest about unsaved work. A leading dot is the convention
     every editor uses and needs no legend. */
  useEffect(() => {
    api.setTitle(`${dirty ? '\u25CF ' : ''}${doc?.name ?? basename(path)}`);
  }, [api, dirty, doc?.name, path]);

  /* Tell the store which file Ctrl+S and File ▸ Save should act on. Dockview
     reports activation for every panel, so the check is which one *this* is. */
  useEffect(() => {
    if (api.isActive) setFocusedEditor(path);
    const subscription = api.onDidActiveChange((event) => {
      if (event.isActive) setFocusedEditor(path);
    });
    return () => subscription.dispose();
  }, [api, path]);

  const handleSave = useCallback(() => {
    void saveDoc(path);
  }, [path]);

  if (!doc || doc.status === 'loading') {
    return (
      <Centered>
        <CircularProgress size={18} />
        <Typography sx={{ fontSize: 12, color: theme.aa.color.text.muted }}>
          Opening {basename(path)}…
        </Typography>
      </Centered>
    );
  }

  if (doc.status === 'error') {
    return (
      <Centered>
        <Typography sx={{ fontSize: 12.5, color: theme.aa.color.status.error }}>
          {doc.error}
        </Typography>
        <Typography sx={{ fontSize: 11.5, color: theme.aa.color.text.muted }}>
          {path}
        </Typography>
      </Centered>
    );
  }

  const view = documentViewFor(doc.kind, path);
  const canSave = dirty && !doc.readOnly && !doc.truncated && !doc.binary;

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        backgroundColor: theme.aa.color.bg.editor,
      }}
    >
      {/* Header: identity on the left, state and actions on the right. */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.25,
          height: 30,
          flexShrink: 0,
          borderBottom: `1px solid ${theme.aa.color.border.subtle}`,
          backgroundColor: theme.aa.color.bg.chrome,
        }}
      >
        {view === 'image' ? (
          <ImageOutlined sx={{ fontSize: 14, color: theme.aa.color.text.muted }} />
        ) : view === 'unsupported' ? (
          <InsightsOutlined sx={{ fontSize: 14, color: theme.aa.color.accent.main }} />
        ) : (
          <DescriptionOutlined sx={{ fontSize: 14, color: theme.aa.color.text.muted }} />
        )}

        <Tooltip title={path} placement="bottom-start" disableInteractive>
          <Typography
            sx={{
              fontFamily: theme.aa.font.mono,
              fontSize: 11.5,
              color: theme.aa.color.text.muted,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {ellipsizePath(dirname(path))}
          </Typography>
        </Tooltip>

        <Box sx={{ flex: 1 }} />

        {doc.saving && <CircularProgress size={11} />}
        {doc.saveError && (
          <Typography sx={{ fontSize: 11.5, color: theme.aa.color.status.error }}>
            {doc.saveError}
          </Typography>
        )}
        {doc.readOnly && !doc.binary && (
          <Typography sx={{ fontSize: 11, color: theme.aa.color.text.muted }}>
            Read-only
          </Typography>
        )}

        <CopyPathButton value={path} label="Copy path" alwaysVisible size={13} />

        {!doc.binary && (
          <>
            <Tooltip title={dirty ? 'Discard changes and reload' : 'Reload from disk'}>
              <Typography
                component="button"
                onClick={() => revertDoc(path)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  background: 'none',
                  border: 'none',
                  p: 0.25,
                  cursor: 'pointer',
                  color: theme.aa.color.text.secondary,
                  '&:hover': { color: theme.aa.color.text.primary },
                }}
              >
                <RestoreOutlined sx={{ fontSize: 14 }} />
              </Typography>
            </Tooltip>

            <Tooltip
              title={
                doc.readOnly
                  ? "You don't have permission to write this file"
                  : doc.truncated
                    ? 'Saving is disabled for a partially loaded file'
                    : 'Save  (Ctrl+S)'
              }
            >
              <Typography
                component="button"
                disabled={!canSave}
                onClick={handleSave}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.4,
                  fontSize: 11.5,
                  background: 'none',
                  border: 'none',
                  px: 0.5,
                  py: 0.25,
                  borderRadius: `${theme.aa.radius.sm}px`,
                  cursor: canSave ? 'pointer' : 'default',
                  color: canSave
                    ? theme.aa.color.accent.main
                    : theme.aa.color.text.disabled,
                  '&:hover': canSave
                    ? { backgroundColor: theme.aa.color.bg.hover }
                    : undefined,
                }}
              >
                <SaveOutlined sx={{ fontSize: 14 }} />
                {dirty ? 'Save' : 'Saved'}
              </Typography>
            </Tooltip>
          </>
        )}
      </Box>

      {doc.detail && !doc.binary && <Notice tone="warn">{doc.detail}</Notice>}

      {view === 'unsupported' || (doc.binary && view !== 'image') ? (
        <Centered>
          <InsightsOutlined
            sx={{ fontSize: 30, color: theme.aa.color.text.muted, opacity: 0.8 }}
          />
          <Typography
            sx={{ fontSize: 12.5, color: theme.aa.color.text.secondary, maxWidth: 420 }}
          >
            {doc.detail || unsupportedReason(doc.kind)}
          </Typography>
          <Typography
            sx={{ fontFamily: theme.aa.font.mono, fontSize: 11, color: theme.aa.color.text.muted }}
          >
            {path}
          </Typography>
        </Centered>
      ) : view === 'image' ? (
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: 2,
            // A checkerboard reads through transparent PNGs, which echogram
            // plots often are.
            backgroundImage:
              'linear-gradient(45deg, #23272f 25%, transparent 25%),' +
              'linear-gradient(-45deg, #23272f 25%, transparent 25%),' +
              'linear-gradient(45deg, transparent 75%, #23272f 75%),' +
              'linear-gradient(-45deg, transparent 75%, #23272f 75%)',
            backgroundSize: '16px 16px',
            backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
          }}
        >
          <Box
            component="img"
            src={filesApi.rawUrl(path)}
            alt={doc.name}
            sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
        </Box>
      ) : view === 'notebook' ? (
        <NotebookEditor
          text={doc.text}
          readOnly={doc.readOnly || doc.truncated}
          onChange={(next) => setDocText(path, next)}
          onSave={handleSave}
        />
      ) : (
        <CodeEditor
          value={doc.text}
          language={languageFor(path)}
          readOnly={doc.readOnly || doc.truncated}
          ariaLabel={`Contents of ${doc.name}`}
          onChange={(next) => setDocText(path, next)}
          onSave={handleSave}
        />
      )}
    </Box>
  );
};
