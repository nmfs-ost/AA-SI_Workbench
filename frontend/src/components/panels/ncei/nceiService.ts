/**
 * NCEI catalog data source.
 *
 * `NceiCatalogSource` is a thin interface whose methods map one-to-one onto the
 * Python helpers `aa-find` uses today:
 *
 *   listVessels()                      <- get_all_ship_names_in_ncei
 *   listSurveys(vessel)                <- get_all_survey_names_from_a_ship
 *   listSonars(vessel, survey)         <- get_all_echosounders_in_a_survey
 *   listRawFiles(vessel, survey, sonar)<- get_all_raw_file_names_from_survey
 *
 * The panel talks only to this interface. Today it is backed by `mockNceiSource`
 * (deterministic sample data) so the UI is fully interactive without a server.
 * When the backend API lands, implement `NceiCatalogSource` against it (e.g. an
 * `apiNceiSource` that calls the aalibrary-backed endpoints) and change the one
 * `nceiSource` binding at the bottom of this file — nothing else needs to move.
 */

import type { RawFile, SonarModel, Survey, Vessel } from './nceiTypes';
import { apiNceiSource } from './apiNceiSource';

export interface NceiCatalogSource {
  listVessels(): Promise<Vessel[]>;
  listSurveys(vesselId: string): Promise<Survey[]>;
  listSonars(vesselId: string, surveyId: string): Promise<SonarModel[]>;
  listRawFiles(
    vesselId: string,
    surveyId: string,
    sonarId: string,
  ): Promise<RawFile[]>;
  /** Channel names for a sonar model (for the aa-combine --channels subset). */
  listChannels(sonarId: string): Promise<string[]>;
}

/* ------------------------------------------------------------------ */
/* Addressing                                                          */
/* ------------------------------------------------------------------ */

/**
 * The public NCEI water-column bucket. Mirrors `BUCKET` in
 * backend/src/aa_si_workbench/api/ncei.py — it is the same archive, and the
 * two must not drift.
 */
export const NCEI_BUCKET = 'noaa-wcsd-pds';

/** Key of a raw file within the bucket: data/raw/{ship}/{survey}/{sonar}/{file}. */
export function nceiKey(
  vesselId: string,
  surveyId: string,
  sonarId: string,
  fileName: string,
): string {
  return `data/raw/${vesselId}/${surveyId}/${sonarId}/${fileName}`;
}

/**
 * The absolute address of a raw file in NCEI. This is what "copy path" means
 * for a remote object — an `s3://` URI is what boto3, the AWS CLI and
 * `aa-fetch` all accept, and what a colleague can act on.
 */
export function nceiS3Uri(
  vesselId: string,
  surveyId: string,
  sonarId: string,
  fileName: string,
): string {
  return `s3://${NCEI_BUCKET}/${nceiKey(vesselId, surveyId, sonarId, fileName)}`;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/** Human-readable byte sizes, matching aa-find's _format_bytes output. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let n = bytes;
  for (const u of units) {
    if (n < 1024 || u === units[units.length - 1]) {
      return u === 'B'
        ? `${Math.round(n)} ${u}`
        : `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${u}`;
    }
    n /= 1024;
  }
  return `${n} EB`;
}

/* ------------------------------------------------------------------ */
/* Deterministic sample-data generator                                */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SONAR_CHANNELS: Record<string, string[]> = {
  EK60: ['GPT 18 kHz', 'GPT 38 kHz', 'GPT 70 kHz', 'GPT 120 kHz', 'GPT 200 kHz'],
  EK80: ['WBT 18 kHz', 'WBT 38 kHz', 'WBT 70 kHz', 'WBT 120 kHz', 'WBT 200 kHz'],
  ME70: [], // multibeam — channel subsetting not offered
};

interface Catalog {
  vessels: Vessel[];
  surveys: Map<string, Survey[]>; // vesselId -> surveys
  sonars: Map<string, SonarModel[]>; // `${vesselId}/${surveyId}` -> sonars
  files: Map<string, RawFile[]>; // `${vesselId}/${surveyId}/${sonarId}` -> files
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function buildCatalog(): Catalog {
  const rand = mulberry32(0x0ac0571c); // fixed seed -> stable data across renders

  const vesselSeeds: Array<{
    id: string;
    name: string;
    abbr: string;
    home: [number, number]; // approx [lat, lon] of the vessel's usual survey grounds
  }> = [
    { id: 'Henry_B._Bigelow', name: 'Henry B. Bigelow', abbr: 'HB', home: [42.5, -68.5] },
    { id: 'Bell_M._Shimada', name: 'Bell M. Shimada', abbr: 'SH', home: [44.5, -124.6] },
    { id: 'Oscar_Dyson', name: 'Oscar Dyson', abbr: 'DY', home: [56.5, -166.0] },
    { id: 'Reuben_Lasker', name: 'Reuben Lasker', abbr: 'RL', home: [34.5, -121.2] },
    { id: 'Gordon_Gunter', name: 'Gordon Gunter', abbr: 'GU', home: [28.2, -90.0] },
    { id: 'Pisces', name: 'Pisces', abbr: 'PC', home: [31.2, -79.4] },
  ];

  const sonarPool = ['EK60', 'EK80', 'ME70'];

  const vessels: Vessel[] = [];
  const surveys = new Map<string, Survey[]>();
  const sonars = new Map<string, SonarModel[]>();
  const files = new Map<string, RawFile[]>();

  for (const vs of vesselSeeds) {
    vessels.push({ id: vs.id, name: vs.name });

    const surveyCount = 2 + Math.floor(rand() * 3); // 2..4
    const vesselSurveys: Survey[] = [];
    const usedYears = new Set<number>();

    for (let i = 0; i < surveyCount; i++) {
      let year = 2015 + Math.floor(rand() * 7); // 2015..2021
      while (usedYears.has(year)) year = 2015 + Math.floor(rand() * 7);
      usedYears.add(year);
      const cruise = 1 + Math.floor(rand() * 9);
      const surveyId = `${vs.abbr}${pad(year % 100, 2)}${pad(cruise, 2)}`;
      const survey: Survey = { id: surveyId, name: surveyId, vesselId: vs.id, year };
      vesselSurveys.push(survey);

      // 1..2 sonar models for this survey
      const sonarCount = 1 + Math.floor(rand() * 2);
      const shuffled = [...sonarPool].sort(() => rand() - 0.5);
      const chosen = shuffled.slice(0, sonarCount);
      const surveySonars: SonarModel[] = chosen.map((m) => ({ id: m, name: m }));
      sonars.set(`${vs.id}/${surveyId}`, surveySonars);

      // Mock cruise-track origin for this survey + a running position that
      // wanders as files are acquired (deterministic random walk).
      const surveyLat = vs.home[0] + (rand() - 0.5) * 1.5;
      const surveyLon = vs.home[1] + (rand() - 0.5) * 1.5;
      let trackLat = surveyLat;
      let trackLon = surveyLon;

      for (const sonar of surveySonars) {
        const fileCount = 6 + Math.floor(rand() * 13); // 6..18
        const month = 1 + Math.floor(rand() * 9);
        const day = 1 + Math.floor(rand() * 26);
        const rawFiles: RawFile[] = [];
        let hour = 6;
        let minute = 0;
        for (let f = 0; f < fileCount; f++) {
          minute += 20 + Math.floor(rand() * 25);
          hour += Math.floor(minute / 60);
          minute %= 60;
          const h = hour % 24;
          const dayOffset = Math.floor(hour / 24);
          const d = day + dayOffset;
          const stamp = `D${year}${pad(month, 2)}${pad(d, 2)}-T${pad(h, 2)}${pad(minute, 2)}${pad(0, 2)}`;
          const sizeBytes = Math.round((80 + rand() * 240) * 1024 * 1024);
          const acquiredAt = new Date(
            Date.UTC(year, month - 1, d, h, minute, 0),
          ).toISOString();
          trackLat += (rand() - 0.5) * 0.05;
          trackLon += (rand() - 0.5) * 0.07;
          rawFiles.push({
            name: `${stamp}.raw`,
            sizeBytes,
            acquiredAt,
            lat: Number(trackLat.toFixed(5)),
            lon: Number(trackLon.toFixed(5)),
          });
        }
        files.set(`${vs.id}/${surveyId}/${sonar.id}`, rawFiles);
      }
    }

    vesselSurveys.sort((a, b) => a.name.localeCompare(b.name));
    surveys.set(vs.id, vesselSurveys);
  }

  vessels.sort((a, b) => a.name.localeCompare(b.name));
  return { vessels, surveys, sonars, files };
}

const CATALOG = buildCatalog();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/* Mock implementation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Deterministic in-memory implementation. Small delays are added so the panel's
 * loading states behave like real network calls (mirroring aa-find's spinners).
 */
export const mockNceiSource: NceiCatalogSource = {
  async listVessels() {
    await delay(180);
    return CATALOG.vessels;
  },
  async listSurveys(vesselId) {
    await delay(160);
    return CATALOG.surveys.get(vesselId) ?? [];
  },
  async listSonars(vesselId, surveyId) {
    await delay(140);
    return CATALOG.sonars.get(`${vesselId}/${surveyId}`) ?? [];
  },
  async listRawFiles(vesselId, surveyId, sonarId) {
    await delay(220);
    const list = CATALOG.files.get(`${vesselId}/${surveyId}/${sonarId}`) ?? [];
    // Sorted by name == chronological for D{YYYYMMDD}-T{HHMMSS} (what aa-combine wants).
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  },
  async listChannels(sonarId) {
    await delay(40);
    return SONAR_CHANNELS[sonarId] ?? [];
  },
};

/**
 * The active data source, selected at build/runtime:
 *   VITE_AASI_USE_API=true  → the real backend API (apiNceiSource)
 *   otherwise               → deterministic mock data (mockNceiSource)
 * Every consumer imports `nceiSource`, never a concrete implementation.
 */
export const nceiSource: NceiCatalogSource =
  import.meta.env.VITE_AASI_USE_API === 'true' ? apiNceiSource : mockNceiSource;
