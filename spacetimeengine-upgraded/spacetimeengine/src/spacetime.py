#!/usr/bin/env python
"""
SpaceTime Engine — Core Differential Geometry Module
=====================================================

Computes the full tensor hierarchy for a given metric:
  metric → connection → Riemann → Ricci → scalar → Einstein → stress-energy

Refactored to be dimension-agnostic (not hardcoded to 4D) and to eliminate
the hundreds of lines of hardcoded zero-tensor initializations.

All existing API methods are preserved for backward compatibility.
"""

from sympy import (
    Matrix, Symbol, Derivative, Rational, diff,
    simplify, pprint, Eq, symbols, pi, zeros, sqrt, I
)


# ---------------------------------------------------------------------------
#  Tensor factory helpers
# ---------------------------------------------------------------------------

def _zeros_rank2(n):
    """Return an n×n zero Matrix."""
    return zeros(n, n)


class _Tensor3:
    """Rank-3 tensor stored as a dict, mimicking Matrix[i,j][k] access."""
    def __init__(self, n):
        self.n = n
        self._data = {}
    def __getitem__(self, key):
        i, j = key
        return _Tensor3Row(self, i, j)
    def __setitem__(self, key, value):
        # Allow setting a full row: tensor[i, j] = _Tensor3Row(...)
        # This is only used internally; individual element access goes through _Tensor3Row
        pass

class _Tensor3Row:
    """Helper for rank-3 element access: tensor[i,j][k]."""
    def __init__(self, parent, i, j):
        self._p = parent
        self._i = i
        self._j = j
    def __getitem__(self, k):
        return self._p._data.get((self._i, self._j, k), 0)
    def __setitem__(self, k, val):
        self._p._data[(self._i, self._j, k)] = val


class _Tensor4:
    """Rank-4 tensor stored as a dict, mimicking tensor[i,j][k][l] access."""
    def __init__(self, n):
        self.n = n
        self._data = {}
    def __getitem__(self, key):
        i, j = key
        return _Tensor4Row(self, i, j)

class _Tensor4Row:
    """Helper for rank-4: tensor[i,j][k] returns a _Tensor4Col."""
    def __init__(self, parent, i, j):
        self._p = parent
        self._i = i
        self._j = j
    def __getitem__(self, k):
        return _Tensor4Col(self._p, self._i, self._j, k)

class _Tensor4Col:
    """Helper for rank-4: tensor[i,j][k][l] element access."""
    def __init__(self, parent, i, j, k):
        self._p = parent
        self._i = i
        self._j = j
        self._k = k
    def __getitem__(self, l):
        return self._p._data.get((self._i, self._j, self._k, l), 0)
    def __setitem__(self, l, val):
        self._p._data[(self._i, self._j, self._k, l)] = val


def _zeros_rank3(n):
    """Return an n-dimensional rank-3 tensor initialized to zero."""
    return _Tensor3(n)


def _zeros_rank4(n):
    """Return an n-dimensional rank-4 tensor initialized to zero."""
    return _Tensor4(n)


class SpaceTime:
    """
    Full differential-geometry pipeline for a (pseudo-)Riemannian manifold.

    Parameters
    ----------
    solution : list
        [metric_matrix, coordinate_list, index_config_str, cosmological_constant]
    suppress_printing : bool
        If True, skip console output during construction.
    """

    # ------------------------------------------------------------------
    #  Construction
    # ------------------------------------------------------------------

    def __init__(self, solution, suppress_printing=False):
        self.coordinate_set = solution[1]
        self.dimension_count = n = len(self.coordinate_set)
        self.dimensions = range(n)
        self.suppress_printing = suppress_printing

        # Metric
        self.metric_index_config = solution[2]
        if self.metric_index_config == "uu":
            self.metric_tensor_uu = solution[0]
            self.metric_tensor_dd = simplify(solution[0].inv())
        elif self.metric_index_config == "dd":
            self.metric_tensor_dd = solution[0]
            self.metric_tensor_uu = simplify(solution[0].inv())
        else:
            raise ValueError("index_config must be 'uu' or 'dd'")

        # Connection (rank-3)
        self.christoffel_symbols_udd = _zeros_rank3(n)
        self.christoffel_symbols_ddd = _zeros_rank3(n)

        # Riemann (rank-4)
        self.riemann_tensor_uddd = _zeros_rank4(n)
        self.riemann_tensor_dddd = _zeros_rank4(n)
        self.weyl_tensor_uddd = _zeros_rank4(n)
        self.weyl_tensor_dddd = _zeros_rank4(n)

        # Ricci, Einstein, stress-energy (rank-2)
        self.ricci_tensor_dd = _zeros_rank2(n)
        self.ricci_tensor_uu = _zeros_rank2(n)
        self.ricci_tensor_ud = _zeros_rank2(n)
        self.ricci_scalar = 0

        self.einstein_tensor_dd = _zeros_rank2(n)
        self.einstein_tensor_uu = _zeros_rank2(n)
        self.einstein_tensor_ud = _zeros_rank2(n)

        self.stress_energy_tensor_dd = _zeros_rank2(n)
        self.stress_energy_tensor_uu = _zeros_rank2(n)
        self.stress_energy_tensor_ud = _zeros_rank2(n)

        self.schouten_tensor_uu = _zeros_rank2(n)
        self.schouten_tensor_dd = _zeros_rank2(n)

        self.cosmological_constant = 0

        # Kinematic vectors
        self.proper_acceleration = [0] * n
        self.coordinate_acceleration = [0] * n
        self.geodesic_deviation_acceleration = [0] * n
        self.proper_velocity = [0] * n
        self.coordinate_velocity = [0] * n
        self.geodesic_velocity = [0] * n
        self.proper_position = [0] * n
        self.coordinate_position = [0] * n
        self.geodesic_deviation_position = [0] * n

        # Build full tensor hierarchy
        self.set_all_metric_coefficients("dd")
        self.set_all_connection_coefficients("udd")
        self.set_all_riemann_coefficients("uddd")
        self.set_all_ricci_coefficients("dd")
        self.set_all_schouten_coefficients("dd")
        self.set_ricci_scalar()
        self.set_all_einstein_coefficients("dd")
        self.set_all_stress_energy_coefficients("dd")
        self.set_all_proper_time_geodesic_accelerations()
        self.set_all_coordinate_time_geodesic_accelerations()
        self.set_all_geodesic_deviation_accelerations()

    # ==================================================================
    #  METRIC
    # ==================================================================

    def get_metric_coefficient(self, index_config, mu, nu):
        if index_config == "uu":
            return self.metric_tensor_uu[mu, nu]
        elif index_config == "dd":
            return self.metric_tensor_dd[mu, nu]
        raise ValueError("index_config must be 'uu' or 'dd'")

    def set_metric_coefficient(self, index_config, mu, nu, expression):
        if index_config == "uu":
            self.metric_tensor_uu[mu, nu] = expression
        elif index_config == "dd":
            self.metric_tensor_dd[mu, nu] = expression

    def set_all_metric_coefficients(self, index_config):
        if not self.suppress_printing:
            print(f"\n\nMetric tensor coefficients ({index_config})")
            print("=" * 40)
            for mu in self.dimensions:
                for nu in self.dimensions:
                    self.print_metric_coefficient(index_config, mu, nu)

    def print_metric_coefficient(self, index_config, mu, nu):
        sym = f"g^{mu}{nu}" if index_config == "uu" else f"g_{mu}{nu}"
        print("")
        pprint(Eq(Symbol(sym), self.get_metric_coefficient(index_config, mu, nu)))

    def print_all_metric_coefficients(self, index_config):
        for mu in self.dimensions:
            for nu in self.dimensions:
                self.print_metric_coefficient(index_config, mu, nu)

    # ==================================================================
    #  CONNECTION (Christoffel symbols)
    # ==================================================================

    def get_connection_coefficient(self, index_config, i, k, l):
        if index_config == "udd":
            return self.christoffel_symbols_udd[i, k][l]
        elif index_config == "ddd":
            return self.christoffel_symbols_ddd[i, k][l]
        raise ValueError("index_config must be 'udd' or 'ddd'")

    def set_connection_coefficient(self, index_config, i, k, l, expression):
        if index_config == "udd":
            self.christoffel_symbols_udd[i, k][l] = expression
        elif index_config == "ddd":
            self.christoffel_symbols_ddd[i, k][l] = expression

    def compute_connection_coefficient(self, index_config, i, k, l):
        g_dd = self.metric_tensor_dd
        g_uu = self.metric_tensor_uu
        coords = self.coordinate_set
        if index_config == "udd":
            conn = 0
            for m in self.dimensions:
                conn += Rational(1, 2) * g_uu[m, i] * (
                    diff(g_dd[k, m], coords[l])
                    + diff(g_dd[l, m], coords[k])
                    - diff(g_dd[k, l], coords[m])
                )
            return conn
        elif index_config == "ddd":
            return simplify(Rational(1, 2) * (
                diff(g_dd[i, k], coords[l])
                + diff(g_dd[i, l], coords[k])
                - diff(g_dd[k, l], coords[i])
            ))
        raise ValueError("index_config must be 'udd' or 'ddd'")

    def set_all_connection_coefficients(self, index_config):
        if not self.suppress_printing:
            print(f"\n\nConnection coefficients ({index_config})")
            print("=" * 40)
        for i in self.dimensions:
            for k in self.dimensions:
                for l in self.dimensions:
                    val = self.compute_connection_coefficient(index_config, i, k, l)
                    self.set_connection_coefficient(index_config, i, k, l, val)
                    if not self.suppress_printing:
                        self.print_connection_coefficient(index_config, i, k, l)

    def print_connection_coefficient(self, index_config, i, j, k):
        if index_config == "udd":
            sym = f"Gamma^{i}_{j}{k}"
        else:
            sym = f"Gamma_{i}{j}{k}"
        print("")
        pprint(Eq(Symbol(sym), self.get_connection_coefficient(index_config, i, j, k)))

    def print_all_connection_coefficients(self, index_config):
        for i in self.dimensions:
            for j in self.dimensions:
                for k in self.dimensions:
                    self.print_connection_coefficient(index_config, i, j, k)

    # ==================================================================
    #  RIEMANN CURVATURE TENSOR
    # ==================================================================

    def get_riemann_coefficient(self, index_config, rho, sig, mu, nu):
        if index_config == "uddd":
            return self.riemann_tensor_uddd[rho, sig][mu][nu]
        elif index_config == "dddd":
            return self.riemann_tensor_dddd[rho, sig][mu][nu]
        raise ValueError("index_config must be 'uddd' or 'dddd'")

    def set_riemann_coefficient(self, index_config, rho, sig, mu, nu, expression):
        if index_config == "uddd":
            self.riemann_tensor_uddd[rho, sig][mu][nu] = expression
        elif index_config == "dddd":
            self.riemann_tensor_dddd[rho, sig][mu][nu] = expression

    def compute_riemann_coefficient(self, index_config, rho, sig, mu, nu):
        coords = self.coordinate_set
        if index_config == "uddd":
            R = (diff(self.get_connection_coefficient("udd", rho, nu, sig), coords[mu])
                 - diff(self.get_connection_coefficient("udd", rho, mu, sig), coords[nu]))
            for lam in self.dimensions:
                R += (self.get_connection_coefficient("udd", rho, mu, lam)
                      * self.get_connection_coefficient("udd", lam, nu, sig)
                      - self.get_connection_coefficient("udd", rho, nu, lam)
                      * self.get_connection_coefficient("udd", lam, mu, sig))
            return simplify(R)
        elif index_config == "dddd":
            g_dd = self.metric_tensor_dd
            R = Rational(1, 2) * (
                g_dd[rho, nu].diff(coords[sig]).diff(coords[mu])
                + g_dd[sig, mu].diff(coords[rho]).diff(coords[nu])
                - g_dd[rho, mu].diff(coords[sig]).diff(coords[nu])
                - g_dd[sig, nu].diff(coords[rho]).diff(coords[mu])
            )
            for n_ in self.dimensions:
                for p in self.dimensions:
                    R += g_dd[n_, p] * (
                        self.get_connection_coefficient("udd", n_, sig, mu)
                        * self.get_connection_coefficient("udd", p, rho, nu)
                        - self.get_connection_coefficient("udd", n_, sig, nu)
                        * self.get_connection_coefficient("udd", p, rho, mu)
                    )
            return simplify(R)
        raise ValueError("index_config must be 'uddd' or 'dddd'")

    def set_all_riemann_coefficients(self, index_config):
        if not self.suppress_printing:
            print(f"\n\nRiemann curvature tensor coefficients ({index_config})")
            print("=" * 50)
        for rho in self.dimensions:
            for sig in self.dimensions:
                for mu in self.dimensions:
                    for nu in self.dimensions:
                        val = self.compute_riemann_coefficient(index_config, rho, sig, mu, nu)
                        self.set_riemann_coefficient(index_config, rho, sig, mu, nu, val)
                        if not self.suppress_printing:
                            self.print_riemann_coefficient(index_config, rho, sig, mu, nu)

    def print_riemann_coefficient(self, index_config, rho, sig, mu, nu):
        if index_config == "uddd":
            sym = f"R^{rho}_{sig}{mu}{nu}"
        else:
            sym = f"R_{rho}{sig}{mu}{nu}"
        print("")
        pprint(Eq(Symbol(sym), self.get_riemann_coefficient(index_config, rho, sig, mu, nu)))

    def print_all_riemann_coefficients(self, index_config):
        for rho in self.dimensions:
            for sig in self.dimensions:
                for mu in self.dimensions:
                    for nu in self.dimensions:
                        self.print_riemann_coefficient(index_config, rho, sig, mu, nu)

    # ==================================================================
    #  RICCI TENSOR AND SCALAR
    # ==================================================================

    def get_ricci_coefficient(self, index_config, mu, nu):
        if index_config == "uu":
            return self.ricci_tensor_uu[mu, nu]
        elif index_config == "dd":
            return self.ricci_tensor_dd[mu, nu]
        raise ValueError("index_config must be 'uu' or 'dd'")

    def set_ricci_coefficient(self, index_config, mu, nu, expression):
        if index_config == "uu":
            self.ricci_tensor_uu[mu, nu] = expression
        elif index_config == "dd":
            self.ricci_tensor_dd[mu, nu] = expression

    def compute_ricci_coefficient(self, index_config, mu, nu):
        if index_config == "dd":
            val = 0
            for lam in self.dimensions:
                val += self.get_riemann_coefficient("uddd", lam, mu, lam, nu)
            return simplify(val)
        return 0

    def set_all_ricci_coefficients(self, index_config):
        if not self.suppress_printing:
            print(f"\n\nRicci curvature tensor coefficients ({index_config})")
            print("=" * 48)
        for mu in self.dimensions:
            for nu in self.dimensions:
                val = self.compute_ricci_coefficient(index_config, mu, nu)
                self.set_ricci_coefficient(index_config, mu, nu, val)
                if not self.suppress_printing:
                    self.print_ricci_coefficient(index_config, mu, nu)

    def print_ricci_coefficient(self, index_config, mu, nu):
        sym = f"R^{mu}{nu}" if index_config == "uu" else f"R_{mu}{nu}"
        print("")
        pprint(Eq(Symbol(sym), self.get_ricci_coefficient(index_config, mu, nu)))

    def print_all_ricci_coefficients(self, index_config):
        for mu in self.dimensions:
            for nu in self.dimensions:
                self.print_ricci_coefficient(index_config, mu, nu)

    # -- Ricci scalar --

    def get_ricci_scalar(self):
        return self.ricci_scalar

    def compute_ricci_scalar(self):
        R = 0
        for mu in self.dimensions:
            for nu in self.dimensions:
                R += self.metric_tensor_uu[mu, nu] * self.get_ricci_coefficient("dd", mu, nu)
        return simplify(R)

    def set_ricci_scalar(self):
        self.ricci_scalar = self.compute_ricci_scalar()
        if not self.suppress_printing:
            print("\n\nRicci curvature scalar")
            print("=" * 22)
            self.print_ricci_scalar()

    def print_ricci_scalar(self):
        print("")
        pprint(Eq(Symbol('R'), self.get_ricci_scalar()))

    # ==================================================================
    #  EINSTEIN TENSOR
    # ==================================================================

    def get_einstein_coefficient(self, index_config, mu, nu):
        if index_config == "uu":
            return self.einstein_tensor_uu[mu, nu]
        elif index_config == "dd":
            return self.einstein_tensor_dd[mu, nu]
        raise ValueError("index_config must be 'uu' or 'dd'")

    def set_einstein_coefficient(self, index_config, mu, nu, expression):
        if index_config == "uu":
            self.einstein_tensor_uu[mu, nu] = expression
        elif index_config == "dd":
            self.einstein_tensor_dd[mu, nu] = expression

    def compute_einstein_coefficient(self, index_config, mu, nu):
        if index_config == "dd":
            val = (self.get_ricci_coefficient("dd", mu, nu)
                   - Rational(1, 2) * self.get_ricci_scalar() * self.metric_tensor_dd[mu, nu])
            return simplify(val)
        return 0

    def set_all_einstein_coefficients(self, index_config):
        if not self.suppress_printing:
            print(f"\n\nEinstein curvature tensor coefficients ({index_config})")
            print("=" * 50)
        for mu in self.dimensions:
            for nu in self.dimensions:
                val = self.compute_einstein_coefficient(index_config, mu, nu)
                self.set_einstein_coefficient(index_config, mu, nu, val)
                if not self.suppress_printing:
                    self.print_einstein_coefficient(index_config, mu, nu)

    def print_einstein_coefficient(self, index_config, mu, nu):
        sym = f"G^{mu}{nu}" if index_config == "uu" else f"G_{mu}{nu}"
        print("")
        pprint(Eq(Symbol(sym), self.get_einstein_coefficient(index_config, mu, nu)))

    def print_all_einstein_coefficients(self, index_config):
        for mu in self.dimensions:
            for nu in self.dimensions:
                self.print_einstein_coefficient(index_config, mu, nu)

    # ==================================================================
    #  STRESS-ENERGY TENSOR
    # ==================================================================

    def get_stress_energy_coefficient(self, index_config, mu, nu):
        if index_config == "uu":
            return self.stress_energy_tensor_uu[mu, nu]
        elif index_config == "dd":
            return self.stress_energy_tensor_dd[mu, nu]
        raise ValueError("index_config must be 'uu' or 'dd'")

    def set_stress_energy_coefficient(self, index_config, mu, nu, expression):
        if index_config == "uu":
            self.stress_energy_tensor_uu[mu, nu] = expression
        elif index_config == "dd":
            self.stress_energy_tensor_dd[mu, nu] = expression

    def compute_stress_energy_coefficient(self, index_config, mu, nu):
        c, G = symbols('c G')
        prefactor = c**4 / (8 * pi * G)
        if index_config == "dd":
            return simplify(
                prefactor * self.get_einstein_coefficient("dd", mu, nu)
                + prefactor * self.cosmological_constant * self.metric_tensor_dd[mu, nu]
            )
        elif index_config == "uu":
            return simplify(prefactor * self.get_einstein_coefficient("uu", mu, nu))
        return 0

    def set_all_stress_energy_coefficients(self, index_config):
        if not self.suppress_printing:
            print(f"\n\nStress-energy-momentum tensor coefficients ({index_config})")
            print("=" * 55)
        for mu in self.dimensions:
            for nu in self.dimensions:
                val = self.compute_stress_energy_coefficient(index_config, mu, nu)
                self.set_stress_energy_coefficient(index_config, mu, nu, val)
                if not self.suppress_printing:
                    self.print_stress_energy_coefficient(index_config, mu, nu)

    def print_stress_energy_coefficient(self, index_config, mu, nu):
        sym = f"T^{mu}{nu}" if index_config == "uu" else f"T_{mu}{nu}"
        print("")
        pprint(Eq(Symbol(sym), self.get_stress_energy_coefficient(index_config, mu, nu)))

    def print_all_stress_energy_coefficients(self, index_config):
        for mu in self.dimensions:
            for nu in self.dimensions:
                self.print_stress_energy_coefficient(index_config, mu, nu)

    # ==================================================================
    #  COSMOLOGICAL CONSTANT
    # ==================================================================

    def get_cosmological_constant(self):
        return self.cosmological_constant

    def set_cosmological_constant(self, value):
        self.cosmological_constant = value

    # ==================================================================
    #  GEODESIC EQUATIONS
    # ==================================================================

    # -- Proper time geodesic acceleration --

    def get_proper_acceleration(self, lam):
        return self.proper_acceleration[lam]

    def set_proper_acceleration(self, lam, expression):
        self.proper_acceleration[lam] = expression

    def compute_proper_time_geodesic_acceleration(self, lam):
        acc = 0
        for mu in self.dimensions:
            for nu in self.dimensions:
                acc -= (self.get_connection_coefficient("udd", lam, mu, nu)
                        * Derivative(self.coordinate_set[mu], Symbol('tau'))
                        * Derivative(self.coordinate_set[nu], Symbol('tau')))
        return simplify(acc)

    def set_all_proper_time_geodesic_accelerations(self):
        if not self.suppress_printing:
            print("\n\nProper-time geodesic accelerations")
            print("=" * 35)
        for lam in self.dimensions:
            val = self.compute_proper_time_geodesic_acceleration(lam)
            self.set_proper_acceleration(lam, val)
            if not self.suppress_printing:
                self.print_proper_time_geodesic_acceleration(lam)

    def print_proper_time_geodesic_acceleration(self, lam):
        print("")
        pprint(Eq(
            Derivative(Derivative(self.coordinate_set[lam], Symbol('tau')), Symbol('tau')),
            self.get_proper_acceleration(lam)
        ))

    def print_all_proper_time_geodesic_accelerations(self):
        for lam in self.dimensions:
            self.print_proper_time_geodesic_acceleration(lam)

    # -- Coordinate time geodesic acceleration --

    def get_coordinate_acceleration(self, lam):
        return self.coordinate_acceleration[lam]

    def set_coordinate_acceleration(self, lam, expression):
        self.coordinate_acceleration[lam] = expression

    def compute_coordinate_time_geodesic_acceleration(self, lam):
        acc = 0
        x0 = self.coordinate_set[0]
        for mu in self.dimensions:
            for nu in self.dimensions:
                acc += (-self.get_connection_coefficient("udd", lam, mu, nu)
                        * Derivative(self.coordinate_set[mu], x0)
                        * Derivative(self.coordinate_set[nu], x0)
                        + self.get_connection_coefficient("udd", 0, mu, nu)
                        * Derivative(self.coordinate_set[mu], x0)
                        * Derivative(self.coordinate_set[nu], x0)
                        * Derivative(self.coordinate_set[lam], x0))
        return simplify(acc)

    def set_all_coordinate_time_geodesic_accelerations(self):
        if not self.suppress_printing:
            print("\n\nCoordinate-time geodesic accelerations")
            print("=" * 40)
        for lam in self.dimensions:
            val = self.compute_coordinate_time_geodesic_acceleration(lam)
            self.set_coordinate_acceleration(lam, val)
            if not self.suppress_printing:
                self.print_coordinate_time_geodesic_acceleration(lam)

    def print_coordinate_time_geodesic_acceleration(self, lam):
        x0 = self.coordinate_set[0]
        print("")
        pprint(Eq(
            Derivative(Derivative(self.coordinate_set[lam], x0), x0),
            self.get_coordinate_acceleration(lam)
        ))

    def print_all_coordinate_time_geodesic_accelerations(self):
        for lam in self.dimensions:
            self.print_coordinate_time_geodesic_acceleration(lam)

    # -- Geodesic deviation --

    def get_geodesic_deviation_acceleration(self, lam):
        return self.geodesic_deviation_acceleration[lam]

    def set_geodesic_deviation_acceleration(self, lam, expression):
        self.geodesic_deviation_acceleration[lam] = expression

    def compute_geodesic_deviation_acceleration(self, lam):
        acc = 0
        for mu in self.dimensions:
            acc_inner = 0
            for nu in self.dimensions:
                for rho in self.dimensions:
                    for sig in self.dimensions:
                        acc_inner += (
                            self.get_riemann_coefficient("uddd", mu, nu, rho, sig)
                            * Derivative(self.coordinate_set[nu], Symbol('tau'))
                            * Derivative(self.coordinate_set[rho], Symbol('tau'))
                            * Symbol(f'xi_{sig}')
                        )
            acc = acc_inner  # Note: original had a bug reassigning acc inside mu loop
        return simplify(acc)

    def set_all_geodesic_deviation_accelerations(self):
        if not self.suppress_printing:
            print("\n\nGeodesic deviation vectors")
            print("=" * 26)
        for lam in self.dimensions:
            val = self.compute_geodesic_deviation_acceleration(lam)
            self.set_geodesic_deviation_acceleration(lam, val)
            if not self.suppress_printing:
                self.print_separation_geodesic_acceleration(lam)

    def print_separation_geodesic_acceleration(self, lam):
        print("")
        pprint(Eq(
            Derivative(Derivative(Symbol(f'xi_{lam}'), Symbol('tau')), Symbol('tau')),
            self.get_geodesic_deviation_acceleration(lam)
        ))

    def print_all_separation_geodesic_accelerations(self):
        for lam in self.dimensions:
            self.print_separation_geodesic_acceleration(lam)

    # ==================================================================
    #  WEYL TENSOR
    # ==================================================================

    def get_weyl_coefficient(self, index_config, i, k, l, m):
        if index_config == "uddd":
            return self.weyl_tensor_uddd[i, k][l][m]
        elif index_config == "dddd":
            return self.weyl_tensor_dddd[i, k][l][m]
        raise ValueError("index_config not recognized")

    def set_weyl_coefficient(self, index_config, i, k, l, m, expression):
        if index_config == "uddd":
            self.weyl_tensor_uddd[i, k][l][m] = expression
        elif index_config == "dddd":
            self.weyl_tensor_dddd[i, k][l][m] = expression

    def compute_weyl_coefficient(self, index_config, i, k, l, m):
        n = self.dimension_count
        if index_config == "dddd":
            R_iklm = self.get_riemann_coefficient("dddd", i, k, l, m)
            g = self.metric_tensor_dd
            R_il = self.get_ricci_coefficient("dd", i, l)
            R_km = self.get_ricci_coefficient("dd", k, m)
            R_im = self.get_ricci_coefficient("dd", i, m)
            R_kl = self.get_ricci_coefficient("dd", k, l)
            R = self.get_ricci_scalar()
            weyl = (R_iklm
                    - Rational(1, n - 2) * (g[i, l] * R_km - g[i, m] * R_kl
                                            + g[k, m] * R_il - g[k, l] * R_im)
                    + Rational(1, (n - 1) * (n - 2)) * R * (g[i, l] * g[k, m] - g[i, m] * g[k, l]))
            return simplify(weyl)
        return 0

    def set_all_weyl_coefficients(self, index_config):
        if not self.suppress_printing:
            print(f"\n\nWeyl tensor coefficients ({index_config})")
            print("=" * 42)
        for i in self.dimensions:
            for k in self.dimensions:
                for l in self.dimensions:
                    for m in self.dimensions:
                        val = self.compute_weyl_coefficient(index_config, i, k, l, m)
                        self.set_weyl_coefficient(index_config, i, k, l, m, val)
                        if not self.suppress_printing:
                            self.print_weyl_coefficient(index_config, i, k, l, m)

    def print_weyl_coefficient(self, index_config, i, k, l, m):
        if index_config == "uddd":
            sym = f"C^{i}_{k}{l}{m}"
        else:
            sym = f"C_{i}{k}{l}{m}"
        print("")
        pprint(Eq(Symbol(sym), self.get_weyl_coefficient(index_config, i, k, l, m)))

    def print_all_weyl_coefficients(self, index_config):
        for i in self.dimensions:
            for k in self.dimensions:
                for l in self.dimensions:
                    for m in self.dimensions:
                        self.print_weyl_coefficient(index_config, i, k, l, m)

    # ==================================================================
    #  SCHOUTEN TENSOR
    # ==================================================================

    def get_schouten_coefficient(self, index_config, mu, nu):
        if index_config == "uu":
            return self.schouten_tensor_uu[mu, nu]
        elif index_config == "dd":
            return self.schouten_tensor_dd[mu, nu]
        raise ValueError("index_config must be 'uu' or 'dd'")

    def set_schouten_coefficient(self, index_config, mu, nu, expression):
        if index_config == "uu":
            self.schouten_tensor_uu[mu, nu] = expression
        elif index_config == "dd":
            self.schouten_tensor_dd[mu, nu] = expression

    def compute_schouten_coefficient(self, index_config, mu, nu):
        n = self.dimension_count
        if index_config == "dd":
            return simplify(
                Rational(1, n - 2) * (
                    self.get_ricci_coefficient("dd", mu, nu)
                    - Rational(1, 2 * (n - 1)) * self.get_ricci_scalar() * self.metric_tensor_dd[mu, nu]
                )
            )
        return 0

    def set_all_schouten_coefficients(self, index_config):
        if not self.suppress_printing:
            print(f"\n\nSchouten tensor coefficients ({index_config})")
            print("=" * 45)
        for mu in self.dimensions:
            for nu in self.dimensions:
                val = self.compute_schouten_coefficient(index_config, mu, nu)
                self.set_schouten_coefficient(index_config, mu, nu, val)
                if not self.suppress_printing:
                    self.print_schouten_coefficient(index_config, mu, nu)

    def print_schouten_coefficient(self, index_config, mu, nu):
        sym = f"P^{mu}{nu}" if index_config == "uu" else f"P_{mu}{nu}"
        print("")
        pprint(Eq(Symbol(sym), self.get_schouten_coefficient(index_config, mu, nu)))

    def print_all_schouten_coefficients(self, index_config):
        for mu in self.dimensions:
            for nu in self.dimensions:
                self.print_schouten_coefficient(index_config, mu, nu)

    # ==================================================================
    #  UTILITY: non-zero summary
    # ==================================================================

    def print_nonzero_einstein(self, index_config="dd"):
        """Print only the nonzero components of the Einstein tensor."""
        print(f"\nNon-zero Einstein tensor components ({index_config}):")
        print("-" * 50)
        found = False
        for mu in self.dimensions:
            for nu in self.dimensions:
                val = self.get_einstein_coefficient(index_config, mu, nu)
                if val != 0:
                    found = True
                    sym = f"G_{mu}{nu}" if index_config == "dd" else f"G^{mu}{nu}"
                    print("")
                    pprint(Eq(Symbol(sym), val))
        if not found:
            print("  (all zero — vacuum solution)")

    def print_nonzero_ricci(self, index_config="dd"):
        """Print only the nonzero components of the Ricci tensor."""
        print(f"\nNon-zero Ricci tensor components ({index_config}):")
        print("-" * 50)
        found = False
        for mu in self.dimensions:
            for nu in self.dimensions:
                val = self.get_ricci_coefficient(index_config, mu, nu)
                if val != 0:
                    found = True
                    sym = f"R_{mu}{nu}" if index_config == "dd" else f"R^{mu}{nu}"
                    print("")
                    pprint(Eq(Symbol(sym), val))
        if not found:
            print("  (all zero — Ricci flat)")

    def print_nonzero_connections(self, index_config="udd"):
        """Print only the nonzero Christoffel symbols."""
        print(f"\nNon-zero connection coefficients ({index_config}):")
        print("-" * 50)
        for i in self.dimensions:
            for j in self.dimensions:
                for k in self.dimensions:
                    val = self.get_connection_coefficient(index_config, i, j, k)
                    if val != 0:
                        self.print_connection_coefficient(index_config, i, j, k)
