import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Box, CircularProgress, Typography, alpha, useTheme } from '@mui/material';
import { GppGoodOutlined, GppMaybeOutlined, ReportOutlined } from '@mui/icons-material';

import type { ActiveSubject } from '../../../state/activeSubject';
import type { Provenance } from '../../../services/baselineApi';
import { provenanceApi } from '../../../services/baselineApi';

/**
 * What a product *is*, from the provenance the console tools wrote into it.
 *
 * Every product of an aa-* tool carries a record of how it was made: which
 * tools, with which scientific settings, from which raw files, with which
 * software. `aa-metadata --json --verify` reads it (for a bucket object, from
 * the small sidecar published beside it, so a survey-sized file is not
 * downloaded to answer), and checks the product hash. This view is that
 * record, laid out for reading.
 */

interface Step {
  tool?: string;
  op?: string;
  params?: Record<string, unknown>;
  engine?: Record<string, string>;
  scientific?: boolean;
}

interface Doc {
  base?: string;
  created?: { at?: string; user?: string; host?: string };
  product?: { kind?: string; short?: string; hash?: string; recipe?: string; name?: string };
  pipeline?: Step[];
  sources?: { name?: string; id?: string }[];
  inputs?: { name?: string; uri?: string; role?: string }[];
  software?: Record<string, string>;
}

export function ProvenanceView({ subject }: { subject: ActiveSubject }) {
  const theme = useTheme();
  const c = theme.aa.color;
  const [result, setResult] = useState<Provenance | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setResult(null);
    setError('');
    provenanceApi(subject.uri)
      .then((r) => live && setResult(r))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [subject.uri]);

  const doc = (result?.document ?? null) as Doc | null;

  return (
    <Box sx={{ height: '100%', overflowY: 'auto', p: 1.5, backgroundColor: c.bg.panel }}>
      <Typography
        sx={{ fontFamily: theme.aa.font.mono, fontSize: 12, fontWeight: 600, color: c.text.primary, wordBreak: 'break-all' }}
      >
        {subject.label}
      </Typography>
      <Typography sx={{ fontFamily: theme.aa.font.mono, fontSize: 10.5, color: c.text.muted, wordBreak: 'break-all', mt: 0.25 }}>
        {subject.uri}
      </Typography>

      {!result && !error && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2 }}>
          <CircularProgress size={13} />
          <Typography sx={{ fontSize: 11.5, color: c.text.muted }}>Reading its provenance…</Typography>
        </Box>
      )}
      {(error || (result && !result.found)) && (
        <Typography sx={{ fontSize: 11.5, color: c.text.muted, mt: 2, lineHeight: 1.55 }}>
          {error || result?.message || 'No provenance recorded.'}
        </Typography>
      )}

      {doc && (
        <>
          <Verified verified={result?.verified ?? null} />

          <Section title="Product">
            <Field label="Kind" value={doc.product?.kind} />
            <Field label="Asset" value={doc.base} mono />
            <Field label="Product" value={doc.product?.short ?? doc.product?.hash?.slice(0, 8)} mono
              title={doc.product?.hash} />
            <Field label="Recipe" value={doc.product?.recipe?.slice(0, 8)} mono title={doc.product?.recipe} />
            <Field
              label="Made"
              value={doc.created?.at ? `${doc.created.at.replace('T', ' ').replace('Z', ' UTC')}` : undefined}
            />
            <Field label="By" value={[doc.created?.user, doc.created?.host].filter(Boolean).join(' on ')} />
          </Section>

          {doc.pipeline && doc.pipeline.length > 0 && (
            <Section title={`How it was made · ${doc.pipeline.length} ${doc.pipeline.length === 1 ? 'step' : 'steps'}`}>
              <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                {doc.pipeline.map((step, i) => (
                  <Box key={i} sx={{ display: 'grid', gridTemplateColumns: '14px 1fr', columnGap: 1 }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <Box sx={{ width: 7, height: 7, mt: '5px', borderRadius: '50%', backgroundColor: c.accent.main }} />
                      {i < doc.pipeline!.length - 1 && (
                        <Box sx={{ flex: 1, width: '1px', backgroundColor: alpha(c.accent.main, 0.4), my: 0.25 }} />
                      )}
                    </Box>
                    <Box sx={{ pb: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <Typography sx={{ fontFamily: theme.aa.font.mono, fontSize: 11.5, fontWeight: 600, color: c.syntax.keyword }}>
                          {step.tool}
                        </Typography>
                        <Typography sx={{ fontFamily: theme.aa.font.mono, fontSize: 10.5, color: c.text.muted }}>
                          {step.op}
                        </Typography>
                      </Box>
                      {params(step.params) && (
                        <Typography sx={{ fontFamily: theme.aa.font.mono, fontSize: 10.5, color: c.text.secondary, wordBreak: 'break-word' }}>
                          {params(step.params)}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Section>
          )}

          {doc.sources && doc.sources.length > 0 && (
            <Section title={`From ${doc.sources.length} raw ${doc.sources.length === 1 ? 'file' : 'files'}`}>
              {doc.sources.slice(0, 6).map((s) => (
                <Typography key={s.id ?? s.name} title={s.id}
                  sx={{ fontFamily: theme.aa.font.mono, fontSize: 10.5, color: c.text.secondary, lineHeight: 1.6 }}>
                  {s.name}
                </Typography>
              ))}
              {doc.sources.length > 6 && (
                <Typography sx={{ fontSize: 10.5, color: c.text.muted }}>
                  and {doc.sources.length - 6} more
                </Typography>
              )}
            </Section>
          )}

          {doc.software && (
            <Section title="Software">
              <Typography sx={{ fontFamily: theme.aa.font.mono, fontSize: 10.5, color: c.text.secondary, lineHeight: 1.6 }}>
                {Object.entries(doc.software)
                  .filter(([k]) => ['aalibrary', 'echopype', 'xarray', 'python'].includes(k))
                  .map(([k, v]) => `${k} ${v}`)
                  .join(' · ')}
              </Typography>
            </Section>
          )}
        </>
      )}
    </Box>
  );
}

function params(p: Record<string, unknown> | undefined): string {
  if (!p) return '';
  return Object.entries(p)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join('  ');
}

function Verified({ verified }: { verified: boolean | null }) {
  const theme = useTheme();
  const c = theme.aa.color;
  const look =
    verified === true
      ? { color: c.status.success, Icon: GppGoodOutlined, text: 'Product hash verified' }
      : verified === false
        ? { color: c.status.error, Icon: ReportOutlined, text: 'Contents do not match the recorded hash' }
        : { color: c.text.muted, Icon: GppMaybeOutlined, text: 'Hash not checked' };
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.6,
        mt: 1.25,
        px: 0.9,
        height: 22,
        borderRadius: 11,
        color: look.color,
        backgroundColor: alpha(look.color, 0.1),
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      <look.Icon sx={{ fontSize: 14 }} />
      {look.text}
    </Box>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <Box sx={{ mt: 2 }}>
      <Typography
        sx={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: theme.aa.color.text.muted,
          mb: 0.75,
        }}
      >
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function Field({ label, value, mono = false, title }: { label: string; value?: string; mono?: boolean; title?: string }) {
  const theme = useTheme();
  if (!value) return null;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '70px 1fr', columnGap: 1, py: 0.25 }}>
      <Typography sx={{ fontSize: 11, color: theme.aa.color.text.muted }}>{label}</Typography>
      <Typography
        title={title}
        sx={{
          fontSize: mono ? 10.5 : 11.5,
          fontFamily: mono ? theme.aa.font.mono : theme.aa.font.ui,
          color: theme.aa.color.text.primary,
          wordBreak: 'break-all',
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}
