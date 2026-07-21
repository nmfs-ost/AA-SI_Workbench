import { useEffect } from 'react';
import { Box } from '@mui/material';

import { DialogHost } from '../dialogs';
import { MenuBar } from './MenuBar';
import { SideBar } from './SideBar';
import { DockLayout } from './DockLayout';
import { StatusBar } from './StatusBar';
import {
  getEditorsState,
  isDirty,
  saveActiveDoc,
  subscribeEditors,
} from '../../state/editors';

/**
 * The application shell. A fixed vertical stack — menu bar, docking surface,
 * status bar — filling the viewport. The docking surface is the only region
 * that grows; everything else keeps its fixed height.
 *
 * There used to be a toolbar strip between the menu bar and the dock. Its six
 * placeholder buttons were removed when they turned out to do nothing, and its
 * remaining two moved into the left icon strip, at which point a 34px empty
 * band was all that was left of it. Deleting it also lets each strip's first
 * icon sit flush with the top of the dock beside it.
 *
 * The middle band is a row: an icon strip pinned to each outer edge, outside
 * Dockview, so neither can be dragged away or docked somewhere unexpected.
 * Between them sits everything that moves. The strips are the one piece of
 * navigation that always stays put.
 *
 * `DialogHost` is mounted once here so shell dialogs (About, environment
 * update, feedback, New file) can be opened from the menu bar, the toolbar, or
 * anywhere else, without any of them owning the modal.
 */
export function AppShell() {
  /* The browser's own "leave site?" prompt is the only thing that can stop a
     tab close from discarding unsaved edits, so it's worth the five lines. */
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const unsaved = Object.values(getEditorsState().docs).some(isDirty);
      if (unsaved) event.preventDefault();
    };
    /* Ctrl+S anywhere saves the fronted file. Without this the browser's own
       "save this page" dialog appears, which is never what was meant. */
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
      if (!getEditorsState().focusedPath) return;
      event.preventDefault();
      void saveActiveDoc();
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('keydown', onKeyDown);
    const unsubscribe = subscribeEditors(() => {});
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('keydown', onKeyDown);
      unsubscribe();
    };
  }, []);

  return (
    <Box
      sx={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: (theme) => theme.aa.color.bg.editor,
      }}
    >
      <MenuBar />
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <SideBar side="left" />
        <DockLayout />
        <SideBar side="right" />
      </Box>
      <StatusBar />
      <DialogHost />
    </Box>
  );
}
