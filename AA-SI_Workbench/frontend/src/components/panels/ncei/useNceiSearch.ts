import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  CatalogContext,
  RawFile,
  SonarModel,
  Survey,
  Vessel,
} from './nceiTypes';
import { nceiSource } from './nceiService';
import { fuzzyFilter } from './fuzzy';
import { setActiveAsset } from '../../../state/activeAsset';
import { setMapTrack } from '../../../state/mapTrack';

interface LoadingState {
  vessels: boolean;
  surveys: boolean;
  sonars: boolean;
  files: boolean;
}

export interface NceiSearchController {
  vessels: Vessel[];
  surveys: Survey[];
  sonars: SonarModel[];

  vessel: Vessel | null;
  survey: Survey | null;
  sonar: SonarModel | null;

  loading: LoadingState;
  error: string | null;

  fileQuery: string;
  dateFrom: string;
  dateTo: string;
  /** Min/max acquisition time of the loaded files, as datetime-local strings. */
  dateBounds: { min: string; max: string } | null;

  files: RawFile[];
  filteredFiles: RawFile[];
  channels: string[];

  /** Files an action will operate on: the checked subset, or the whole filtered set. */
  targetFiles: RawFile[];
  totalTargetBytes: number;

  selected: ReadonlySet<string>;
  /** The single file currently identified (drives the Metadata panel). */
  activeFileName: string | null;

  selectVessel: (vessel: Vessel | null) => void;
  selectSurvey: (survey: Survey | null) => void;
  selectSonar: (sonar: SonarModel | null) => void;
  setFileQuery: (query: string) => void;
  setDateFrom: (value: string) => void;
  setDateTo: (value: string) => void;
  toggleFile: (name: string) => void;
  toggleAll: () => void;
  clearSelection: () => void;
  identifyFile: (file: RawFile) => void;
  reload: () => void;

  context: CatalogContext;
}

/** datetime-local ("YYYY-MM-DDTHH:mm") interpreted as UTC -> epoch ms. */
function localToMs(value: string): number | null {
  if (!value) return null;
  const ms = Date.parse(`${value}:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Owns the NCEI browse state. Selecting a level loads the next and resets what's
 * below it; each async load carries a token so a superseded response is dropped.
 * A datetime range + fuzzy name filter scope the file list (surveys hold far too
 * many files to pick individually), and identifying a file publishes it to the
 * shared active-asset store for the Metadata panel.
 */
export function useNceiSearch(): NceiSearchController {
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [sonars, setSonars] = useState<SonarModel[]>([]);
  const [files, setFiles] = useState<RawFile[]>([]);
  const [channels, setChannels] = useState<string[]>([]);

  const [vessel, setVessel] = useState<Vessel | null>(null);
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [sonar, setSonar] = useState<SonarModel | null>(null);

  const [loading, setLoading] = useState<LoadingState>({
    vessels: false,
    surveys: false,
    sonars: false,
    files: false,
  });
  const [error, setError] = useState<string | null>(null);

  const [fileQuery, setFileQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeFileName, setActiveFileName] = useState<string | null>(null);

  const surveyToken = useRef(0);
  const sonarToken = useRef(0);
  const fileToken = useRef(0);

  const setLoadingFlag = useCallback((key: keyof LoadingState, value: boolean) => {
    setLoading((prev) => ({ ...prev, [key]: value }));
  }, []);

  const resetFileScope = useCallback(() => {
    setFileQuery('');
    setDateFrom('');
    setDateTo('');
    setSelected(new Set());
    setActiveFileName(null);
    setActiveAsset(null);
  }, []);

  const loadVessels = useCallback(async () => {
    setLoadingFlag('vessels', true);
    setError(null);
    try {
      setVessels(await nceiSource.listVessels());
    } catch (e) {
      setError(`Could not load vessels: ${(e as Error).message}`);
    } finally {
      setLoadingFlag('vessels', false);
    }
  }, [setLoadingFlag]);

  useEffect(() => {
    void loadVessels();
  }, [loadVessels]);

  const selectVessel = useCallback(
    (next: Vessel | null) => {
      setVessel(next);
      setSurvey(null);
      setSonar(null);
      setSurveys([]);
      setSonars([]);
      setFiles([]);
      setChannels([]);
      resetFileScope();

      const token = ++surveyToken.current;
      if (!next) return;
      setLoadingFlag('surveys', true);
      nceiSource
        .listSurveys(next.id)
        .then((result) => {
          if (token === surveyToken.current) setSurveys(result);
        })
        .catch((e: Error) => setError(`Could not load surveys: ${e.message}`))
        .finally(() => {
          if (token === surveyToken.current) setLoadingFlag('surveys', false);
        });
    },
    [setLoadingFlag, resetFileScope],
  );

  const selectSurvey = useCallback(
    (next: Survey | null) => {
      setSurvey(next);
      setSonar(null);
      setSonars([]);
      setFiles([]);
      setChannels([]);
      resetFileScope();

      const token = ++sonarToken.current;
      if (!next || !vessel) return;
      setLoadingFlag('sonars', true);
      nceiSource
        .listSonars(vessel.id, next.id)
        .then((result) => {
          if (token === sonarToken.current) setSonars(result);
        })
        .catch((e: Error) => setError(`Could not load sonar models: ${e.message}`))
        .finally(() => {
          if (token === sonarToken.current) setLoadingFlag('sonars', false);
        });
    },
    [vessel, setLoadingFlag, resetFileScope],
  );

  const selectSonar = useCallback(
    (next: SonarModel | null) => {
      setSonar(next);
      setFiles([]);
      setChannels([]);
      resetFileScope();

      const token = ++fileToken.current;
      if (!next || !vessel || !survey) return;
      setLoadingFlag('files', true);
      Promise.all([
        nceiSource.listRawFiles(vessel.id, survey.id, next.id),
        nceiSource.listChannels(next.id),
      ])
        .then(([rawFiles, chans]) => {
          if (token === fileToken.current) {
            setFiles(rawFiles);
            setChannels(chans);
          }
        })
        .catch((e: Error) => setError(`Could not load raw files: ${e.message}`))
        .finally(() => {
          if (token === fileToken.current) setLoadingFlag('files', false);
        });
    },
    [vessel, survey, setLoadingFlag, resetFileScope],
  );

  const dateBounds = useMemo(() => {
    if (files.length === 0) return null;
    let min = files[0].acquiredAt;
    let max = files[0].acquiredAt;
    for (const f of files) {
      if (f.acquiredAt < min) min = f.acquiredAt;
      if (f.acquiredAt > max) max = f.acquiredAt;
    }
    return { min: min.slice(0, 16), max: max.slice(0, 16) };
  }, [files]);

  const filteredFiles = useMemo(() => {
    const byName = fuzzyFilter(files, fileQuery, (f) => f.name);
    const fromMs = localToMs(dateFrom);
    const toMs = localToMs(dateTo);
    if (fromMs === null && toMs === null) return byName;
    return byName.filter((f) => {
      const ms = Date.parse(f.acquiredAt);
      if (fromMs !== null && ms < fromMs) return false;
      if (toMs !== null && ms > toMs) return false;
      return true;
    });
  }, [files, fileQuery, dateFrom, dateTo]);

  const toggleFile = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const allShown = filteredFiles.every((f) => prev.has(f.name));
      const next = new Set(prev);
      if (allShown) {
        for (const f of filteredFiles) next.delete(f.name);
      } else {
        for (const f of filteredFiles) next.add(f.name);
      }
      return next;
    });
  }, [filteredFiles]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const identifyFile = useCallback(
    (file: RawFile) => {
      setActiveFileName(file.name);
      if (!vessel || !survey || !sonar) return;
      setActiveAsset({
        fileName: file.name,
        vessel: vessel.name,
        survey: survey.name,
        sonar: sonar.name,
        sizeBytes: file.sizeBytes,
        acquiredAt: file.acquiredAt,
        channels,
        s3Path: `data/raw/${vessel.id}/${survey.id}/${sonar.id}/${file.name}`,
        source: 'NCEI',
      });
    },
    [vessel, survey, sonar, channels],
  );

  const reload = useCallback(() => {
    setVessel(null);
    setSurvey(null);
    setSonar(null);
    setSurveys([]);
    setSonars([]);
    setFiles([]);
    setChannels([]);
    resetFileScope();
    void loadVessels();
  }, [loadVessels, resetFileScope]);

  const selectedFiles = useMemo(
    () => files.filter((f) => selected.has(f.name)),
    [files, selected],
  );

  const targetFiles = useMemo(
    () => (selected.size > 0 ? selectedFiles : filteredFiles),
    [selected, selectedFiles, filteredFiles],
  );

  const totalTargetBytes = useMemo(
    () => targetFiles.reduce((sum, f) => sum + f.sizeBytes, 0),
    [targetFiles],
  );

  const context = useMemo<CatalogContext>(
    () => ({ vessel, survey, sonar }),
    [vessel, survey, sonar],
  );

  // Publish the positions of the files currently in view to the Map panel.
  useEffect(() => {
    const points = filteredFiles
      .filter((f) => typeof f.lat === 'number' && typeof f.lon === 'number')
      .slice(0, 500)
      .map((f) => ({ name: f.name, lat: f.lat as number, lon: f.lon as number }));
    const label =
      vessel && survey && sonar
        ? `${vessel.name} · ${survey.name} · ${sonar.name}`
        : null;
    setMapTrack({ points, activeName: activeFileName, label });
  }, [filteredFiles, activeFileName, vessel, survey, sonar]);

  return {
    vessels,
    surveys,
    sonars,
    vessel,
    survey,
    sonar,
    loading,
    error,
    fileQuery,
    dateFrom,
    dateTo,
    dateBounds,
    files,
    filteredFiles,
    channels,
    targetFiles,
    totalTargetBytes,
    selected,
    activeFileName,
    selectVessel,
    selectSurvey,
    selectSonar,
    setFileQuery,
    setDateFrom,
    setDateTo,
    toggleFile,
    toggleAll,
    clearSelection,
    identifyFile,
    reload,
    context,
  };
}
