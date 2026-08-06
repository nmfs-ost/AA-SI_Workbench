#!/usr/bin/env python3
"""Regenerate the NOAA mark assets in `frontend/public/`.

Run this only if the upstream brand asset changes. The output is committed, so
a normal build and a normal checkout never need it — this exists so that the
three files in `frontend/public/` are reproducible rather than mysterious.

    python scripts/build_noaa_mark.py path/to/noaa_digital_logo-2022_icon.png

Source
------
    nmfs-opensci/NOAA-NMFS-Brand-Resources
    logo-icons/noaa_digital_logo-2022_icon.png     (1501x1501, RGBA)

NOAA Fisheries' own brand-resources repository — the 2022 NOAA digital logo in
its icon form. No circumscribed "NATIONAL OCEANIC AND ATMOSPHERIC ADMINISTRATION
/ U.S. DEPARTMENT OF COMMERCE" ring, no NOAA wordmark, transparent background,
and exactly two brand colours (#0085CA, #003087) plus white for the gull.

**Nothing here redraws the mark.** It is trimmed, squared and resampled. That
distinction is the whole point: an approximation of a federal agency emblem
looks like the real mark while not being it, which is worse than having no mark
at all. If this script ever grows a drawing primitive, something has gone wrong.

Why the ring text is not simply shrunk
--------------------------------------
It is illegible below roughly 64px. A 19px emblem whose outer third is grey
mush reads as a smudge rather than as NOAA, which is why NOAA publishes this
icon variant in the first place — the decision to drop the ring is theirs, not
ours.

Why premultiplied resampling
----------------------------
The master's fully transparent pixels are (0, 0, 0, 0) — transparent *black*.
A straight RGBA resize averages those zeros into the colour channel of every
partially covered edge pixel, so the mark picks up a dark fringe that is
invisible at 180px and obvious at 16. Measured on this asset, the minimum edge
luminance is 24 without premultiplication and 62 with it.

Requires Pillow and NumPy; neither is a runtime dependency of the Workbench.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

#: Written next to the built app. `noaa-mark.png` is both the apple-touch icon
#: and the source for the 18px mark in the menu bar — 180px is enough for a 6x
#: display and still only 13KB.
OUTPUT = Path(__file__).resolve().parent.parent / "frontend" / "public"


def normalise(path: Path) -> Image.Image:
    """Trim the master to its own ink and centre it on a square canvas.

    The asset as published sits in a canvas with its own margins, which is why
    the mark looked a different size in each place it was used. One canvas rule
    here means every size below frames the mark identically.
    """
    image = Image.open(path).convert("RGBA")
    image = image.crop(image.getchannel("A").getbbox())
    width, height = image.size
    side = max(width, height)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(image, ((side - width) // 2, (side - height) // 2))
    return canvas


def resample(image: Image.Image, size: int) -> Image.Image:
    """LANCZOS on premultiplied alpha. See the module docstring."""
    source = np.asarray(image).astype(np.float64) / 255.0
    rgb, alpha = source[..., :3], source[..., 3:4]

    premultiplied = Image.fromarray(
        (np.concatenate([rgb * alpha, alpha], axis=2) * 255).round().astype(np.uint8),
        "RGBA",
    )
    small = np.asarray(
        premultiplied.resize((size, size), Image.LANCZOS)
    ).astype(np.float64) / 255.0

    out_alpha = small[..., 3:4]
    # Undo the premultiplication. Where alpha is zero the colour is arbitrary
    # and unused, so it is set to zero rather than divided by it.
    out_rgb = np.where(out_alpha > 0, small[..., :3] / np.maximum(out_alpha, 1e-8), 0.0)
    return Image.fromarray(
        (np.concatenate([out_rgb, out_alpha], axis=2).clip(0, 1) * 255)
        .round()
        .astype(np.uint8),
        "RGBA",
    )


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2

    master = normalise(Path(argv[1]))
    print(f"master normalised to {master.size[0]}x{master.size[1]}")

    resample(master, 180).save(OUTPUT / "noaa-mark.png", optimize=True)
    resample(master, 32).save(OUTPUT / "noaa-mark-32.png", optimize=True)
    # One multi-resolution .ico rather than three files: the browser picks the
    # size it wants instead of resampling a single bitmap badly for the tab,
    # the bookmark bar and the desktop shortcut in turn.
    resample(master, 48).save(
        OUTPUT / "favicon.ico",
        sizes=[(16, 16), (32, 32), (48, 48)],
        append_images=[resample(master, 16), resample(master, 32)],
    )

    for name in ("noaa-mark.png", "noaa-mark-32.png", "favicon.ico"):
        print(f"  wrote {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
