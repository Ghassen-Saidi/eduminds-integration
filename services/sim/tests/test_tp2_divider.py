"""Exercise 4 (TP2): a voltage divider feeding a 3.3 V sensor.

The point of the exercise is the arithmetic: V = 9 x R2 / (R1 + R2), loaded by
the sensor's 100 kOhm input. The safe window is 2.0 V - 3.3 V.
"""
import copy

from eduminds import evaluate, simulate
from helpers import codes, load


def ex4():
    return load("netlist_ex4_divider_sensor.json")


def with_resistors(r1, r2):
    nl = copy.deepcopy(ex4())
    for component in nl["components"]:
        if component["id"] == "R1":
            component["params"]["resistance"] = r1
        if component["id"] == "R2":
            component["params"]["resistance"] = r2
    return nl


def swap_sensor():
    nl = copy.deepcopy(ex4())
    for net in nl["nets"]:
        net["connections"] = ["SENSOR1.neg" if t == "SENSOR1.pos"
                              else "SENSOR1.pos" if t == "SENSOR1.neg" else t
                              for t in net["connections"]]
    return nl


def test_correct_divider_powers_the_sensor_and_completes():
    result = simulate(ex4())
    sensor = result["components"]["SENSOR1"]
    assert result["status"] == "ok"
    assert sensor["state"] == "powered"
    assert abs(sensor["voltage_v"] - 2.2276) < 0.005
    check = evaluate(ex4(), "ex4_divider_sensor")["scenario_check"]
    assert check["built_correctly"] is True
    assert check["goal_reached"] is True
    assert check["completed"] is True


def test_equal_resistors_destroy_the_sensor():
    result = simulate(with_resistors(1000, 1000))
    sensor = result["components"]["SENSOR1"]
    assert sensor["state"] == "destroyed"
    assert abs(sensor["voltage_v"] - 4.478) < 0.01
    assert "SENSOR_OVERVOLTAGE" in codes(result)
    check = evaluate(with_resistors(1000, 1000), "ex4_divider_sensor")["scenario_check"]
    assert check["built_correctly"] is True      # wiring is right, the values are not
    assert check["goal_reached"] is False


def test_330_over_220_is_over_the_33_volt_maximum():
    result = simulate(with_resistors(330, 220))
    assert result["components"]["SENSOR1"]["state"] == "destroyed"
    assert "SENSOR_OVERVOLTAGE" in codes(result)


def test_too_large_a_divider_ratio_leaves_the_sensor_underpowered():
    result = simulate(with_resistors(1000, 220))
    sensor = result["components"]["SENSOR1"]
    assert sensor["state"] == "underpowered"
    assert abs(sensor["voltage_v"] - 1.62) < 0.01
    assert "SENSOR_UNDERPOWERED" in codes(result)


def test_a_reversed_sensor_is_reported_not_silently_negative():
    result = simulate(swap_sensor())
    sensor = result["components"]["SENSOR1"]
    assert sensor["state"] == "reversed"
    assert sensor["voltage_v"] < 0
    assert "SENSOR_REVERSED" in codes(result)


def test_sensor_across_the_battery_is_overvoltage():
    nl = copy.deepcopy(ex4())
    for net in nl["nets"]:
        if net["id"] == "N2":
            net["connections"] = [t for t in net["connections"] if t != "SENSOR1.pos"]
        if net["id"] == "N1":
            net["connections"].append("SENSOR1.pos")
    result = simulate(nl)
    sensor = result["components"]["SENSOR1"]
    assert sensor["state"] == "destroyed"
    assert abs(sensor["voltage_v"] - 9.0) < 0.01
    assert "SENSOR_OVERVOLTAGE" in codes(result)


def test_missing_sensor_is_reported_as_a_missing_component():
    nl = copy.deepcopy(ex4())
    nl["components"] = [c for c in nl["components"] if c["id"] != "SENSOR1"]
    for net in nl["nets"]:
        net["connections"] = [t for t in net["connections"] if not t.startswith("SENSOR1.")]
    result = evaluate(nl, "ex4_divider_sensor")
    assert result["scenario_check"]["missing"] == ["sensor_3v3"]
    assert "MISSING_COMPONENT" in codes(result)


def test_negative_maximum_voltage_is_invalid_input():
    nl = copy.deepcopy(ex4())
    for component in nl["components"]:
        if component["id"] == "SENSOR1":
            component["params"]["max_voltage"] = -1
    result = simulate(nl)
    assert "INVALID_PARAM" in codes(result)
    assert result["status"] == "error"
