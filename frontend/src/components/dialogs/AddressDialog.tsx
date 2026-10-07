import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { CheckRounded, ContentCopyOutlined, LinkRounded } from '@mui/icons-material';

import { getAddress, withoutSignInToken, type Address } from '../../services/addressApi';
import { copyText } from '../panels/CopyPathButton';
import type { DialogComponentProps } from './registry';

/**
 * Help ▸ Link to this Workbench: the address to bookmark, which stays the same
 * from one session to the next, and the tunnel that gives the same address on
 * your own computer for any workstation.
 */
export function AddressDialog({ open, onClose }: DialogComponentProps) {
  const theme = useTheme();
  const c = theme.aa.color;
  const [address, setAddress] = useState<Address | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    getAddress()
      .then(setAddress)
      .catch((e: Error) => setError(e.message));
  }, [open]);

  // Off a workstation the page's own address is the one to keep.
  const here = withoutSignInToken(window.location.origin + '/');
  const link = address?.url || here;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <LinkRounded sx={{ fontSize: 20, color: c.accent.main }} />
        Link to this Workbench
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box>
          <Typography sx={{ fontSize: 12.5, fontWeight: 600, mb: 0.5 }}>Bookmark this</Typography>
          <Copyable text={link} />
          <Typography sx={{ fontSize: 11.5, color: c.text.secondary, mt: 0.75, lineHeight: 1.55 }}>
            {address?.workstation
              ? `It is the same every time you start the Workbench on this workstation (${address.name}), on port ${address.port}. A link that ends in ?_workstationAccessToken=… is a one-time sign-in and differs each time; this one does not, and your browser signs in by itself when you open it.`
              : 'The address this page was opened at.'}
          </Typography>
        </Box>
        {address?.workstation && (
          <Box>
            <Typography sx={{ fontSize: 12.5, fontWeight: 600, mb: 0.5 }}>
              The same address for any workstation, from your own computer
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: c.text.secondary, mb: 0.75, lineHeight: 1.55 }}>
              With the Google Cloud CLI on your computer, this starts the workstation if it is stopped and brings
              the Workbench to <b>{address.localUrl}</b>. Fill in the project, region, cluster and configuration
              from the workstation’s page in the Cloud console, once.
            </Typography>
            <Copyable text={address.tunnel} mono />
          </Box>
        )}
        <Typography sx={{ fontSize: 11, color: c.text.muted, lineHeight: 1.55 }}>
          One address for a whole team (a domain of your own, or a link that finds each person’s workstation) is
          set up by an administrator: see docs/guides/stable-address.md. The terminal command{' '}
          <Box component="code" sx={{ fontFamily: theme.aa.font.mono }}>
            aa-workbench url
          </Box>{' '}
          prints all of this too.
        </Typography>
        {error && <Typography sx={{ fontSize: 11.5, color: c.status.warning }}>{error}</Typography>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function Copyable({ text, mono = false }: { text: string; mono?: boolean }) {
  const theme = useTheme();
  const c = theme.aa.color;
  const [copied, setCopied] = useState(false);
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1,
        p: 1,
        borderRadius: `${theme.aa.radius.md}px`,
        border: `1px solid ${c.border.subtle}`,
        backgroundColor: c.bg.editor,
      }}
    >
      <Typography
        sx={{
          flex: 1,
          minWidth: 0,
          fontSize: mono ? 11.5 : 13,
          fontFamily: mono ? theme.aa.font.mono : undefined,
          wordBreak: 'break-all',
          color: c.text.primary,
          userSelect: 'all',
        }}
      >
        {text}
      </Typography>
      <Tooltip title={copied ? 'Copied' : 'Copy'}>
        <IconButton
          size="small"
          aria-label="Copy"
          onClick={async () => {
            if (await copyText(text)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          }}
        >
          {copied ? <CheckRounded sx={{ fontSize: 16 }} /> : <ContentCopyOutlined sx={{ fontSize: 16 }} />}
        </IconButton>
      </Tooltip>
    </Box>
  );
}
