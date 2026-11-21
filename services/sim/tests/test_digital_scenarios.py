"""Exercise 3 (logic simulation), scenario evaluation, and the Session (Rule 2)."""
from eduminds import Session, evaluate, simulate
from helpers import (codes, ex1, ex2, ex3, remove_component, remove_terminal, set_param,
                     swap_terminals)


# ---- exercise 3
def test_ex3_correct_wiring_shows_distance():
    r = simulate(ex3())
    assert r["status"] == "ok"
    lcd = r["components"]["LCD1"]
    assert lcd["state"] == "showing_distance"
    assert lcd["lines"] == ["Distance: 216 cm", "Distance:  85 in"]
    assert lcd["backlight"] == "on"


def test_ex3_distance_changes_display():
    r = simulate(set_param(ex3(), "US1", "distance_cm", 50))
    assert r["components"]["LCD1"]["lines"][0] == "Distance:  50 cm"


def test_ex3_out_of_range():
    r = simulate(set_param(ex3(), "US1", "distance_cm", 500))
    assert r["components"]["LCD1"]["lines"][0].startswith("Out of range")


def test_ex3_trig_echo_swapped():
    r = simulate(swap_terminals(ex3(), "UNO1.D9", "UNO1.D10"))
    assert "WIRING_TRIG_ECHO" in codes(r)
    assert "---" in r["components"]["LCD1"]["lines"][0]


def test_ex3_sensor_without_power():
    r = simulate(remove_terminal(ex3(), "US1.VCC"))
    assert "SENSOR_NO_POWER" in codes(r) and r["status"] == "error"


def test_ex3_lcd_without_power_is_blank():
    r = simulate(remove_terminal(ex3(), "LCD1.VDD"))
    assert "LCD_NO_POWER" in codes(r)
    assert r["components"]["LCD1"]["state"] == "off"


def test_ex3_backlight_without_resistor():
    nl = remove_component(ex3(), "R1")
    r = simulate(nl)
    assert "BACKLIGHT_NO_RESISTOR" in codes(r)


def test_ex3_missing_lcd():
    r = simulate(remove_component(ex3(), "LCD1", merge=False))
    assert "MISSING_PART" in codes(r)


# ---- scenarios
def test_target_netlists_complete_their_scenarios():
    for nl, sid in [(ex1(), "ex1_led_series"), (ex2(), "ex2_diode_buzzer"), (ex3(), "ex3_ultrasonic_lcd")]:
        r = evaluate(nl, sid)
        assert r["scenario_check"]["completed"], sid


def test_scenario_missing_resistor_gives_hint():
    r = evaluate(remove_component(ex1(), "R1"), "ex1_led_series")
    assert r["scenario_check"]["missing"] == ["resistor"]
    assert not r["scenario_check"]["completed"]
    hints = {m["code"]: m.get("hint") for m in r["messages"]}
    assert hints["LED_OVERCURRENT"] and hints["MISSING_COMPONENT"]


def test_scenario_switch_open_built_but_goal_not_reached():
    r = evaluate(set_param(ex1(), "SW1", "closed", False), "ex1_led_series")
    sc = r["scenario_check"]
    assert sc["built_correctly"] and not sc["goal_reached"] and not sc["completed"]


def test_scenario_wiring_differs():
    # a resistor has no polarity: flipping it is still the right circuit
    r = evaluate(swap_terminals(ex1(), "R1.a", "R1.b"), "ex1_led_series")
    assert r["scenario_check"]["completed"]
    # a flipped LED is NOT the same circuit
    r = evaluate(swap_terminals(ex1(), "LED1.anode", "LED1.cathode"), "ex1_led_series")
    assert not r["scenario_check"]["completed"]
    r = evaluate(swap_terminals(ex1(), "R1.a", "SW1.a"), "ex1_led_series")
    assert "WIRING_DIFFERS" in codes(r)


def test_scenario_extra_component():
    nl = ex1(); nl["components"].append({"id": "R2", "type": "resistor", "params": {"resistance": 100}})
    r = evaluate(nl, "ex1_led_series")
    assert r["scenario_check"]["extra"] == ["resistor"]


def test_scenario_flipped_diode_keeps_hint():
    r = evaluate(swap_terminals(ex2(), "D1.anode", "D1.cathode"), "ex2_diode_buzzer")
    short = [m for m in r["messages"] if m["code"] == "SHORT_CIRCUIT"][0]
    assert "hint" in short


# ---- Rule 2: session keeps the last good result
def test_session_keeps_last_good_result_on_bad_frame():
    s = Session("ex1_led_series")
    good = s.update(ex1())
    assert good["status"] == "ok" and "stale" not in good
    bad = s.update({"schema_version": "0.2", "components": "oops"})
    assert bad["stale"] is True and bad["components"]["LED1"]["state"] == "on"


def test_session_bad_first_frame_is_an_error_not_a_crash():
    r = Session().update(None)
    assert r["status"] == "error"


def test_session_real_circuit_mistake_is_not_stale():
    s = Session("ex1_led_series")
    s.update(ex1())
    r = s.update(remove_component(ex1(), "R1"))
    assert "stale" not in r and "LED_OVERCURRENT" in codes(r)
