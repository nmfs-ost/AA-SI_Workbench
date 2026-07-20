import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Link,
  Snackbar,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from '@mui/material';
import BugReportOutlined from '@mui/icons-material/BugReportOutlined';
import LightbulbOutlined from '@mui/icons-material/LightbulbOutlined';
import OpenInNewOutlined from '@mui/icons-material/OpenInNewOutlined';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';

import { MAX_PREFILL_URL_LENGTH, newIssueUrl, repo } from '../../config/repo';
import { loadEnvironment, useEnvironment } from '../../state/environment';
import {
  environmentReport,
  getIssueTemplate,
  issueTemplates,
  type IssueFieldDef,
} from './issueTemplates';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Which form to preselect ('bug' | 'feature'), from the menu item. */
  payload?: string;
}

const TEMPLATE_ICONS: Record<string, typeof BugReportOutlined> = {
  bug: BugReportOutlined,
  feature: LightbulbOutlined,
};

/**
 * Report a bug or suggest an improvement against the repo's GitHub issue forms.
 *
 * The Workbench holds no GitHub credentials and never will (it would mean
 * shipping a token to every workstation), so this composes a *prefilled* issue
 * URL and hands off to GitHub, where the user reviews and submits under their
 * own account. The form is generated from `issueTemplates.ts`, whose field ids
 * are the prefill keys GitHub matches against `.github/ISSUE_TEMPLATE/*.yml`.
 */
export function FeedbackDialog({ open, onClose, payload }: Props) {
  const theme = useTheme();
  const environment = useEnvironment();

  const [templateId, setTemplateId] = useState(payload || 'bug');
  const [title, setTitle] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [includeEnvironment, setIncludeEnvironment] = useState(true);
  const [toast, setToast] = useState('');

  const template = getIssueTemplate(templateId);
  const autofillField = template.fields.find((f) => f.autofill === 'environment');

  // Environment details are only fetched when a form that can use them opens.
  useEffect(() => {
    if (open && autofillField && !environment.info && !environment.infoLoading) {
      void loadEnvironment();
    }
  }, [open, autofillField, environment.info, environment.infoLoading]);

  useEffect(() => {
    if (open) setTemplateId(payload || 'bug');
  }, [open, payload]);

  const report = useMemo(
    () => environmentReport(environment.info),
    [environment.info],
  );

  const fieldValue = (field: IssueFieldDef): string => {
    if (field.autofill === 'environment' && values[field.id] === undefined) {
      return includeEnvironment ? report : '';
    }
    return values[field.id] ?? '';
  };

  const url = useMemo(() => {
    const fields: Record<string, string> = {};
    for (const field of template.fields) {
      const value = fieldValue(field);
      if (field.autofill === 'environment' && !includeEnvironment) continue;
      fields[field.id] = value;
    }
    return newIssueUrl(template.file, title, fields);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, title, values, includeEnvironment, report]);

  const missing = template.fields.filter(
    (field) => field.required && !fieldValue(field).trim(),
  );
  const tooLong = url.length > MAX_PREFILL_URL_LENGTH;
  const canSubmit = missing.length === 0 && !tooLong;

  const reset = () => {
    setTitle('');
    setValues({});
    setIncludeEnvironment(true);
  };

  const handleClose = () => {
    onClose();
    reset();
  };

  const openOnGitHub = () => {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) {
      setToast('Your browser blocked the new tab — use “Copy link” instead.');
      return;
    }
    handleClose();
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast(`${label} copied to the clipboard.`);
    } catch {
      setToast('Could not access the clipboard in this browser context.');
    }
  };

  return (
    <>
      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 15, fontWeight: 600, pb: 1 }}>
          Feedback &amp; issues
          <Typography
            component="div"
            sx={{ fontSize: 12, color: theme.aa.color.text.muted, mt: 0.25 }}
          >
            Opens a prefilled form on {repo.slug} — you review and submit it there.
          </Typography>
        </DialogTitle>

        <DialogContent dividers sx={{ borderColor: theme.aa.color.border.subtle }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={templateId}
            onChange={(_, next: string | null) => next && setTemplateId(next)}
            sx={{ mb: 1.5 }}
          >
            {issueTemplates.map((item) => {
              const Icon = TEMPLATE_ICONS[item.id] ?? BugReportOutlined;
              return (
                <ToggleButton key={item.id} value={item.id} sx={{ px: 1.5, gap: 0.75 }}>
                  <Icon sx={{ fontSize: 16 }} />
                  {item.label}
                </ToggleButton>
              );
            })}
          </ToggleButtonGroup>

          <Typography
            sx={{ fontSize: 12, color: theme.aa.color.text.muted, mb: 1.5 }}
          >
            {template.summary} Labelled {template.labels.join(', ')} on GitHub.
          </Typography>

          <TextField
            fullWidth
            size="small"
            label="Title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={
              template.id === 'bug'
                ? 'Metadata panel stays empty after selecting a file'
                : 'Add a channel picker to the combine action'
            }
            sx={{ mb: 1.75 }}
          />

          {template.fields.map((field) => {
            const isAutofill = field.autofill === 'environment';
            if (isAutofill && !includeEnvironment) return null;
            return (
              <TextField
                key={field.id}
                fullWidth
                size="small"
                label={field.label}
                required={field.required}
                multiline={field.multiline}
                rows={field.rows}
                helperText={field.helperText}
                placeholder={field.placeholder}
                value={fieldValue(field)}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [field.id]: e.target.value }))
                }
                sx={{
                  mb: 1.5,
                  ...(isAutofill
                    ? { '& .MuiInputBase-input': { fontFamily: theme.aa.font.mono, fontSize: 11.5 } }
                    : {}),
                }}
              />
            );
          })}

          {autofillField && (
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={includeEnvironment}
                  onChange={(e) => setIncludeEnvironment(e.target.checked)}
                />
              }
              label={
                <Typography sx={{ fontSize: 12.5 }}>
                  Include environment details (versions and platform only)
                </Typography>
              }
              sx={{ mb: 1 }}
            />
          )}

          {tooLong && (
            <Alert severity="warning" sx={{ fontSize: 12.5, mb: 1 }}>
              This is too long to prefill through a URL ({url.length} characters).
              Shorten it, or copy the details and paste them into a blank issue.
            </Alert>
          )}

          <Alert severity="info" icon={false} sx={{ fontSize: 12, py: 0.5 }}>
            Nothing is sent from the Workbench. You need GitHub access to{' '}
            <Link href={repo.url} target="_blank" rel="noopener noreferrer">
              {repo.slug}
            </Link>
            . For a security vulnerability use the{' '}
            <Link href={repo.securityUrl} target="_blank" rel="noopener noreferrer">
              private advisory
            </Link>{' '}
            instead — never a public issue. Please leave out embargoed data.
          </Alert>
        </DialogContent>

        <DialogActions sx={{ px: 2, py: 1.25, gap: 0.5 }}>
          <Button
            size="small"
            variant="text"
            startIcon={<ContentCopyOutlined sx={{ fontSize: 16 }} />}
            onClick={() =>
              void copy(
                tooLong ? Object.values(values).join('\n\n') : url,
                tooLong ? 'Issue text' : 'Link',
              )
            }
          >
            {tooLong ? 'Copy text' : 'Copy link'}
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button size="small" variant="text" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            size="small"
            variant="contained"
            disabled={!canSubmit || !title.trim()}
            endIcon={<OpenInNewOutlined sx={{ fontSize: 16 }} />}
            onClick={openOnGitHub}
          >
            Open on GitHub
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(toast)}
        message={toast}
        autoHideDuration={5000}
        onClose={() => setToast('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </>
  );
}
