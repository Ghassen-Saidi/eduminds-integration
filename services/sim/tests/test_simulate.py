"""Tests for the safe-failure rules, exercise 1 and exercise 2."""
import copy

import pytest

from eduminds import simulate
from helpers import (codes, divider, ex1, ex2, remove_component, set_param, swap_terminals)


# ---- plain circuits
def test_divider_numbers():
    r = simulate(divider())
    assert r["status"] == "ok"
    assert r["nodes"]["MID"] == pytest.approx(6.0, rel=1e-6)
    assert r["components"]["R1"]["current_a"] == pytest.approx(0.003, rel=1e-6)


# ---- exercise 1
def test_ex1_correct_circuit():
    r = simulate(ex1())
    assert r["status"] == "ok" and r["messages"] == []
    assert r["components"]["LED1"]["state"] == "on"
    assert r["components"]["LED1"]["current_a"] == pytest.approx(7 / 331, rel=1e-3)


def test_ex1_switch_open_is_normal_not_an_error():          # Rule 6
    r = simulate(set_param(ex1(), "SW1", "closed", False))
    assert r["status"] == "ok"
    assert r["components"]["LED1"]["state"] == "off"
    assert r["components"]["BAT1"]["current_a"] == pytest.approx(0.0, abs=1e-9)
    assert r["components"]["SW1"]["state"] == "open"


def test_ex1_missing_resistor_burns_led():                   # Rule 8
    r = simulate(remove_component(ex1(), "R1"))
    assert "LED_OVERCURRENT" in codes(r)
    assert "SHORT_CIRCUIT" not in codes(r)
    assert r["components"]["LED1"]["state"] == "burned"
    assert r["status"] == "warning"


def test_ex1_small_resistor_burns_led():
    r = simulate(set_param(ex1(), "R1", "resistance", 22))
    assert r["components"]["LED1"]["state"] == "burned"


def test_ex1_led_reversed():                                 # Rule 9
    r = simulate(swap_terminals(ex1(), "LED1.anode", "LED1.cathode"))
    assert "LED_REVERSED" in codes(r)
    assert r["components"]["LED1"]["state"] == "off"
    assert r["components"]["LED1"]["current_a"] == 0.0


def test_ex1_missing_led_is_open_circuit():
    r = simulate(remove_component(ex1(), "LED1", merge=False))
    assert r["status"] == "ok"
    assert r["components"]["BAT1"]["current_a"] == pytest.approx(0.0, abs=1e-9)


def test_resistor_overheat():                                # Rule 11
    r = simulate(divider(r1=10, r2=10, volts=9.0))           # 9 V over 20 ohm -> 1.8 W in 10 ohm
    assert "RESISTOR_OVERHEAT" in codes(r)
    assert r["components"]["R1"]["state"] == "overheating"


# ---- topology rules
def test_no_battery():                                       # Rule 3
    nl = remove_component(ex1(), "BAT1", merge=False)
    r = simulate(nl)
    assert "NO_SOURCE" in codes(r) and r["status"] == "warning"
    assert r["components"]["LED1"]["state"] == "off"


def test_empty_board_is_not_a_crash():
    r = simulate({"schema_version": "0.2", "components": [], "nets": []})
    assert "NO_SOURCE" in codes(r)


def test_no_ground_token_uses_battery_negative():            # Rule 4
    r = simulate(remove_component(ex1(), "GND1", merge=False))
    assert "NO_GROUND_TOKEN" in codes(r)
    assert r["components"]["LED1"]["state"] == "on"


def test_dangling_terminal_is_reported():                    # Rule 5
    nl = copy.deepcopy(divider())
    nl["nets"][1]["connections"].remove("R2.a")
    r = simulate(nl)
    assert "DANGLING_TERMINAL" in codes(r)


def test_direct_short_circuit():                             # Rule 7
    nl = copy.deepcopy(divider())
    nl["nets"][0]["connections"].append("BAT1.neg")          # battery + and - in the same net
    nl["nets"][2]["connections"].remove("BAT1.neg")
    r = simulate(nl)
    assert "SHORT_CIRCUIT" in codes(r) and r["status"] == "error"


def test_closed_switch_across_battery_is_short_circuit():
    nl = {
        "schema_version": "0.2",
        "components": [{"id": "BAT1", "type": "battery", "params": {"voltage": 9}},
                       {"id": "SW1", "type": "switch", "params": {"closed": True}}],
        "nets": [{"id": "A", "connections": ["BAT1.pos", "SW1.a"]},
                 {"id": "B", "connections": ["BAT1.neg", "SW1.b"]}],
    }
    assert "SHORT_CIRCUIT" in codes(simulate(nl))
    nl["components"][1]["params"]["closed"] = False
    assert simulate(nl)["status"] != "error"


def test_two_batteries_against_each_other_do_not_crash():
    nl = {
        "schema_version": "0.2",
        "components": [{"id": "B1", "type": "battery", "params": {"voltage": 5}},
                       {"id": "B2", "type": "battery", "params": {"voltage": 9}},
                       {"id": "R1", "type": "resistor", "params": {"resistance": 100}}],
        "nets": [{"id": "A", "connections": ["B1.pos", "B2.pos", "R1.a"]},
                 {"id": "G", "connections": ["B1.neg", "B2.neg", "R1.b"]}],
    }
    assert "UNSOLVABLE" in codes(simulate(nl))


# ---- exercise 2
def test_ex2_correct_circuit():
    r = simulate(ex2())
    assert r["status"] == "ok"
    assert r["components"]["BUZZER1"]["state"] == "sounding"
    assert r["components"]["BUZZER1"]["current_a"] == pytest.approx(0.03, rel=1e-3)
    assert r["components"]["D1"]["state"] == "reverse_blocking"


def test_ex2_diode_flipped_is_short_circuit():
    r = simulate(swap_terminals(ex2(), "D1.anode", "D1.cathode"))
    assert "SHORT_CIRCUIT" in codes(r) and r["status"] == "error"
    assert r["components"]["D1"]["state"] == "overloaded"


def test_ex2_switch_open_buzzer_silent():
    r = simulate(set_param(ex2(), "SW1", "closed", False))
    assert r["status"] == "ok"
    assert r["components"]["BUZZER1"]["state"] == "silent"


def test_ex2_buzzer_reversed():
    r = simulate(swap_terminals(ex2(), "BUZZER1.pos", "BUZZER1.neg"))
    assert "BUZZER_REVERSED" in codes(r)


# ---- Rule 1: malformed input never crashes
@pytest.mark.parametrize("bad", [None, [], "text", {}, {"schema_version": "0.2"}])
def test_garbage_input(bad):
    r = simulate(bad)
    assert r["status"] == "error"


def test_wrong_version():
    nl = ex1(); nl["schema_version"] = "0.1"
    assert "UNSUPPORTED_VERSION" in codes(simulate(nl))


def test_duplicate_id():
    nl = ex1(); nl["components"].append(copy.deepcopy(nl["components"][2]))
    assert "DUPLICATE_ID" in codes(simulate(nl))


def test_unknown_type_and_terminal():
    nl = ex1(); nl["components"][2]["type"] = "capacitor"
    assert "INVALID_COMPONENT" in codes(simulate(nl))
    nl = ex1(); nl["nets"][0]["connections"].append("R1.z")
    assert "UNKNOWN_TERMINAL" in codes(simulate(nl))


def test_terminal_in_two_nets():
    nl = ex1(); nl["nets"][1]["connections"].append("BAT1.pos")
    assert "TERMINAL_IN_TWO_NETS" in codes(simulate(nl))


@pytest.mark.parametrize("value", [0, -5, "abc", None, float("inf")])
def test_invalid_resistance(value):
    r = simulate(set_param(ex1(), "R1", "resistance", value))
    assert "INVALID_PARAM" in codes(r) and r["status"] == "error"


def test_digital_part_in_analog_circuit():
    nl = ex1(); nl["components"].append({"id": "UNO1", "type": "arduino_uno"})
    assert "DOMAIN_MISMATCH" in codes(simulate(nl))
