#!/usr/bin/env python
"""
SpaceTime Engine — Solution Library
====================================

Contains both standard GR metric solutions and complexified solutions
from the unified gravity-electromagnetism framework.

Standard solutions:
  - Minkowski, Schwarzschild, FLRW, weak-field, dark energy, hypersphere

Complexified solutions (NEW):
  - Schwarzschild (purely real limit: e_μν = 0)
  - Reissner-Nordström (complexified: Coulomb e_{00})
  - Temporal hypersphere with EM sector
  - Custom complexified from user-provided potentials
"""

from sympy import (
    Matrix, Symbol, Function, symbols, sin, cos, Rational,
    sqrt, pi, diag
)


class Solution:
    """Library of known metric tensor solutions."""

    # ==================================================================
    #  STANDARD SOLUTIONS (backward compatible)
    # ==================================================================

    def minkowski(self, version="euclidean"):
        """Flat Minkowski spacetime in Cartesian coordinates."""
        index_config = "dd"
        x0, x1, x2, x3 = symbols('t x y z')
        coordinate_set = [x0, x1, x2, x3]
        metric = Matrix([
            [1,  0,  0,  0],
            [0, -1,  0,  0],
            [0,  0, -1,  0],
            [0,  0,  0, -1]
        ])
        return [metric, coordinate_set, index_config, 0]

    def minkowski_spherical(self):
        """Flat Minkowski spacetime in spherical coordinates."""
        index_config = "dd"
        c = symbols('c')
        t, r, theta, phi = symbols('t r theta phi')
        coordinate_set = [t, r, theta, phi]
        metric = Matrix([
            [c**2,  0,           0,                    0],
            [0,    -1,           0,                    0],
            [0,     0, -r**2,                          0],
            [0,     0,           0, -r**2 * sin(theta)**2]
        ])
        return [metric, coordinate_set, index_config, 0]

    def schwarzschild(self):
        """Schwarzschild black hole: static, uncharged, non-rotating."""
        index_config = "dd"
        G, M, c = symbols('G M c')
        t, r, theta, phi = symbols('t r theta phi')
        coordinate_set = [t, r, theta, phi]
        f = 1 - 2 * G * M / (r * c**2)
        metric = Matrix([
            [f,       0,           0,                    0],
            [0, -1 / f,            0,                    0],
            [0,      0, -r**2,                           0],
            [0,      0,            0, -r**2 * sin(theta)**2]
        ])
        return [metric, coordinate_set, index_config, 0]

    def inverse_schwarzschild(self):
        """Inverse Schwarzschild: g_{00} = (1-r_s/r)^{-1}."""
        index_config = "dd"
        G, M, c = symbols('G M c')
        t, r, theta, phi = symbols('t r theta phi')
        coordinate_set = [t, r, theta, phi]
        f = 1 - 2 * G * M / (r * c**2)
        metric = Matrix([
            [1 / f,  0,           0,                    0],
            [0,     -f,           0,                    0],
            [0,      0, -r**2,                          0],
            [0,      0,           0, -r**2 * sin(theta)**2]
        ])
        return [metric, coordinate_set, index_config, 0]

    def reissner_nordstrom(self):
        """
        Reissner-Nordström: static, charged, non-rotating.

        f(r) = 1 − r_s/r + r_Q²/r²
        where r_s = 2GM/c², r_Q² = GkQ²/c⁴
        """
        index_config = "dd"
        G, M, c, k, Q = symbols('G M c k Q')
        t, r, theta, phi = symbols('t r theta phi')
        coordinate_set = [t, r, theta, phi]
        r_s = 2 * G * M / c**2
        r_Q2 = G * k * Q**2 / c**4
        f = 1 - r_s / r + r_Q2 / r**2
        metric = Matrix([
            [f,       0,           0,                    0],
            [0, -1 / f,            0,                    0],
            [0,      0, -r**2,                           0],
            [0,      0,            0, -r**2 * sin(theta)**2]
        ])
        return [metric, coordinate_set, index_config, 0]

    def weak_field_approximation(self):
        """Weak-field Newtonian limit of GR."""
        index_config = "dd"
        G, M, c = symbols('G M c')
        t, r, theta, phi = symbols('t r theta phi')
        coordinate_set = [t, r, theta, phi]
        Phi = -G * M / r
        metric = Matrix([
            [(1 + 2 * Phi / c**2) * c**2, 0,            0,                    0],
            [0, -1 / (1 + 2 * Phi / c**2), 0,            0],
            [0,  0,              -r**2,                   0],
            [0,  0,               0,    -r**2 * sin(theta)**2]
        ])
        return [metric, coordinate_set, index_config, 0]

    def friedmann_lemaitre_robertson_walker(self):
        """FLRW metric for an expanding universe."""
        index_config = "dd"
        c, K = symbols('c kappa')
        t, r, theta, phi = symbols('t r theta phi')
        a = Function('a')(t)
        coordinate_set = [t, r, theta, phi]
        metric = Matrix([
            [c**2,  0,                             0,                    0],
            [0,    -a**2 / (1 - K * r**2),         0,                    0],
            [0,     0,                   -a**2 * r**2,                   0],
            [0,     0,                              0, -a**2 * r**2 * sin(theta)**2]
        ])
        return [metric, coordinate_set, index_config, 0]

    def dark_energy(self):
        """Temporal hypersphere in 3D polar coordinates (dark energy form)."""
        index_config = "dd"
        c = symbols('c')
        t, r, theta, phi = symbols('t r theta phi')
        coordinate_set = [t, r, theta, phi]
        metric = Matrix([
            [c**2,  0,                                        0,                    0],
            [0,    -c**2 * t**2 / (c**2 * t**2 - r**2),      0,                    0],
            [0,     0,                              -r**2,                           0],
            [0,     0,                               0,      -r**2 * sin(theta)**2]
        ])
        return [metric, coordinate_set, index_config, 0]

    def hypersphere(self):
        """Temporal hypersphere in hyperspherical coordinates [t, ψ, θ, φ]."""
        index_config = "dd"
        c = symbols('c')
        t, psi, theta, phi = symbols('t psi theta phi')
        coordinate_set = [t, psi, theta, phi]
        metric = Matrix([
            [1,  0,                            0,                                     0],
            [0, -t**2,                         0,                                     0],
            [0,  0,    -t**2 * sin(psi)**2,                                           0],
            [0,  0,     0,                    -t**2 * sin(psi)**2 * sin(theta)**2]
        ])
        return [metric, coordinate_set, index_config, 0]

    def euclidian_4d(self):
        """Flat 4D Euclidean space."""
        index_config = "dd"
        x0, x1, x2, x3 = symbols('x y z w')
        coordinate_set = [x0, x1, x2, x3]
        metric = Matrix([
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 0],
            [0, 0, 0, 1]
        ])
        return [metric, coordinate_set, index_config, 0]

    # ==================================================================
    #  COMPLEXIFIED SOLUTIONS (NEW — from the unified framework)
    # ==================================================================

    def complexified_schwarzschild(self):
        """
        Schwarzschild as the purely real limit of g̃_μν = g_μν + iκ e_μν.

        Returns (real_solution, e_μν) where e_μν = 0.
        This verifies that the complexified framework leaves uncharged
        gravitational physics entirely unchanged.
        """
        real_sol = self.schwarzschild()
        n = len(real_sol[1])
        e_mn = Matrix([[0] * n for _ in range(n)])
        return real_sol, e_mn

    def complexified_reissner_nordstrom(self):
        """
        Reissner-Nordström from the complexified framework.

        The REAL metric is Schwarzschild (no external EM source).
        The IMAGINARY metric encodes the Coulomb field:
            e_{00} = −2kQ/(c²r)
            e_{0i} = 0,  e_{ij} = 0

        The charge correction r_Q²/r² is GENERATED by the −κ²CC
        self-energy mechanism, not inserted by hand.

        Returns
        -------
        real_solution : list
            Schwarzschild metric solution
        e_mn : Matrix
            Electromagnetic perturbation tensor
        """
        G, M, c, k, Q = symbols('G M c k Q')
        t, r, theta, phi = symbols('t r theta phi')

        # Real sector: start with Schwarzschild (the EM correction emerges
        # from the self-energy mechanism)
        real_sol = self.schwarzschild()

        # Imaginary sector: Coulomb potential
        # e_{00} = −2φ/c² = −2kQ/(c²r)
        e_mn = Matrix([
            [-2 * k * Q / (c**2 * r), 0, 0, 0],
            [0,                        0, 0, 0],
            [0,                        0, 0, 0],
            [0,                        0, 0, 0]
        ])
        return real_sol, e_mn

    def complexified_charged_weak_field(self):
        """
        Weak-field complexified metric for a static charged mass.

        g̃_μν = η_μν + h_μν + iκ ε_μν

        where:
            h_{00} = −2GM/(c²r),  h_{ij} = −2GM/(c²r) δ_{ij}
            ε_{00} = −2kQ/(c²r),  ε_{0i} = 0,  ε_{ij} = 0

        Returns
        -------
        real_solution : list
            Weak-field metric solution
        e_mn : Matrix
            Electromagnetic perturbation tensor
        """
        G, M, c, k, Q = symbols('G M c k Q')
        t, r, theta, phi = symbols('t r theta phi')

        real_sol = self.weak_field_approximation()

        e_mn = Matrix([
            [-2 * k * Q / (c**2 * r), 0, 0, 0],
            [0,                        0, 0, 0],
            [0,                        0, 0, 0],
            [0,                        0, 0, 0]
        ])
        return real_sol, e_mn

    def complexified_temporal_hypersphere(self):
        """
        Temporal hypersphere with electromagnetic metric.

        The conformal electromagnetic ansatz:
            e_μν = f(t) · g_μν
            f(t) = (2/κc) ln(t/t₀)

        This is the cosmological solution that requires nonzero
        current flux Σ^{ij} ≠ 0 (the rank-2 J_μν prediction).

        Returns
        -------
        real_solution : list
            Temporal hypersphere metric
        e_mn : Matrix
            Conformal electromagnetic perturbation
        """
        c = symbols('c')
        G, k = symbols('G k', positive=True)
        t0 = symbols('t_0', positive=True)
        t, psi, theta, phi = symbols('t psi theta phi')

        real_sol = self.hypersphere()
        kappa = sqrt(G / k)

        # Conformal function f(t) = (2/κc) ln(t/t₀)
        from sympy import log
        f_t = 2 / (kappa * c) * log(t / t0)

        # e_μν = f(t) · g_μν (conformal ansatz)
        g = real_sol[0]
        e_mn = f_t * g

        return real_sol, e_mn

    def complexified_coulomb_static(self):
        """
        A static point charge in flat spacetime (weak-field limit).

        Real metric: Minkowski (spherical coordinates)
        EM perturbation: Coulomb potential only

        This is the simplest test case for extracting Maxwell's equations
        from the imaginary sector.

        Returns
        -------
        real_solution : list
            Minkowski metric in spherical coordinates
        e_mn : Matrix
            Coulomb field perturbation
        """
        c, k, Q = symbols('c k Q')
        t, r, theta, phi = symbols('t r theta phi')

        real_sol = self.minkowski_spherical()

        e_mn = Matrix([
            [-2 * k * Q / (c**2 * r), 0, 0, 0],
            [0,                        0, 0, 0],
            [0,                        0, 0, 0],
            [0,                        0, 0, 0]
        ])
        return real_sol, e_mn

    def complexified_current_loop(self):
        """
        Static charge with steady azimuthal current (magnetic field).

        Real metric: Minkowski (spherical)
        EM perturbation: Coulomb e_{00} + vector potential e_{03}

        This tests the vector potential / gravitomagnetic analogy.

        Returns
        -------
        real_solution : list
            Minkowski metric in spherical coordinates
        e_mn : Matrix
            EM perturbation with both scalar and vector potential
        """
        c, k, Q = symbols('c k Q')
        A_phi = symbols('A_phi')  # azimuthal vector potential
        t, r, theta, phi = symbols('t r theta phi')

        real_sol = self.minkowski_spherical()

        e_mn = Matrix([
            [-2 * k * Q / (c**2 * r), 0, 0, -A_phi / c**2],
            [0,                        0, 0,             0],
            [0,                        0, 0,             0],
            [-A_phi / c**2,            0, 0,             0]
        ])
        return real_sol, e_mn

    # ==================================================================
    #  LEGACY SOLUTIONS (preserved for backward compatibility)
    # ==================================================================

    def hypersphere_I(self):
        """Hypersphere variant I (proper-time parameterized)."""
        index_config = "dd"
        c = symbols('c')
        tau = symbols('tau')
        x0 = Function('t')(tau)
        x1 = Function('psi')(tau)
        x2 = Function('theta')(tau)
        x3 = Function('phi')(tau)
        coordinate_set = [x0, x1, x2, x3]
        metric = Matrix([
            [sin(x1)**2 * sin(x2)**2 * sin(x3)**2,
             x0 * sin(x2)**2 * sin(x3)**2 * sin(x1) * cos(x1),
             x0 * sin(x1)**2 * sin(x3)**2 * sin(x2) * cos(x2),
             x0 * sin(x1)**2 * sin(x2)**2 * sin(x3) * cos(x3)],
            [x0 * sin(x2)**2 * sin(x3)**2 * sin(x1) * cos(x1),
             x0 - x0**2 + x0**2 * sin(x2)**2 * sin(x3)**2 - x0**2 * sin(x1)**2 * sin(x2)**2 * sin(x3)**2,
             x0**2 * sin(x3)**2 * sin(x1) * sin(x2) * cos(x1) * cos(x2),
             x0**2 * sin(x2)**2 * sin(x1) * sin(x3) * cos(x1) * cos(x3)],
            [x0 * sin(x1)**2 * sin(x3)**2 * sin(x2) * cos(x2),
             x0**2 * sin(x3)**2 * sin(x1) * sin(x2) * cos(x1) * cos(x2),
             x0 * sin(x2)**2 - x0**2 * sin(x1)**2 + x0**2 * sin(x1)**2 * sin(x3)**2 - x0**2 * sin(x1)**2 * sin(x2)**2 * sin(x3)**2,
             x0**2 * sin(x1)**2 * sin(x2) * sin(x3) * cos(x2) * cos(x3)],
            [x0 * sin(x1)**2 * sin(x2)**2 * sin(x3) * cos(x3),
             x0**2 * sin(x2)**2 * sin(x1) * sin(x3) * cos(x1) * cos(x3),
             x0**2 * sin(x1)**2 * sin(x2) * sin(x3) * cos(x2) * cos(x3),
             -x0**2 * sin(x1)**2 * sin(x2)**2 * sin(x3)**2 + x0 * sin(x1)**2 * sin(x2)**2]
        ])
        return [metric, coordinate_set, index_config, 0]

    def gravitomagnetic_metric_tensor(self):
        """Linearized gravitomagnetic metric tensor."""
        x0, x1, x2, x3 = symbols('x0 x1 x2 x3')
        c = symbols('c')
        Ph = symbols('Phi')(x0)
        ax = symbols('ax')(x1)
        ay = symbols('ay')(x2)
        az = symbols('az')(x3)

        eta = Matrix([
            [1,  0,  0,  0],
            [0, -1,  0,  0],
            [0,  0, -1,  0],
            [0,  0,  0, -1]
        ])
        h = Matrix([
            [2 * Ph / c**2, -ax / c**2, -ay / c**2, -az / c**2],
            [-ax / c**2,     Ph / c**2,           0,          0],
            [-ay / c**2,              0,  Ph / c**2,          0],
            [-az / c**2,              0,           0, Ph / c**2]
        ])
        return eta + h
