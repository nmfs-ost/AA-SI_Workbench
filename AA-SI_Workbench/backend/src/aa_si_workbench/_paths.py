"""Filesystem path resolution shared by the API (static mount) and the CLI.

Works in two layouts:
  * a source checkout — .../<repo>/{frontend,backend}/... (dev + workstation)
  * an installed wheel that bundles the built UI at aa_si_workbench/_frontend/
"""

from __future__ import annotations

import os
from pathlib import Path

_PKG_DIR = Path(__file__).resolve().parent  # .../aa_si_workbench


def repo_root() -> Path | None:
    """The repo root (a directory containing both frontend/ and backend/)."""
    for parent in _PKG_DIR.parents:
        if (parent / "frontend").is_dir() and (parent / "backend").is_dir():
            return parent
    return None


def frontend_dir() -> Path | None:
    """The frontend/ source directory, if this is a source checkout."""
    root = repo_root()
    if root and (root / "frontend").is_dir():
        return root / "frontend"
    return None


def frontend_dist_dir() -> Path | None:
    """The built frontend to serve, or None if it hasn't been built yet.

    Resolution order: explicit override → UI bundled in the wheel → source build.
    """
    override = os.getenv("AASI_FRONTEND_DIST")
    if override:
        p = Path(override)
        return p if (p / "index.html").is_file() else None

    bundled = _PKG_DIR / "_frontend"
    if (bundled / "index.html").is_file():
        return bundled

    fe = frontend_dir()
    if fe and (fe / "dist" / "index.html").is_file():
        return fe / "dist"

    return None
