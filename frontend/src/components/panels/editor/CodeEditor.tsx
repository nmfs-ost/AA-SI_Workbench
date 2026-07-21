import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Box, useTheme } from '@mui/material';

import { highlight } from './highlight';
import type { Language } from './language';

/**
 * A plain-text code editor.
 *
 * The technique is an old one: a transparent `<textarea>` sits exactly on top
 * of a `<pre>` holding the same text, coloured. The browser handles the caret,
 * selection, IME, undo stack and accessibility — all the parts that are hard —
 * and the layer underneath only has to paint. The two stay aligned because
 * they share one set of font metrics, defined once below, and because the
 * highlighter never adds or removes a character.
 *
 * Wrapping is off deliberately. Soft-wrapped code makes the gutter lie about
 * line numbers, and a scientist reading a fixed-width data file wants the
 * columns to line up more than they want to avoid a horizontal scrollbar.
 */

interface Props {
  value: string;
  language: Language;
  onChange: (next: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
  ariaLabel?: string;
  /** Grow to fit the content instead of filling the parent. Notebook cells. */
  autoHeight?: boolean;
  /** Line numbers. On for whole files, off inside notebook cells (as Jupyter). */
  showGutter?: boolean;
  placeholder?: string;
}

/* One source of metrics for all three layers. Changing any of these without
   changing all of them is what breaks alignment. */
const FONT_SIZE = 12.5;
const LINE_HEIGHT = 19;
const PAD_Y = 8;
const PAD_X = 10;
const INDENT = '    '; // Python's four spaces; the dominant language here.

export function CodeEditor({
  value,
  language,
  onChange,
  onSave,
  readOnly = false,
  ariaLabel = 'File contents',
  autoHeight = false,
  showGutter = true,
  placeholder,
}: Props) {
  const theme = useTheme();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  /** Caret position to restore after a programmatic edit (Tab, dedent). */
  const pendingCaretRef = useRef<number | null>(null);

  const html = useMemo(() => highlight(value, language), [value, language]);

  const lineCount = useMemo(() => {
    let count = 1;
    for (let i = 0; i < value.length; i += 1) if (value[i] === '\n') count += 1;
    return count;
  }, [value]);

  const gutterText = useMemo(
    () =>
      Array.from({ length: lineCount }, (_, index) => String(index + 1)).join('\n'),
    [lineCount],
  );

  const syncScroll = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (preRef.current) {
      preRef.current.scrollTop = textarea.scrollTop;
      preRef.current.scrollLeft = textarea.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = textarea.scrollTop;
  }, []);

  // Re-sync after the text changes: a paste can move the scroll position
  // before any scroll event fires.
  useEffect(syncScroll, [value, syncScroll]);

  useLayoutEffect(() => {
    const caret = pendingCaretRef.current;
    if (caret === null || !textareaRef.current) return;
    textareaRef.current.setSelectionRange(caret, caret);
    pendingCaretRef.current = null;
  }, [value]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const target = event.currentTarget;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        onSave?.();
        return;
      }

      if (event.key !== 'Tab' || readOnly) return;
      event.preventDefault();
      const { selectionStart, selectionEnd } = target;

      if (event.shiftKey) {
        // Dedent: remove up to one indent's worth of spaces before the caret.
        const before = value.slice(0, selectionStart);
        const stripped = before.replace(/ {1,4}$/, '');
        if (stripped === before) return;
        pendingCaretRef.current = stripped.length;
        onChange(stripped + value.slice(selectionEnd));
        return;
      }

      // Insert an indent, replacing any selection. Block indent of a
      // multi-line selection isn't implemented — it's the rarer case, and a
      // half-correct version is worse than none.
      pendingCaretRef.current = selectionStart + INDENT.length;
      onChange(value.slice(0, selectionStart) + INDENT + value.slice(selectionEnd));
    },
    [onChange, onSave, readOnly, value],
  );

  const sharedTextSx = {
    margin: 0,
    fontFamily: theme.aa.font.mono,
    fontSize: FONT_SIZE,
    lineHeight: `${LINE_HEIGHT}px`,
    letterSpacing: 0,
    tabSize: 4,
    whiteSpace: 'pre' as const,
    wordBreak: 'normal' as const,
    overflowWrap: 'normal' as const,
  };

  return (
    <Box
      sx={{
        // Auto-height keeps every line of a notebook cell visible at once, so
        // the notebook scrolls as one document rather than as a column of
        // independently scrolling boxes.
        ...(autoHeight
          ? { flex: 'none', height: lineCount * LINE_HEIGHT + PAD_Y * 2 }
          : { flex: 1, minHeight: 0 }),
        display: 'flex',
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: 'transparent',
        '& .tok-com': { color: theme.aa.color.syntax.comment, fontStyle: 'italic' },
        '& .tok-str': { color: theme.aa.color.syntax.string },
        '& .tok-kw': { color: theme.aa.color.syntax.keyword },
        '& .tok-num': { color: theme.aa.color.syntax.number },
        '& .tok-fn': { color: theme.aa.color.syntax.entity },
        '& .tok-op': { color: theme.aa.color.syntax.entity },
        '& .tok-var': { color: theme.aa.color.syntax.reference },
      }}
    >
      {/* Line numbers. Scrolls with the text but is never selectable, so
          copying a region of code doesn't drag the numbers along with it. */}
      {showGutter && (
      <Box
        ref={gutterRef}
        aria-hidden
        sx={{
          ...sharedTextSx,
          flexShrink: 0,
          overflow: 'hidden',
          textAlign: 'right',
          userSelect: 'none',
          px: 1,
          py: `${PAD_Y}px`,
          minWidth: `${String(lineCount).length + 1}ch`,
          color: theme.aa.color.text.muted,
          borderRight: `1px solid ${theme.aa.color.border.subtle}`,
          backgroundColor: theme.aa.color.bg.editor,
        }}
      >
        {gutterText}
      </Box>
      )}

      <Box sx={{ position: 'relative', flex: 1, minWidth: 0 }}>
        <Box
          component="pre"
          ref={preRef}
          aria-hidden
          sx={{
            ...sharedTextSx,
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
            padding: `${PAD_Y}px ${PAD_X}px`,
            color: theme.aa.color.text.primary,
          }}
          // Safe by construction: highlight() escapes every character it
          // emits. See the escaping test in frontend/tests.
          dangerouslySetInnerHTML={{ __html: `${html}\n` }}
        />

        <Box
          component="textarea"
          ref={textareaRef}
          value={value}
          aria-label={ariaLabel}
          placeholder={placeholder}
          readOnly={readOnly}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
            onChange(event.target.value)
          }
          onKeyDown={handleKeyDown}
          onScroll={syncScroll}
          sx={{
            ...sharedTextSx,
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            display: 'block',
            resize: 'none',
            border: 'none',
            outline: 'none',
            padding: `${PAD_Y}px ${PAD_X}px`,
            overflow: 'auto',
            backgroundColor: 'transparent',
            // The text underneath does the painting; this layer only carries
            // the caret and the selection.
            color: 'transparent',
            caretColor: theme.aa.color.accent.main,
            '&::selection': { backgroundColor: theme.aa.color.accent.soft },
            '&::placeholder': { color: theme.aa.color.text.muted },
          }}
        />
      </Box>
    </Box>
  );
}
