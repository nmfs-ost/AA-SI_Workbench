"""The colormap tables and themes the UI draws with are matplotlib's own.

frontend/src/theme/*.generated.ts are written by
scripts/build_colormap_themes.py from the installed matplotlib; this fails
when they were edited by hand or matplotlib's tables changed.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "build_colormap_themes.py"


def test_the_generated_colormaps_match_matplotlib():
    pytest.importorskip("matplotlib")
    done = subprocess.run(
        [sys.executable, str(SCRIPT), "--check"], capture_output=True, text=True
    )
    assert done.returncode == 0, done.stderr
