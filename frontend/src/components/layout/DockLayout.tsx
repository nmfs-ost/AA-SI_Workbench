import { useEffect, useRef } from 'react';
import { DockviewReact } from 'dockview';
import { Box } from '@mui/material';

import { dockviewComponents } from '../panels/registry';
import { PanelTab } from './PanelTab';
import { useLayout } from '../../context/LayoutContext';
import { useThemeMode } from '../../state/theme';
import { baseFor } from '../../theme';
import { getPipelinesState, subscribePipelines } from '../../state/pipelines';
import { getRecipesState, subscribeRecipes } from '../../state/recipes';
import { setConfigurationFocus } from '../../state/configurationFocus';
import { clearOpenRequest, useOpenRequest } from '../../state/editors';

/**
 * The docking surface. Thin wrapper around <DockviewReact />: it supplies the
 * component map from the registry, the tab renderer, and the `onReady` handler
 * from the layout controller, and fills the remaining shell height.
 *
 * It also translates two store signals into layout changes, because this is the
 * one component guaranteed to sit inside the layout provider and therefore to
 * hold the Dockview API:
 *
 *   - a pipeline or a recipe becoming the focused one fronts the
 *     Configuration tab, so selecting a card reveals its settings without
 *     hunting for it. The two features are independent stores that never
 *     import each other; this component is where their one shared surface —
 *     which of them the Configuration panel shows — is arbitrated, by writing
 *     `configurationFocus` from whichever subscription fired last. Chrome
 *     knows about both systems; the systems don't know about each other.
 *   - a request to open a file (from the Files panel, the New dialog, anywhere)
 *     becomes an editor tab in the centre.
 *
 * The `aa-dockview dockview-theme-dark` classes theme Dockview via the CSS
 * variable overrides in src/theme/dockview-overrides.css.
 */
export function DockLayout() {
  const { onReady, openPanel, openEditor } = useLayout();
  const lastActiveRef = useRef<string | null>(getPipelinesState().activePipelineId);
  const lastActiveRecipeRef = useRef<string | null>(getRecipesState().activeRecipeId);
  const openRequest = useOpenRequest();
  const mode = useThemeMode();

  useEffect(() => {
    return subscribePipelines(() => {
      const active = getPipelinesState().activePipelineId;
      if (active !== lastActiveRef.current) {
        lastActiveRef.current = active;
        if (active) {
          setConfigurationFocus('pipelines');
          openPanel('configuration');
        }
      }
    });
  }, [openPanel]);

  useEffect(() => {
    return subscribeRecipes(() => {
      const active = getRecipesState().activeRecipeId;
      if (active !== lastActiveRecipeRef.current) {
        lastActiveRecipeRef.current = active;
        if (active) {
          setConfigurationFocus('recipes');
          openPanel('configuration');
        }
      }
    });
  }, [openPanel]);

  useEffect(() => {
    if (!openRequest) return;
    openEditor(openRequest.path, openRequest.name);
    clearOpenRequest(openRequest.id);
  }, [openEditor, openRequest]);

  return (
    <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
      <DockviewReact
        className={`dockview-theme-${baseFor(mode)} aa-dockview`}
        components={dockviewComponents}
        defaultTabComponent={PanelTab}
        onReady={onReady}
      />
    </Box>
  );
}
