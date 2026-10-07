import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { decodeLand, levelFor } from '../src/components/panels/echogram/basemap';
import {
  fitView,
  formatDistance,
  formatLat,
  formatLon,
  formatSpeed,
  fromPx,
  gridLabel,
  gridStep,
  haversine,
  toPx,
  trackContext,
  trackStats,
  unwrap,
} from '../src/components/panels/echogram/geo';

/**
 * The track map's geography: the land it draws (Natural Earth, read from
 * public/basemap), and what it says about the track.
 */

const land = (level: string) =>
  decodeLand(JSON.parse(readFileSync(new URL(`../public/basemap/land-${level}.json`, import.meta.url), 'utf8')));

describe('the basemap', () => {
  it('decodes Natural Earth’s land into closed rings of lon/lat', () => {
    const rings = land('110m');
    expect(rings.length).toBeGreaterThan(100);
    for (const r of rings) {
      expect(r.pts.length % 2).toBe(0);
      expect(r.lat1).toBeLessThanOrEqual(90.0001);
      // Continuous across the antimeridian (Fiji runs 177°..181°), so no ring
      // closes with a line across the world; only a polar ring spans it all.
      if (r.lon1 - r.lon0 < 350) {
        for (let i = 2; i < r.pts.length; i += 2) expect(Math.abs(r.pts[i] - r.pts[i - 2])).toBeLessThan(180);
      }
    }
    expect(rings.some((r) => r.lon1 > 180 || r.lon0 < -180)).toBe(true);
    // Georges Bank is sea and Cape Cod is land: the HB1603 survey area.
    const inside = (lon: number, lat: number) =>
      rings.some((r) => {
        if (lon < r.lon0 || lon > r.lon1 || lat < r.lat0 || lat > r.lat1) return false;
        let hit = false;
        for (let i = 0, j = r.pts.length - 2; i < r.pts.length; j = i, i += 2) {
          const [xi, yi, xj, yj] = [r.pts[i], r.pts[i + 1], r.pts[j], r.pts[j + 1]];
          if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
        }
        return hit;
      });
    const fine = land('50m');
    const insideFine = (lon: number, lat: number) =>
      fine.some((r) => {
        if (lon < r.lon0 || lon > r.lon1 || lat < r.lat0 || lat > r.lat1) return false;
        let hit = false;
        for (let i = 0, j = r.pts.length - 2; i < r.pts.length; j = i, i += 2) {
          const [xi, yi, xj, yj] = [r.pts[i], r.pts[i + 1], r.pts[j], r.pts[j + 1]];
          if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
        }
        return hit;
      });
    expect(insideFine(-67.5, 41.5)).toBe(false); // Georges Bank
    expect(insideFine(-100, 40)).toBe(true); // Kansas
    expect(inside(-100, 40)).toBe(true);
  });

  it('draws finer outlines as the map zooms in', () => {
    expect(levelFor(120)).toBe('110m');
    expect(levelFor(10)).toBe('50m');
    expect(levelFor(0.5)).toBe('10m');
  });
});

describe('the track', () => {
  it('measures distance and speed, and skips GPS jumps', () => {
    // Due north at 10 knots for an hour, one fix a minute, and one bad fix.
    const n = 61;
    const lat = new Float64Array(n);
    const lon = new Float64Array(n).fill(-70);
    const t = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      lat[i] = 41 + (i * 10) / 60 / 60;
      t[i] = Date.UTC(2016, 6, 3, 6, i);
    }
    lat[30] = 45; // a glitch: 400 km in a minute
    const s = trackStats(lat, lon, t)!;
    expect(s.durationMs).toBe(3600_000);
    expect(s.metres / 1852).toBeGreaterThan(9.4);
    expect(s.metres / 1852).toBeLessThan(10.2);
    expect(formatSpeed(s.speed)).toMatch(/^(9\.\d|10\.\d) kn$/);
    expect(s.along[0]).toBe(0);
  });

  it('crosses the date line as a short step', () => {
    const lon = unwrap(Float64Array.from([179.9, -179.9, -179.8]));
    expect(Array.from(lon).map((v) => Math.round(v * 10) / 10)).toEqual([179.9, 180.1, 180.2]);
    expect(haversine(0, 179.9, 0, -179.9)).toBeLessThan(23_000);
  });

  it('writes positions as a chart does', () => {
    expect(formatLat(41.5)).toBe('41°30.000′N');
    expect(formatLon(-70.25)).toBe('070°15.000′W');
    expect(formatLon(190)).toBe('170°00.000′W');
    expect(formatDistance(1852 * 2.5)).toBe('2.50 nmi (4.63 km)');
  });

  it('knows the ship and survey from where Prepare EchoData keeps products', () => {
    expect(
      trackContext('gs://b/derived_products/jane.doe/Henry_B._Bigelow/HB1603/HB1603_EK60/HB1603_EK60_1a2b.nc'),
    ).toEqual({ vessel: 'Henry B. Bigelow', survey: 'HB1603', product: 'HB1603_EK60_1a2b.nc' });
    expect(trackContext('gs://b/somewhere/x.nc', 'X')).toEqual({ vessel: '', survey: '', product: 'X' });
  });
});

describe('the map view', () => {
  it('fits the track and maps back and forth', () => {
    const v = fitView(41, 41.2, -70.3, -70, 300, 200);
    const [x, y] = toPx(v, 300, 200, -70.15, 41.1);
    expect(x).toBeCloseTo(150, 5);
    expect(y).toBeCloseTo(100, 5);
    const [lon, lat] = fromPx(v, 300, 200, 10, 20);
    const [bx, by] = toPx(v, 300, 200, lon, lat);
    expect(bx).toBeCloseTo(10, 6);
    expect(by).toBeCloseTo(20, 6);
  });

  it('labels its grid as finely as its step', () => {
    expect(gridStep(10)).toBe(10); // 5° would be 50 px apart: too close
    expect(gridStep(600)).toBe(10 / 60); // 10′ is 100 px at 600 px per degree
    expect(gridLabel(41.5, 0.5, 'lat')).toBe('41°30′N');
    expect(gridLabel(-70, 1, 'lon')).toBe('70°W');
    expect(gridLabel(0, 5, 'lat')).toBe('0°');
  });
});
