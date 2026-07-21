import { useCallback, useEffect, useRef, useState } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import { CheckOutlined, ContentCopyOutlined } from '@mui/icons-material';

/**
 * Copy an absolute path to the clipboard.
 *
 * One component so that every list of files in the application — local disk,
 * the NCEI archive, the derived bucket, an open editor tab — offers the same
 * affordance in the same place with the same feedback. "Absolute" means
 * whatever fully identifies the file in *its own* storage system: a POSIX path
 * on the workstation, an `s3://` URI in NCEI, a `gs://` URI in the bucket.
 * That distinction is the reason the label is configurable.
 *
 * It sits at the right edge of a row and stays invisible until the row is
 * hovered or the button is focused — the affordance is there for the hand that
 * reaches for it, without putting an icon on every line of a dense tree. Rows
 * opt in by setting `'&:hover .aa-copy': { opacity: 1 }`.
 */

interface Props {
  /** The exact string to place on the clipboard. */
  value: string;
  /** What the tooltip calls it, e.g. "Copy path" or "Copy s3:// URI". */
  label?: string;
  /** Render at full opacity instead of appearing on hover. */
  alwaysVisible?: boolean;
  size?: number;
}

/**
 * `navigator.clipboard` needs a secure context. The Workbench is normally
 * reached over https through the Cloud Workstation preview, but a plain-http
 * localhost session is a legitimate way to run it, and there the modern API is
 * absent. The deprecated `execCommand` path is the fallback that keeps the
 * button working rather than failing silently.
 */
async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }
  try {
    const scratch = document.createElement('textarea');
    scratch.value = value;
    scratch.setAttribute('readonly', '');
    scratch.style.position = 'fixed';
    scratch.style.opacity = '0';
    document.body.appendChild(scratch);
    scratch.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(scratch);
    return copied;
  } catch {
    return false;
  }
}

export function CopyPathButton({
  value,
  label = 'Copy path',
  alwaysVisible = false,
  size = 12,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const handleCopy = useCallback(
    async (event: React.MouseEvent) => {
      // Rows are clickable; copying must not also select or expand them.
      event.stopPropagation();
      event.preventDefault();
      const ok = await copyText(value);
      setCopied(ok);
      setFailed(!ok);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setCopied(false);
        setFailed(false);
      }, 1400);
    },
    [value],
  );

  const tooltip = copied ? 'Copied' : failed ? 'Copy failed — select the path instead' : label;

  return (
    <Tooltip title={tooltip} placement="left" disableInteractive>
      <IconButton
        className="aa-copy"
        size="small"
        aria-label={label}
        onClick={(event) => void handleCopy(event)}
        sx={{
          p: 0.25,
          flexShrink: 0,
          opacity: alwaysVisible || copied ? 1 : 0,
          transition: 'opacity .12s',
          // Keyboard users never trigger the row hover, so focus reveals it too.
          '&:focus-visible': { opacity: 1 },
        }}
      >
        {copied ? (
          <CheckOutlined sx={{ fontSize: size, color: 'success.main' }} />
        ) : (
          <ContentCopyOutlined sx={{ fontSize: size }} />
        )}
      </IconButton>
    </Tooltip>
  );
}
