#!/usr/bin/env python3
"""Write the Matplotlib colormaps and the colormap themes the UI uses.

    python scripts/build_colormap_themes.py            # rewrite both files
    python scripts/build_colormap_themes.py --check    # fail if they differ

Two generated files, so the browser draws exactly what aa-graph draws:

``frontend/src/theme/colormaps.generated.ts``
    Matplotlib's own 256-entry tables for the colormaps the Workbench offers,
    read from the installed matplotlib (``matplotlib.colormaps[name]``), so an
    echogram in the viewer and aa-graph's PNG of the same Sv use the same
    colours to the last bit.

``frontend/src/theme/colormapPalettes.generated.ts``
    One application theme per colormap in THEMES: the dark palette's layers,
    lightness for lightness, tinted with the hue of the colormap's dark end;
    the accent and the editor's colours sampled from the colormap itself,
    each nudged along the map until it reads on every surface (the contrast
    rules in frontend/tests/theme.test.ts); a band of the colormap under the
    menu bar. The semantic colours (error red, success green) stay what they
    mean everywhere.

Needs matplotlib (the aalibrary environment has it).
"""

from __future__ import annotations

import argparse
import colorsys
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
THEME_DIR = ROOT / "frontend" / "src" / "theme"
MAPS_FILE = THEME_DIR / "colormaps.generated.ts"
PALETTES_FILE = THEME_DIR / "colormapPalettes.generated.ts"

#: The colormaps offered for echograms (viewer, Prepare, pipelines), in order.
COLORMAPS = [
    ("viridis", "Viridis"),
    ("plasma", "Plasma"),
    ("inferno", "Inferno"),
    ("magma", "Magma"),
    ("cividis", "Cividis"),
    ("turbo", "Turbo"),
    ("jet", "Jet"),
    ("ocean", "Ocean"),
    ("cubehelix", "Cubehelix"),
    ("gray", "Gray"),
]

#: Colormaps that are also application themes: (name, where the accent sits).
THEMES = [
    ("viridis", 0.70),
    ("plasma", 0.72),
    ("inferno", 0.70),
    ("magma", 0.72),
    ("cividis", 0.88),
    ("turbo", 0.30),
    ("jet", 0.38),
]

#: The dark palette's layers (theme/tokens.ts), which the themes keep.
DARK = {
    "bg": {
        "base": "#16181d",
        "chrome": "#1c1f26",
        "editor": "#1e2127",
        "panel": "#22262e",
        "tabActive": "#2b303a",
        "tabActiveUnfocused": "#23272f",
        "tabInactive": "#1c1f26",
        "elevated": "#262b34",
        "hover": "#2e343e",
    },
    "border": {"subtle": "#2a2f38", "strong": "#14171c"},
    "text": {
        "primary": "#d5dae2",
        "secondary": "#9aa3b1",
        "muted": "#6b7280",
        "disabled": "#565d68",
    },
    "scrollbar": {"thumb": "#3a4049", "thumbHover": "#4a515c"},
    "terminalAnsi": {"white": "#c8ced8", "brightWhite": "#f0f3f7"},
    "status": {"success": "#3fb950", "warning": "#d9a441", "error": "#e5534b"},
    "comment": "#5f6a78",
}

RGB = tuple[float, float, float]


def hex_of(rgb: RGB) -> str:
    return "#" + "".join(f"{round(max(0, min(1, c)) * 255):02x}" for c in rgb)


def rgb_of(text: str) -> RGB:
    text = text.lstrip("#")
    return tuple(int(text[i : i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]


def luminance(rgb: RGB) -> float:
    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (lin(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a: RGB, b: RGB) -> float:
    la, lb = luminance(a), luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def tinted(reference: str, hue: float, saturation: float) -> str:
    """*reference* with the given hue and saturation, its lightness kept."""
    _h, lightness, _s = colorsys.rgb_to_hls(*rgb_of(reference))
    return hex_of(colorsys.hls_to_rgb(hue, lightness, saturation))


def table(name: str) -> list[RGB]:
    import matplotlib

    cmap = matplotlib.colormaps[name].resampled(256)
    return [tuple(cmap(i / 255)[:3]) for i in range(256)]  # type: ignore[misc]


def sample(lut: list[RGB], t: float) -> RGB:
    return lut[max(0, min(255, round(t * 255)))]


def readable(lut: list[RGB], t: float, surfaces: list[RGB], need: float) -> RGB:
    """The colour at t, or the nearest along the map that reads on every
    surface (brighter first: these are dark themes)."""
    steps = [i / 255 for i in range(256)]
    order = sorted(steps, key=lambda s: (abs(s - t), -s))
    for s in order:
        colour = sample(lut, s)
        if all(contrast(colour, bg) >= need for bg in surfaces):
            return colour
    raise SystemExit(f"no colour in the map reads at {need}:1")


def lighten(rgb: RGB, amount: float) -> RGB:
    return tuple(c + (1 - c) * amount for c in rgb)  # type: ignore[return-value]


def quiet(colour: str, surfaces: list[RGB], need: float = 3.0) -> str:
    """A comment colour: as quiet as the dark theme's, and no quieter."""
    rgb = rgb_of(colour)
    while not all(contrast(rgb, s) >= need for s in surfaces):
        rgb = lighten(rgb, 0.03)
    return hex_of(rgb)


def rgba(rgb: RGB, alpha: float) -> str:
    r, g, b = (round(c * 255) for c in rgb)
    return f"rgba({r}, {g}, {b}, {alpha:.2f})"


def palette(name: str, accent_at: float) -> dict:
    lut = table(name)
    # The hue of the map's dark end: the chrome is "this colormap at night".
    hue_rgb = tuple(sum(c[k] for c in lut[10:48]) / 38 for k in range(3))
    hue, _l, sat = colorsys.rgb_to_hls(*hue_rgb)
    bg_sat = min(0.42, max(0.18, sat * 0.55))
    bg = {k: tinted(v, hue, bg_sat) for k, v in DARK["bg"].items()}
    surfaces = [rgb_of(bg["panel"]), rgb_of(bg["editor"]), rgb_of(bg["base"])]
    accent = readable(lut, accent_at, surfaces, 4.6)
    hover = lighten(accent, 0.18)
    if not all(contrast(hover, s) >= 4.6 for s in surfaces):
        hover = accent
    text = {
        k: tinted(v, hue, 0.10 if k == "primary" else 0.12)
        for k, v in DARK["text"].items()
    }
    # Five editor colours from the map's readable half, spread out, distinct.
    syntax: dict[str, str] = {}
    picks = (
        [0.52, 0.64, 0.76, 0.88, 1.0]
        if accent_at >= 0.5
        else [0.2, 0.42, 0.62, 0.8, 0.95]
    )
    used: set[str] = set()
    for key, t in zip(
        ("keyword", "reference", "string", "entity", "number"), picks, strict=True
    ):
        colour = hex_of(readable(lut, t, surfaces[:2], 4.6))
        while colour in used:
            t = min(1.0, t + 0.03)
            colour = hex_of(readable(lut, t, surfaces[:2], 4.6))
        used.add(colour)
        syntax[key] = colour
    return {
        "bg": {**bg, "selected": rgba(accent, 0.16)},
        "border": {k: tinted(v, hue, bg_sat) for k, v in DARK["border"].items()},
        "text": text,
        "accent": {
            "main": hex_of(accent),
            "hover": hex_of(hover),
            "soft": rgba(accent, 0.16),
            "muted": rgba(accent, 0.45),
        },
        "syntax": {
            "comment": quiet(tinted(DARK["comment"], hue, 0.14), surfaces[:2]),
            **syntax,
        },
        "band": gradient(lut),
        "scrollbar": {k: tinted(v, hue, bg_sat) for k, v in DARK["scrollbar"].items()},
        "terminalAnsi": {
            k: tinted(v, hue, 0.12) for k, v in DARK["terminalAnsi"].items()
        },
        "status": {**DARK["status"], "info": hex_of(accent)},
    }


def gradient(lut: list[RGB], stops: int = 9) -> str:
    parts = [
        f"{hex_of(sample(lut, i / (stops - 1)))} {round(i / (stops - 1) * 100)}%"
        for i in range(stops)
    ]
    return f"linear-gradient(90deg, {', '.join(parts)})"


HEADER = (
    "/* Generated by scripts/build_colormap_themes.py from matplotlib {version}.\n"
    "   Do not edit by hand: run the script. */\n"
)


def maps_source() -> str:
    import matplotlib

    lines = [HEADER.format(version=matplotlib.__version__)]
    lines.append(
        "/** Matplotlib colormaps, 256 entries of rrggbb each, as matplotlib draws them. */"
    )
    lines.append("export const MATPLOTLIB_TABLES: Record<string, string> = {")
    for name, _label in COLORMAPS:
        packed = "".join(hex_of(c)[1:] for c in table(name))
        lines.append(f"  {name}:")
        for i in range(0, len(packed), 96):
            end = " +" if i + 96 < len(packed) else ","
            lines.append(f"    '{packed[i : i + 96]}'{end}")
    lines.append("};")
    lines.append("")
    lines.append(
        "/** The colormaps offered, in menu order: [matplotlib name, label]. */"
    )
    lines.append(
        "export const MATPLOTLIB_COLORMAPS: readonly (readonly [string, string])[] = ["
    )
    for name, label in COLORMAPS:
        lines.append(f"  ['{name}', '{label}'],")
    lines.append("];")
    return "\n".join(lines) + "\n"


def palettes_source() -> str:
    import matplotlib

    out = [HEADER.format(version=matplotlib.__version__)]
    out.append("import type { ColormapPaletteColors } from './tokens';\n")
    out.append(
        "/** The colours of each colormap theme (see build_colormap_themes.py). */"
    )
    out.append(
        "export const COLORMAP_PALETTE_COLORS: Record<string, ColormapPaletteColors> = {"
    )
    for name, accent_at in THEMES:
        p = palette(name, accent_at)
        out.append(f"  {name}: {{")
        for group in (
            "bg",
            "border",
            "text",
            "accent",
            "syntax",
            "scrollbar",
            "terminalAnsi",
            "status",
        ):
            out.append(f"    {group}: {{")
            for key, value in p[group].items():
                out.append(f"      {key}: '{value}',")
            out.append("    },")
        out.append(f"    band: '{p['band']}',")
        out.append("  },")
    out.append("};")
    return "\n".join(out) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--check", action="store_true", help="fail if the files differ")
    args = parser.parse_args()
    wanted = {MAPS_FILE: maps_source(), PALETTES_FILE: palettes_source()}
    stale = [p for p, text in wanted.items() if not p.exists() or p.read_text() != text]
    if args.check:
        for path in stale:
            print(f"out of date: {path.relative_to(ROOT)}", file=sys.stderr)
        return 1 if stale else 0
    for path in stale:
        path.write_text(wanted[path])
        print(f"wrote {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
