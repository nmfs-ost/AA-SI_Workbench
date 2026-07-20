/**
 * The repo's GitHub issue forms, declared as data.
 *
 * KEEP IN SYNC WITH `.github/ISSUE_TEMPLATE/*.yml`: `file` is the template
 * filename and every `id` must match the corresponding `id:` in that YAML,
 * because GitHub matches prefill query parameters against those ids. Adding a
 * field to a form is an edit here plus an edit there — never a change to
 * FeedbackDialog, which renders whatever this file declares.
 */

import type { EnvironmentInfo } from '../../services/environmentApi';

export interface IssueFieldDef {
  /** Must equal the `id:` of the field in the YAML issue form. */
  id: string;
  label: string;
  helperText?: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  rows?: number;
  /** Prefill from the running environment (offered behind a toggle). */
  autofill?: 'environment';
}

export interface IssueTemplateDef {
  id: string;
  label: string;
  /** Filename under .github/ISSUE_TEMPLATE/. */
  file: string;
  /** One-line description of what this form is for. */
  summary: string;
  /** Labels the form applies on GitHub — shown so the user knows what to expect. */
  labels: string[];
  fields: IssueFieldDef[];
}

export const issueTemplates: readonly IssueTemplateDef[] = [
  {
    id: 'bug',
    label: 'Bug report',
    file: 'bug_report.yml',
    summary: 'Something in the Workbench is not working as expected.',
    labels: ['bug', 'triage'],
    fields: [
      {
        id: 'component',
        label: 'Component',
        helperText: 'Which part of the Workbench is affected?',
        placeholder: 'frontend / backend / docs / other',
        required: true,
      },
      {
        id: 'what-happened',
        label: 'What happened?',
        helperText: 'What you saw, and what you expected instead.',
        required: true,
        multiline: true,
        rows: 4,
      },
      {
        id: 'reproduce',
        label: 'Steps to reproduce',
        helperText: 'Minimal steps that trigger the behaviour.',
        placeholder: '1. Open the NCEI panel\n2. Select a survey\n3. …',
        required: true,
        multiline: true,
        rows: 3,
      },
      {
        id: 'environment',
        label: 'Environment',
        helperText: 'Versions and platform. Filled in for you — edit freely.',
        multiline: true,
        rows: 5,
        autofill: 'environment',
      },
    ],
  },
  {
    id: 'feature',
    label: 'Feature request',
    file: 'feature_request.yml',
    summary: 'Suggest an improvement or a new capability.',
    labels: ['enhancement', 'triage'],
    fields: [
      {
        id: 'problem',
        label: 'Problem / motivation',
        helperText: 'What are you trying to do, and what makes it hard today?',
        required: true,
        multiline: true,
        rows: 4,
      },
      {
        id: 'proposal',
        label: 'Proposed solution',
        helperText: 'What you would like to happen.',
        required: true,
        multiline: true,
        rows: 4,
      },
      {
        id: 'alternatives',
        label: 'Alternatives considered',
        helperText: 'Other approaches you have thought about.',
        multiline: true,
        rows: 3,
      },
    ],
  },
] as const;

export function getIssueTemplate(id: string): IssueTemplateDef {
  return issueTemplates.find((t) => t.id === id) ?? issueTemplates[0];
}

/**
 * The environment block offered for the bug form. Everything here is already
 * visible to the user in the Environment dialog — no paths outside the venv, no
 * credentials, no data. It is shown in an editable field before anything leaves
 * the browser.
 */
export function environmentReport(info: EnvironmentInfo | null): string {
  const lines: string[] = [];
  if (info) {
    lines.push(`Workbench: ${info.workbenchVersion}`);
    lines.push(`Python: ${info.pythonVersion} (${info.platform})`);
    lines.push(
      `Virtualenv: ${info.venvName}${info.isVirtualEnv ? '' : ' (not a virtualenv)'}`,
    );
    const versions = info.tools
      .filter((tool) => tool.version)
      .map((tool) => `${tool.name} ${tool.version}`);
    if (versions.length) lines.push(`Tools: ${versions.join(', ')}`);
    const packages = info.packages
      .filter((pkg) => pkg.version)
      .map((pkg) => `${pkg.name} ${pkg.version}`);
    if (packages.length) lines.push(`Packages: ${packages.join(', ')}`);
  } else {
    lines.push('Workbench: environment details unavailable (API not reachable)');
  }
  if (typeof navigator !== 'undefined') lines.push(`Browser: ${navigator.userAgent}`);
  return lines.join('\n');
}
