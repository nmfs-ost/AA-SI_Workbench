/**
 * Domain types for the NCEI catalogue, as Prepare EchoData uses it.
 *
 * These mirror the drill-down that `aa-find` performs over NCEI's archive:
 *   vessel -> survey -> sonar model (echosounder) -> .raw file
 * (S3 layout: data/raw/{vessel}/{survey}/{sonar}/{file}).
 */

/** A survey vessel (NCEI ship folder), e.g. "Henry B. Bigelow". */
export interface Vessel {
  /** S3 folder id, e.g. "Henry_B._Bigelow". */
  id: string;
  /** Display name, e.g. "Henry B. Bigelow". */
  name: string;
}

/** A survey / cruise under a vessel, e.g. "HB1906". */
export interface Survey {
  id: string;
  name: string;
  vesselId: string;
  year: number;
}

/** An echosounder / sonar model, e.g. "EK60". */
export interface SonarModel {
  id: string;
  name: string;
}

/** A single raw echosounder file, e.g. "D20190415-T120000.raw". */
export interface RawFile {
  /** File name (also the S3 object leaf). */
  name: string;
  sizeBytes: number;
  /** Acquisition time parsed from the D{YYYYMMDD}-T{HHMMSS} name convention. */
  acquiredAt: string; // ISO 8601
  /** GPS position for the file (optional; absent until the backend provides it). */
  lat?: number;
  lon?: number;
}
