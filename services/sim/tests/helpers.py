import copy
import json

from eduminds.netlist import DATA_DIR


def load(name):
    with open(DATA_DIR / name, encoding="utf-8") as f:
        return json.load(f)


def ex1():
    return load("netlist_ex1_led.json")


def ex2():
    return load("netlist_ex2_diode_buzzer.json")


def ex3():
    return load("netlist_ex3_arduino_ultrasonic_lcd.json")


def remove_component(nl, cid, merge=True):
    """Remove a component. merge=True joins the wires it used to sit between."""
    nl = copy.deepcopy(nl)
    nl["components"] = [c for c in nl["components"] if c["id"] != cid]
    touched, keep = [], []
    for net in nl["nets"]:
        rest = [t for t in net["connections"] if t.split(".")[0] != cid]
        if len(rest) != len(net["connections"]):
            touched.append({"id": net["id"], "connections": rest})
        else:
            keep.append(net)
    if merge and touched:
        touched = [{"id": touched[0]["id"], "connections": [t for n in touched for t in n["connections"]]}]
    nl["nets"] = keep + touched
    return nl


def remove_terminal(nl, term):
    nl = copy.deepcopy(nl)
    for net in nl["nets"]:
        net["connections"] = [t for t in net["connections"] if t != term]
    return nl


def swap_terminals(nl, a, b):
    nl = copy.deepcopy(nl)
    for net in nl["nets"]:
        net["connections"] = [b if t == a else a if t == b else t for t in net["connections"]]
    return nl


def set_param(nl, cid, key, value):
    nl = copy.deepcopy(nl)
    for c in nl["components"]:
        if c["id"] == cid:
            c.setdefault("params", {})[key] = value
    return nl


def divider(r1=1000, r2=2000, volts=9.0):
    """Battery - R1 - R2 - ground."""
    return {
        "schema_version": "0.2",
        "components": [
            {"id": "BAT1", "type": "battery", "params": {"voltage": volts}},
            {"id": "R1", "type": "resistor", "params": {"resistance": r1}},
            {"id": "R2", "type": "resistor", "params": {"resistance": r2}},
            {"id": "GND1", "type": "ground"},
        ],
        "nets": [
            {"id": "TOP", "connections": ["BAT1.pos", "R1.a"]},
            {"id": "MID", "connections": ["R1.b", "R2.a"]},
            {"id": "GND", "connections": ["R2.b", "BAT1.neg", "GND1.gnd"]},
        ],
    }


def codes(result):
    return [m["code"] for m in result["messages"]]
