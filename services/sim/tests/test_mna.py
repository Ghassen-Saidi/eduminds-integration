"""Solver tests against hand calculations."""
import pytest

from eduminds import mna


def test_one_resistor_ohms_law():
    # node 0 = battery +, 9 V across 1 kOhm -> 9 mA
    sol = mna.solve_dc(1, [(0, None, 1 / 1000)], [(0, None, 9.0)])
    assert sol.node_v[0] == pytest.approx(9.0)
    assert -sol.vsrc_i[0] == pytest.approx(0.009, rel=1e-6)


def test_voltage_divider():
    # 9 V, 1k + 2k -> middle node = 6 V, current 3 mA
    sol = mna.solve_dc(2, [(0, 1, 1 / 1000), (1, None, 1 / 2000)], [(0, None, 9.0)])
    assert sol.node_v[1] == pytest.approx(6.0, rel=1e-6)
    assert -sol.vsrc_i[0] == pytest.approx(0.003, rel=1e-6)


def test_parallel_resistors():
    # 12 V across 1k || 1k -> 24 mA total
    sol = mna.solve_dc(1, [(0, None, 1e-3), (0, None, 1e-3)], [(0, None, 12.0)])
    assert -sol.vsrc_i[0] == pytest.approx(0.024, rel=1e-6)


def test_floating_node_does_not_crash():
    sol = mna.solve_dc(2, [(0, None, 1e-3)], [(0, None, 5.0)])   # node 1 connects to nothing
    assert sol.node_v[1] == pytest.approx(0.0, abs=1e-6)


def test_diode_forward_and_reverse():
    # 9 V -> 330 ohm -> diode (vf 0.7, ron 1) -> ground
    sol = mna.solve_dc(2, [(0, 1, 1 / 330)], [(0, None, 9.0)], [(1, None, 0.7, 1.0)])
    assert sol.diode_on == [True]
    assert sol.diode_i[0] == pytest.approx((9 - 0.7) / 331, rel=1e-6)
    # reversed: cathode to the resistor, anode to ground -> no current
    sol = mna.solve_dc(2, [(0, 1, 1 / 330)], [(0, None, 9.0)], [(None, 1, 0.7, 1.0)])
    assert sol.diode_on == [False]
    assert sol.diode_i[0] == 0.0


def test_conflicting_sources_are_unsolvable():
    with pytest.raises(mna.SolverError):
        mna.solve_dc(1, [], [(0, None, 5.0), (0, None, 9.0)])
