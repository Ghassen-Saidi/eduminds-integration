"""Modified Nodal Analysis (MNA): DC solver with piecewise-linear diodes.

Nodes are integers 0..n-1; ground is None (it is not a row of the matrix).
Unknowns: x = [node voltages (n)] + [current through each voltage source (m)].
Equation:  A x = z   (KCL at every node + one equation per voltage source).
"""
from dataclasses import dataclass

import numpy as np

GMIN = 1e-12      # tiny conductance node->ground so floating nodes don't make A singular
MAX_ITER = 50


class SolverError(Exception):
    pass


@dataclass
class Solution:
    node_v: list      # voltage of each node (V)
    vsrc_i: list      # current p -> q THROUGH each source (A); delivered current = -vsrc_i
    diode_on: list    # True if the diode conducts
    diode_i: list     # diode current anode -> cathode (A)


def _build(n, conductances, vsources, diodes, on):
    m = len(vsources)
    A = np.zeros((n + m, n + m))
    z = np.zeros(n + m)

    def stamp(a, b, g):
        if a is not None:
            A[a, a] += g
        if b is not None:
            A[b, b] += g
        if a is not None and b is not None:
            A[a, b] -= g
            A[b, a] -= g

    for i in range(n):
        A[i, i] += GMIN
    for a, b, g in conductances:
        stamp(a, b, g)
    for j, (p, q, v) in enumerate(vsources):
        r = n + j
        if p is not None:
            A[p, r] += 1
            A[r, p] += 1
        if q is not None:
            A[q, r] -= 1
            A[r, q] -= 1
        z[r] = v
    for (a, c, vf, ron), is_on in zip(diodes, on):
        if is_on:           # diode ON = a battery of vf in series with ron
            g = 1.0 / ron
            stamp(a, c, g)
            if a is not None:
                z[a] += g * vf
            if c is not None:
                z[c] -= g * vf
        else:               # diode OFF = open circuit
            stamp(a, c, GMIN)
    return A, z


def solve_dc(n, conductances, vsources, diodes=()):
    """conductances: [(n1, n2, g)], vsources: [(plus, minus, volts)], diodes: [(anode, cathode, vf, ron)]."""
    on = [False] * len(diodes)
    for _ in range(MAX_ITER):
        A, z = _build(n, conductances, vsources, diodes, on)
        try:
            x = np.linalg.solve(A, z)
        except np.linalg.LinAlgError as exc:
            raise SolverError("singular matrix") from exc
        if not np.all(np.isfinite(x)) or np.max(np.abs(A @ x - z)) > 1e-6 * (1 + np.max(np.abs(z))):
            raise SolverError("no valid solution")
        v = x[:n]

        def volt(i):
            return 0.0 if i is None else float(v[i])

        worst, amount = None, 1e-9
        for d, ((a, c, vf, _), is_on) in enumerate(zip(diodes, on)):
            vd = volt(a) - volt(c)
            violation = (vf - vd) if is_on else (vd - vf)   # >0 means the guess is wrong
            if violation > amount:
                worst, amount = d, violation
        if worst is None:
            diode_i = []
            for (a, c, vf, ron), is_on in zip(diodes, on):
                vd = volt(a) - volt(c)
                diode_i.append((vd - vf) / ron if is_on else 0.0)
            return Solution([float(t) for t in v], [float(t) for t in x[n:]], list(on), diode_i)
        on[worst] = not on[worst]      # fix one diode at a time, then re-solve
    raise SolverError("diode states did not converge")
