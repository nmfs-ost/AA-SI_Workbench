#!/usr/bin/env python
"""
SpaceTime Engine
================

A symbolic differential geometry engine for general relativity
and the complexified unification of gravity and electromagnetism.

Classes
-------
SpaceTime
    Full tensor pipeline for a (pseudo-)Riemannian manifold.
ComplexSpaceTime
    Complexified metric framework: g̃_μν = g_μν + iκ e_μν
Solution
    Library of known metric tensor solutions (standard + complexified).

Quick start
-----------
    from spacetimeengine import SpaceTime, ComplexSpaceTime, Solution

    # Standard GR:
    st = SpaceTime(Solution().schwarzschild(), suppress_printing=True)

    # Complexified (unified gravity + EM):
    sol = Solution()
    real_sol, e_mn = sol.complexified_reissner_nordstrom()
    cst = ComplexSpaceTime(real_sol, e_mn)
"""

from .src.spacetime import SpaceTime
from .src.complex_spacetime import ComplexSpaceTime, complexified_from_potentials
from .src.solutions import Solution

__all__ = [
    'SpaceTime',
    'ComplexSpaceTime',
    'complexified_from_potentials',
    'Solution',
]
