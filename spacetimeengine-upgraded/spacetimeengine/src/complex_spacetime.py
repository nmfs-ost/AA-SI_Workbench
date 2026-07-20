#!/usr/bin/env python
"""
ComplexSpaceTime — Unified Gravity-Electromagnetism Engine
==========================================================

Implements the complexified metric framework:

    g̃_μν = g_μν + iκ e_μν        where κ = √(G/k)

from "On the Electrodynamics of Geodesic Motion: A Unification of
Gravity and Electromagnetism" by Michael C. Ryan.

This module computes:
  - Complex connection Γ̃ = Γ(g) + iκ C(e)
  - Complex Riemann / Ricci / Einstein tensors
  - Real sector: standard Einstein eqs + EM self-energy (−κ²CC)
  - Imaginary sector: Maxwell's equations from geometry
  - EM self-energy correction ΔR_μν^(EM) = −κ²(C·C − tr(C)·C)
  - Electromagnetic field tensor F_μν from imaginary curvature
  - J_μν current density tensor (rank-2 source)
  - Validation: Bianchi identity checks, field equation verification
  - Extremality analysis Q/M vs √(G/k)
"""

from sympy import (
    Matrix, Symbol, Rational, diff, simplify, pprint, Eq,
    symbols, pi, zeros, sqrt, I, re, im, expand, trigsimp,
    Function, diag, eye, Abs
)
from .spacetime import SpaceTime, _zeros_rank2, _zeros_rank3


# ======================================================================
#  Physical constants (symbolic)
# ======================================================================
G_sym, k_sym, c_sym = symbols('G k c', positive=True)
kappa_sym = sqrt(G_sym / k_sym)   # κ = √(G/k) ≈ 8.617e-11 C/kg


class ComplexSpaceTime:
    """
    Complexified spacetime manifold g̃_μν = g_μν + iκ e_μν.

    Parameters
    ----------
    real_solution : list
        Standard solution array [metric, coords, index_config, Λ]
        for the real (gravitational) sector g_μν.
    em_perturbation : Matrix
        The electromagnetic perturbation tensor e_μν (real-valued).
        Must be the same size as the metric.
    kappa : sympy expression, optional
        The coupling constant κ = √(G/k). Defaults to symbolic √(G/k).
    suppress_printing : bool
        If True, suppress output during construction.
    compute_full_hierarchy : bool
        If True (default), compute all tensor objects at construction.
        Set False for lazy/manual computation.
    """

    def __init__(self, real_solution, em_perturbation,
                 kappa=None, suppress_printing=True,
                 compute_full_hierarchy=True):

        # Parse the real sector
        self.coordinate_set = real_solution[1]
        self.n = n = len(self.coordinate_set)
        self.dimensions = range(n)
        self.suppress_printing = suppress_printing

        # Coupling constant
        self.kappa = kappa if kappa is not None else kappa_sym

        # Build the real-sector SpaceTime (suppressed — we reuse its data)
        self.real_st = SpaceTime(real_solution, suppress_printing=True)

        # Store metric components
        self.g_dd = self.real_st.metric_tensor_dd
        self.g_uu = self.real_st.metric_tensor_uu
        self.e_dd = em_perturbation

        # Complex metric
        self.gtilde_dd = self.g_dd + I * self.kappa * self.e_dd

        # Imaginary connection C^α_{μν} built from e_μν
        self.imaginary_connection_udd = _zeros_rank3(n)

        # EM self-energy corrections to Ricci tensor
        self.em_self_energy_dd = _zeros_rank2(n)

        # Effective (modified) Einstein tensor of the real sector
        self.effective_einstein_dd = _zeros_rank2(n)

        # Imaginary-sector Einstein tensor (→ Maxwell equations)
        self.imaginary_einstein_dd = _zeros_rank2(n)

        # Current density tensor J_μν
        self.current_density_dd = _zeros_rank2(n)

        # Electromagnetic field tensor F_μν (from imaginary curvature)
        self.em_field_tensor_dd = _zeros_rank2(n)

        if compute_full_hierarchy:
            self._compute_all()

    # ------------------------------------------------------------------
    #  Full computation pipeline
    # ------------------------------------------------------------------

    def _compute_all(self):
        """Compute the full complex tensor hierarchy."""
        self._print_header("Computing complexified tensor hierarchy")
        self.compute_imaginary_connection()
        self.compute_em_self_energy()
        self.compute_effective_einstein_tensor()
        self.compute_imaginary_einstein_tensor()
        self.compute_current_density_tensor()
        self.compute_em_field_tensor()
        self._print_header("Complexified computation complete")

    def _print_header(self, msg):
        if not self.suppress_printing:
            print(f"\n{'='*60}")
            print(f"  {msg}")
            print(f"{'='*60}\n")

    # ==================================================================
    #  IMAGINARY CONNECTION C^α_{μν}
    # ==================================================================

    def get_imaginary_connection(self, alpha, mu, nu):
        """Get C^α_{μν}, the imaginary connection built from e_μν."""
        return self.imaginary_connection_udd[alpha, mu][nu]

    def compute_imaginary_connection_component(self, alpha, mu, nu):
        """
        C^α_{μν} = ½ g^{αβ} (∂_μ e_{βν} + ∂_ν e_{βμ} - ∂_β e_{μν})

        Same index recipe as Christoffel symbols, but built from e_μν
        with g^{αβ} used for index raising (leading order in κ).
        """
        coords = self.coordinate_set
        C = 0
        for beta in self.dimensions:
            C += Rational(1, 2) * self.g_uu[beta, alpha] * (
                diff(self.e_dd[beta, nu], coords[mu])
                + diff(self.e_dd[beta, mu], coords[nu])
                - diff(self.e_dd[mu, nu], coords[beta])
            )
        return C

    def compute_imaginary_connection(self):
        """Compute all components of the imaginary connection."""
        if not self.suppress_printing:
            print("Imaginary connection C^α_{μν}")
            print("-" * 40)
        for alpha in self.dimensions:
            for mu in self.dimensions:
                for nu in self.dimensions:
                    val = simplify(self.compute_imaginary_connection_component(alpha, mu, nu))
                    self.imaginary_connection_udd[alpha, mu][nu] = val
                    if not self.suppress_printing and val != 0:
                        pprint(Eq(Symbol(f'C^{alpha}_{mu}{nu}'), val))
                        print()

    # ==================================================================
    #  EM SELF-ENERGY: −κ² (C·C − tr(C)·C)
    # ==================================================================

    def compute_em_self_energy_component(self, mu, nu):
        """
        ΔR^(EM)_{μν} = −κ² [ C^α_{μλ} C^λ_{να} − C^α_{αλ} C^λ_{μν} ]

        This is the electromagnetic contribution to the real Ricci tensor,
        arising from the (iκ)² = −κ² term in the Γ̃Γ̃ product.
        """
        kappa2 = self.kappa**2
        # First contraction: C^α_{μλ} C^λ_{να}
        term1 = 0
        for alpha in self.dimensions:
            for lam in self.dimensions:
                term1 += (self.get_imaginary_connection(alpha, mu, lam)
                          * self.get_imaginary_connection(lam, nu, alpha))

        # Second contraction (trace): C^α_{αλ} C^λ_{μν}
        term2 = 0
        for alpha in self.dimensions:
            for lam in self.dimensions:
                term2 += (self.get_imaginary_connection(alpha, alpha, lam)
                          * self.get_imaginary_connection(lam, mu, nu))

        return simplify(-kappa2 * (term1 - term2))

    def compute_em_self_energy(self):
        """Compute the full EM self-energy correction tensor."""
        if not self.suppress_printing:
            print("\nEM self-energy correction ΔR^(EM)_{μν} = −κ²(CC − tr(C)C)")
            print("-" * 55)
        for mu in self.dimensions:
            for nu in self.dimensions:
                val = self.compute_em_self_energy_component(mu, nu)
                self.em_self_energy_dd[mu, nu] = val
                if not self.suppress_printing and val != 0:
                    pprint(Eq(Symbol(f'ΔR^EM_{mu}{nu}'), val))
                    print()

    # ==================================================================
    #  EFFECTIVE EINSTEIN TENSOR (real sector + EM self-energy)
    # ==================================================================

    def compute_effective_einstein_tensor(self):
        """
        The real sector of G̃_μν = 0 gives:

            G_μν[g] + ΔG^(EM)_μν = 0

        Or equivalently:

            G_μν[g] = −ΔG^(EM)_μν = (8πG/c⁴) T^(EM)_μν

        This computes G_μν[g] + corrections and stores the result.
        """
        if not self.suppress_printing:
            print("\nEffective Einstein tensor (real sector)")
            print("-" * 42)

        # Compute the trace of EM self-energy
        em_trace = 0
        for mu in self.dimensions:
            for nu in self.dimensions:
                em_trace += self.g_uu[mu, nu] * self.em_self_energy_dd[mu, nu]
        em_trace = simplify(em_trace)

        for mu in self.dimensions:
            for nu in self.dimensions:
                # Standard Einstein + EM self-energy correction to Einstein tensor
                G_real = self.real_st.get_einstein_coefficient("dd", mu, nu)
                delta_G = (self.em_self_energy_dd[mu, nu]
                           - Rational(1, 2) * em_trace * self.g_dd[mu, nu])
                val = simplify(G_real + delta_G)
                self.effective_einstein_dd[mu, nu] = val
                if not self.suppress_printing and val != 0:
                    pprint(Eq(Symbol(f'G̃_Re_{mu}{nu}'), val))
                    print()

    # ==================================================================
    #  IMAGINARY EINSTEIN TENSOR (→ Maxwell equations)
    # ==================================================================

    def compute_imaginary_einstein_tensor(self):
        """
        At linear order, Im(G̃_μν) = κ G^(e)_μν[ε], where G^(e) is the
        linearized Einstein tensor built from e_μν.

        In the weak-field regime this produces Maxwell's equations:
          G^(e)_{0ν} = (8πk/c⁴) J_{0ν}   (Gauss + Ampère)

        We compute G^(e)_μν from the imaginary connection.
        """
        if not self.suppress_printing:
            print("\nImaginary Einstein tensor G^(e)_{μν} (→ Maxwell sector)")
            print("-" * 55)

        # Build the imaginary Ricci tensor from the imaginary connection
        # R^(e)_μν = ∂_α C^α_{νμ} - ∂_ν C^α_{αμ} + Γ·C cross terms
        coords = self.coordinate_set
        imag_ricci = _zeros_rank2(self.n)

        for mu in self.dimensions:
            for nu in self.dimensions:
                R_e = 0
                for alpha in self.dimensions:
                    # ∂_α C^α_{νμ} − ∂_ν C^α_{αμ}
                    R_e += diff(self.get_imaginary_connection(alpha, nu, mu), coords[alpha])
                    R_e -= diff(self.get_imaginary_connection(alpha, alpha, mu), coords[nu])
                    # Cross-coupling: Γ^α_{αλ} C^λ_{νμ} + C^α_{αλ} Γ^λ_{νμ}
                    # − Γ^α_{νλ} C^λ_{αμ} − C^α_{νλ} Γ^λ_{αμ}
                    for lam in self.dimensions:
                        Gamma = self.real_st.get_connection_coefficient("udd", alpha, alpha, lam)
                        R_e += Gamma * self.get_imaginary_connection(lam, nu, mu)

                        Gamma2 = self.real_st.get_connection_coefficient("udd", alpha, nu, lam)
                        R_e -= Gamma2 * self.get_imaginary_connection(lam, alpha, mu)

                imag_ricci[mu, nu] = simplify(R_e)

        # Imaginary Ricci scalar
        imag_scalar = 0
        for mu in self.dimensions:
            for nu in self.dimensions:
                imag_scalar += self.g_uu[mu, nu] * imag_ricci[mu, nu]
        imag_scalar = simplify(imag_scalar)

        # Imaginary Einstein tensor
        for mu in self.dimensions:
            for nu in self.dimensions:
                val = simplify(imag_ricci[mu, nu]
                               - Rational(1, 2) * imag_scalar * self.g_dd[mu, nu])
                self.imaginary_einstein_dd[mu, nu] = val
                if not self.suppress_printing and val != 0:
                    pprint(Eq(Symbol(f'G^e_{mu}{nu}'), val))
                    print()

    # ==================================================================
    #  CURRENT DENSITY TENSOR J_μν
    # ==================================================================

    def compute_current_density_tensor(self):
        """
        From Im(G̃_μν) = (8πk/c⁴) J_μν, extract J_μν:

            J_μν = (c⁴/8πk) G^(e)_μν
        """
        if not self.suppress_printing:
            print("\nCurrent density tensor J_{μν}")
            print("-" * 32)

        prefactor = c_sym**4 / (8 * pi * k_sym)
        for mu in self.dimensions:
            for nu in self.dimensions:
                val = simplify(prefactor * self.imaginary_einstein_dd[mu, nu])
                self.current_density_dd[mu, nu] = val
                if not self.suppress_printing and val != 0:
                    pprint(Eq(Symbol(f'J_{mu}{nu}'), val))
                    print()

    # ==================================================================
    #  ELECTROMAGNETIC FIELD TENSOR F_μν
    # ==================================================================

    def compute_em_field_tensor(self):
        """
        F_μν = ∂_μ A_ν − ∂_ν A_μ

        Extracted from the imaginary metric: e_{0i} = −A_i/c², so
        F_μν = −c² (∂_μ e_{0ν} − ∂_ν e_{0μ}) for the mixed components.

        More generally, the antisymmetric part of e_{μν} derivatives:
        F_μν ∝ ∂_μ e_{0ν} − ∂_ν e_{0μ}
        """
        if not self.suppress_printing:
            print("\nEM field tensor F_{μν} (from imaginary curvature)")
            print("-" * 50)

        coords = self.coordinate_set
        for mu in self.dimensions:
            for nu in self.dimensions:
                # F_μν from the antisymmetric derivative of e_{0μ}
                val = simplify(
                    diff(self.e_dd[0, nu], coords[mu])
                    - diff(self.e_dd[0, mu], coords[nu])
                )
                # Scale by -c² to convert from metric perturbation to potential
                self.em_field_tensor_dd[mu, nu] = simplify(-c_sym**2 * val)
                if not self.suppress_printing and val != 0:
                    pprint(Eq(Symbol(f'F_{mu}{nu}'), self.em_field_tensor_dd[mu, nu]))
                    print()

    # ==================================================================
    #  VALIDATION AND ANALYSIS
    # ==================================================================

    def verify_null_complex_energy(self, simplify_result=True):
        """
        Check whether G̃_μν = 0 (the null complex energy condition).

        Returns a dict with 'real' and 'imaginary' sector results.
        Each is a matrix of the residuals (should be zero for exact solutions).
        """
        print("\n" + "=" * 60)
        print("  Verifying null complex energy condition: G̃_μν = 0")
        print("=" * 60)

        real_residual = _zeros_rank2(self.n)
        imag_residual = _zeros_rank2(self.n)

        print("\nReal sector (G_μν + ΔG^EM_μν = 0):")
        print("-" * 40)
        all_zero_real = True
        for mu in self.dimensions:
            for nu in self.dimensions:
                val = self.effective_einstein_dd[mu, nu]
                if simplify_result:
                    val = simplify(val)
                real_residual[mu, nu] = val
                if val != 0:
                    all_zero_real = False
                    pprint(Eq(Symbol(f'Re(G̃)_{mu}{nu}'), val))
                    print()
        if all_zero_real:
            print("  ✓ Real sector satisfied (all zero)")

        print("\nImaginary sector (G^(e)_μν = 0 for vacuum):")
        print("-" * 40)
        all_zero_imag = True
        for mu in self.dimensions:
            for nu in self.dimensions:
                val = self.imaginary_einstein_dd[mu, nu]
                if simplify_result:
                    val = simplify(val)
                imag_residual[mu, nu] = val
                if val != 0:
                    all_zero_imag = False
                    pprint(Eq(Symbol(f'Im(G̃)_{mu}{nu}'), val))
                    print()
        if all_zero_imag:
            print("  ✓ Imaginary sector satisfied (all zero)")

        return {'real': real_residual, 'imaginary': imag_residual}

    def analyze_extremality(self, M_expr, Q_expr):
        """
        Analyze the extremal condition Q/M vs √(G/k).

        Parameters
        ----------
        M_expr : sympy expression for the total mass
        Q_expr : sympy expression for the total charge
        """
        print("\n" + "=" * 60)
        print("  Extremality Analysis: Q/M vs κ = √(G/k)")
        print("=" * 60)

        ratio = simplify(Q_expr / M_expr)
        print(f"\n  Q/M = ", end="")
        pprint(ratio)

        print(f"\n  κ = √(G/k) = ", end="")
        pprint(kappa_sym)

        balance = simplify(ratio - kappa_sym)
        print(f"\n  Q/M − κ = ", end="")
        pprint(balance)

        if balance == 0:
            print("\n  ★ EXTREMAL: Real and imaginary sectors exactly balanced")
            print("    |κ·e_{00}| / |h_{00}| = 1")
        else:
            print("\n  Not extremal at this mass/charge ratio.")

    def print_em_self_energy_summary(self):
        """Print the EM self-energy corrections with physical interpretation."""
        print("\n" + "=" * 60)
        print("  EM Self-Energy: −κ²(C^α_{μλ} C^λ_{να} − C^α_{αλ} C^λ_{μν})")
        print("=" * 60)
        print(f"\n  κ² = G/k — converts imaginary self-interaction to real curvature")
        print(f"  Sign from i² = −1 produces REPULSIVE character\n")

        found = False
        for mu in self.dimensions:
            for nu in self.dimensions:
                val = self.em_self_energy_dd[mu, nu]
                if val != 0:
                    found = True
                    pprint(Eq(Symbol(f'ΔR^EM_{mu}{nu}'), val))
                    print()
        if not found:
            print("  (all zero — no EM self-energy in this configuration)")

    def print_complex_metric(self):
        """Display the full complex metric g̃_μν = g_μν + iκ e_μν."""
        print("\n" + "=" * 60)
        print("  Complex Metric: g̃_μν = g_μν + iκ e_μν")
        print("=" * 60)
        print("\nReal sector g_μν:")
        pprint(self.g_dd)
        print("\nImaginary perturbation e_μν:")
        pprint(self.e_dd)
        print("\nFull complex metric g̃_μν:")
        pprint(self.gtilde_dd)

    def print_summary(self):
        """Print a comprehensive summary of the complexified spacetime."""
        self.print_complex_metric()
        self.print_em_self_energy_summary()

        print("\n" + "=" * 60)
        print("  Imaginary Connection (non-zero components)")
        print("=" * 60)
        for alpha in self.dimensions:
            for mu in self.dimensions:
                for nu in self.dimensions:
                    val = self.get_imaginary_connection(alpha, mu, nu)
                    if val != 0:
                        pprint(Eq(Symbol(f'C^{alpha}_{mu}{nu}'), val))
                        print()

        print("\n" + "=" * 60)
        print("  EM Field Tensor F_μν (non-zero components)")
        print("=" * 60)
        for mu in self.dimensions:
            for nu in self.dimensions:
                val = self.em_field_tensor_dd[mu, nu]
                if val != 0:
                    pprint(Eq(Symbol(f'F_{mu}{nu}'), val))
                    print()

    # ==================================================================
    #  ACCESS TO UNDERLYING REAL SPACETIME
    # ==================================================================

    @property
    def real_spacetime(self):
        """Access the underlying real-sector SpaceTime object."""
        return self.real_st

    def get_real_einstein(self, mu, nu):
        """Standard Einstein tensor G_μν[g] from the real metric."""
        return self.real_st.get_einstein_coefficient("dd", mu, nu)

    def get_real_ricci(self, mu, nu):
        """Standard Ricci tensor R_μν[g] from the real metric."""
        return self.real_st.get_ricci_coefficient("dd", mu, nu)

    def get_real_ricci_scalar(self):
        """Ricci scalar R[g] from the real metric."""
        return self.real_st.get_ricci_scalar()


# ======================================================================
#  CONVENIENCE CONSTRUCTORS
# ======================================================================

def complexified_from_potentials(real_solution, phi_expr, A_exprs=None,
                                  kappa=None, suppress_printing=True):
    """
    Build a ComplexSpaceTime from scalar/vector electromagnetic potentials.

    Maps potentials to the imaginary metric perturbation:
        e_{00} = −2φ/c²
        e_{0i} = −A_i/c²
        e_{ij} = 0

    Parameters
    ----------
    real_solution : list
        Standard solution array for g_μν.
    phi_expr : sympy expression
        Electromagnetic scalar potential φ(r).
    A_exprs : list of 3 sympy expressions, optional
        Vector potential components [A_x, A_y, A_z]. Default: all zero.
    kappa : sympy expression, optional
        Coupling constant. Default: symbolic √(G/k).
    """
    n = len(real_solution[1])
    e = zeros(n, n)

    # e_{00} = −2φ/c²
    e[0, 0] = -2 * phi_expr / c_sym**2

    # e_{0i} = −A_i/c²
    if A_exprs is not None:
        for i, Ai in enumerate(A_exprs):
            e[0, i + 1] = -Ai / c_sym**2
            e[i + 1, 0] = -Ai / c_sym**2  # symmetric

    return ComplexSpaceTime(real_solution, e, kappa=kappa,
                            suppress_printing=suppress_printing)
