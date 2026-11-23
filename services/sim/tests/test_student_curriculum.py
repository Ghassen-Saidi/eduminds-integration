import json
from pathlib import Path
from eduminds.simulate import simulate

DATA = Path(__file__).resolve().parents[1] / "data"

def netlist(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))

def test_tp2_regulator_powers_student_app_sensor():
    result = simulate(netlist("netlist_ex4_divider_sensor.json"))
    assert result["status"] in ("ok", "warning")
    assert result["components"]["REG1"]["state"] == "regulating"
    assert result["components"]["SENSOR1"]["state"] == "powered"
    assert abs(result["components"]["SENSOR1"]["voltage_v"] - 3.3) < 0.05

def test_tp2_regulator_dropout_is_reported():
    nl = netlist("netlist_ex4_divider_sensor.json")
    nl["components"][0]["params"]["voltage"] = 3.0
    # A 3 V source cannot satisfy a 3.3 V regulator plus 1 V dropout.
    result = simulate(nl)
    assert result["components"]["REG1"]["state"] == "dropout"
    assert any(m["code"] == "REGULATOR_DROPOUT" for m in result["messages"])

def test_tp3_short_circuit_blows_500ma_fuse():
    result = simulate(netlist("netlist_ex5_short_circuit.json"))
    assert result["components"]["FUSE1"]["state"] == "blown"
    assert any(m["code"] in ("SHORT_CIRCUIT", "SHORT_CIRCUIT_CURRENT") for m in result["messages"])
    assert any(m["code"] == "FUSE_BLOWN" for m in result["messages"])
