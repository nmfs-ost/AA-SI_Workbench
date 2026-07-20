import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Stack,
  Typography,
  useTheme,
} from '@mui/material';

import { repo } from '../../config/repo';
import { useEnvironment } from '../../state/environment';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * About box. Version is shown only when the environment has already been read
 * (opening About must not trigger a backend call of its own).
 */
export function AboutDialog({ open, onClose }: Props) {
  const theme = useTheme();
  const { info } = useEnvironment();

  const linkSx = { fontSize: 12.5 } as const;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15, fontWeight: 600 }}>About AA-SI</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 13, mb: 1 }}>
          AA-SI Workbench — Active Acoustics Strategic Initiative.
          <br />
          NOAA Fisheries, Office of Science and Technology.
        </Typography>
        <Typography sx={{ fontSize: 12, color: theme.aa.color.text.muted, mb: 1.5 }}>
          A desktop-style front end for the aa-* console tools.
          {info ? ` Version ${info.workbenchVersion}.` : ''}
        </Typography>
        <Stack spacing={0.5}>
          <Link href={repo.url} target="_blank" rel="noopener noreferrer" sx={linkSx}>
            {repo.slug}
          </Link>
          <Link href={repo.docsUrl} target="_blank" rel="noopener noreferrer" sx={linkSx}>
            Documentation
          </Link>
          <Link
            href={repo.discussionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            sx={linkSx}
          >
            Discussions
          </Link>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="text" size="small">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
