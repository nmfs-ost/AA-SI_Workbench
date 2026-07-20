import { useEffect } from 'react';
import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { Alert, Box, Button, Chip, Divider, Typography, useTheme } from '@mui/material';
import ScienceOutlined from '@mui/icons-material/ScienceOutlined';
import RestartAltOutlined from '@mui/icons-material/RestartAltOutlined';

import { ParamControl } from '../pipelines/ParamControl';
import { useActiveAsset } from '../../../state/activeAsset';
import {
  initCalibration,
  resetCalibration,
  setCalibrationValue,
  useCalibration,
} from '../../../state/calibration';
import { calibrationDefaults, calibrationSections } from './calibrationSchema';

/**
 * Calibration panel.
 *
 * Holds the environment and transducer values that Sv computation depends on.
 * It is declared as a schema and rendered through the shared `ParamControl`, so
 * changing what appears here is a matter of editing `calibrationSchema.ts` — no
 * component changes — which makes it cheap to reshape once the requirements
 * settle.
 */
export const CalibrationPanel: FunctionComponent<IDockviewPanelProps> = () => {
  const theme = useTheme();
  const values = useCalibration();
  const asset = useActiveAsset();

  useEffect(() => {
    initCalibration(calibrationDefaults());
  }, []);

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: theme.aa.color.bg.panel,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.25,
          minHeight: 30,
          borderBottom: `1px solid ${theme.aa.color.border.subtle}`,
          color: theme.aa.color.text.secondary,
        }}
      >
        <ScienceOutlined sx={{ fontSize: 16 }} />
        <Typography sx={{ fontSize: 12, fontWeight: 600, flex: 1 }}>
          Calibration
        </Typography>
        {asset && (
          <Chip
            label={asset.sonar}
            size="small"
            sx={{
              height: 17,
              fontSize: 10,
              backgroundColor: theme.aa.color.bg.elevated,
              color: theme.aa.color.text.secondary,
            }}
          />
        )}
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 1.25 }}>
        <Typography
          sx={{ fontSize: 11.5, color: theme.aa.color.text.secondary, mb: 0.5 }}
        >
          {asset
            ? `Applied to ${asset.fileName} (${asset.sonar}).`
            : 'Select a file in the NCEI panel to calibrate against it.'}
        </Typography>

        <Alert severity="info" sx={{ fontSize: 11.5, mb: 1.75, py: 0.25 }}>
          Starting point — these are the values Sv computation normally needs.
          Nothing is applied yet; tell me what belongs here and it is one schema
          edit away.
        </Alert>

        {calibrationSections.map((section) => (
          <Box key={section.id} sx={{ mb: 2 }}>
            <Typography
              sx={{ fontSize: 11.5, fontWeight: 600, color: theme.aa.color.text.primary }}
            >
              {section.title}
            </Typography>
            <Typography sx={{ fontSize: 11, color: theme.aa.color.text.muted, mb: 1 }}>
              {section.description}
            </Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              {section.params.map((param) => (
                <ParamControl
                  key={param.id}
                  param={param}
                  value={values[param.id] ?? param.default}
                  onChange={(next) => setCalibrationValue(param.id, next)}
                />
              ))}
            </Box>

            <Divider sx={{ mt: 1.75 }} />
          </Box>
        ))}
      </Box>

      {/* Actions */}
      <Box
        sx={{
          borderTop: `1px solid ${theme.aa.color.border.subtle}`,
          backgroundColor: theme.aa.color.bg.chrome,
          p: 1,
          display: 'flex',
        }}
      >
        <Button
          size="small"
          startIcon={<RestartAltOutlined />}
          onClick={() => resetCalibration(calibrationDefaults())}
          sx={{ fontSize: 11.5 }}
        >
          Reset to defaults
        </Button>
      </Box>
    </Box>
  );
};
