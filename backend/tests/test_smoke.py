"""Smoke tests: verify the package imports and exposes a version string."""

import aa_si_workbench


def test_package_has_version() -> None:
    assert isinstance(aa_si_workbench.__version__, str)
    assert aa_si_workbench.__version__
