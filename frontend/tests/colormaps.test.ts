import { describe, expect, it } from 'vitest';

import { COLORMAPS, cssGradient, lut, paint, resolveColormap } from '../src/components/panels/echogram/colormaps';
import { MATPLOTLIB_COLORMAPS } from '../src/theme/colormaps.generated';
import { colormapOf, paletteList } from '../src/theme/tokens';

/**
 * Echograms are drawn in Matplotlib's own tables, so the viewer and aa-graph
 * --cmap agree to the last bit, and each colormap theme draws them in its own
 * colormap. (scripts/build_colormap_themes.py writes the tables; the backend's
 * test_colormap_themes.py checks they match the installed matplotlib.)
 */

const rgb = (name: string, i: number) => Array.from(lut(name).slice(i * 4, i * 4 + 3));

describe('the Matplotlib tables', () => {
  it('are matplotlib’s colours, end to end', () => {
    expect(rgb('viridis', 0)).toEqual([68, 1, 84]);
    expect(rgb('viridis', 255)).toEqual([253, 231, 37]);
    expect(rgb('magma', 100)).toEqual([137, 40, 129]);
    expect(rgb('turbo', 0)).toEqual([48, 18, 59]);
  });

  it('index values as matplotlib does: floor(x * 256), clipped', () => {
    const out = new Uint8ClampedArray(3 * 4);
    paint(Float32Array.from([-80, -79.99, -30]), out, { colormap: 'viridis', vmin: -80, vmax: -30, belowMin: 'lowest' });
    expect(Array.from(out.slice(0, 3))).toEqual(rgb('viridis', 0));
    expect(Array.from(out.slice(4, 7))).toEqual(rgb('viridis', 0)); // 0.0002 * 256 < 1
    expect(Array.from(out.slice(8, 11))).toEqual(rgb('viridis', 255)); // x == 1 → the last
  });

  it('are all offered in the viewer, after EK500', () => {
    expect(COLORMAPS.map((c) => c.id)).toEqual(['ek500', ...MATPLOTLIB_COLORMAPS.map(([id]) => id)]);
    expect(cssGradient('plasma')).toMatch(/^linear-gradient\(to right, rgb\(/);
  });
});

describe('the theme’s colormap', () => {
  it('is the colormap theme’s own, and EK500 under the others', () => {
    expect(resolveColormap('theme', colormapOf('magma'))).toBe('magma');
    expect(resolveColormap('theme', colormapOf('dark'))).toBe('ek500');
    expect(resolveColormap('jet', colormapOf('magma'))).toBe('jet');
  });

  it('reads names stored by earlier versions, and nothing unknown', () => {
    expect(resolveColormap('grey', '')).toBe('gray');
    expect(resolveColormap('rainbow-unicorn', '')).toBe('ek500');
  });

  it('names a table for every colormap theme', () => {
    const themed = paletteList.filter((p) => p.colormap);
    expect(themed.map((p) => p.id)).toEqual(['viridis', 'plasma', 'inferno', 'magma', 'cividis', 'turbo', 'jet']);
    for (const palette of themed) expect(lut(palette.colormap!)).toHaveLength(1024);
  });
});
