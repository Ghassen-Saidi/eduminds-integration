"""Loading files, messages, and Stage 1 rules (is the input data valid?)."""
import json
import math
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SCHEMA_VERSION = "0.2"
DIGITAL_TYPES = {"arduino_uno", "hc_sr04", "lcd_16x2"}

# Codes that mean "the data from Vision is bad" (not "the circuit is bad").
INPUT_ERROR_CODES = {
    "INVALID_NETLIST", "UNSUPPORTED_VERSION", "INVALID_COMPONENT", "DUPLICATE_ID",
    "UNKNOWN_TERMINAL", "TERMINAL_IN_TWO_NETS", "INVALID_PARAM", "DOMAIN_MISMATCH",
}

# One place for every student-facing sentence. Codes are stable (Team 4 logs them).
TEXTS = {
    "INVALID_NETLIST": "The circuit data is incomplete (it needs 'components' and 'nets' lists).",
    "NOT_OBJECT": "The circuit data is not a JSON object.",
    "BAD_NET": "A net entry is malformed (it needs an 'id' and a 'connections' list).",
    "UNSUPPORTED_VERSION": "Unsupported schema_version {found!r}; this simulator expects {expected!r}.",
    "INVALID_COMPONENT": "A component entry is missing its 'id' or 'type'.",
    "UNKNOWN_TYPE": "{component} has an unknown type {type!r}.",
    "DUPLICATE_ID": "The component id {component} appears more than once.",
    "DOMAIN_MISMATCH": "{component} is a digital part, but this circuit is declared analog.",
    "UNKNOWN_TERMINAL": "The connection {terminal!r} does not match any component terminal.",
    "TERMINAL_IN_TWO_NETS": "{terminal} appears in two different nets.",
    "INVALID_PARAM": "{component} has an invalid value for {param!r}.",
    "NO_SOURCE": "There is no battery on the board, so no current can flow. Add a battery.",
    "NO_GROUND_TOKEN": "No ground is connected; the battery's negative terminal is used as 0 V.",
    "DANGLING_TERMINAL": "{terminal} is not connected to anything.",
    "SHORT_CIRCUIT": "Short circuit: the two ends of {component} are joined with nothing to limit the current.",
    "SHORT_CIRCUIT_CURRENT": "The battery is delivering {current:.1f} A, far too much. Something is connected straight across it with nothing to limit the current.",
    "LED_OVERCURRENT": "{component} receives {current_ma:.0f} mA and is burned out. An LED needs a resistor in series.",
    "LED_REVERSED": "{component} is the wrong way round and blocks the current. Flip it.",
    "RESISTOR_OVERHEAT": "{component} dissipates {power:.2f} W, more than its {rating:.2f} W rating. It is overheating.",
    "BUZZER_REVERSED": "{component} is connected the wrong way round and stays silent.",
    "BUZZER_OVERVOLTAGE": "{component} receives {voltage:.1f} V, above its {rated:.1f} V rating.",
    "UNSOLVABLE": "The circuit equations have no unique solution (for example two batteries wired against each other).",
    "NUMERIC_ERROR": "The calculation produced an invalid number, so no result is shown.",
    "MISSING_PART": "This circuit needs: {missing}.",
    "MISSING_COMPONENT": "A {component} is missing.",
    "EXTRA_COMPONENT": "An extra {component} is not part of this exercise.",
    "WIRING_DIFFERS": "All the parts are present but they are not connected as in the exercise.",
    "SENSOR_NO_POWER": "The distance sensor is not powered (VCC to 5V and GND to GND).",
    "LCD_NO_POWER": "The LCD is not powered (VDD to 5V and VSS to GND).",
    "WIRING_TRIG_ECHO": "The sensor's TRIG/ECHO are not wired to the pins the program uses (D9, D10).",
    "WIRING_LCD": "The LCD control or data pins do not match the program (RS D12, E D11, D4 to D7 on D5 to D2).",
    "WIRING_LCD_RW_V0": "LCD pins RW and V0 must be connected to GND.",
    "SENSOR_OVERVOLTAGE": "{component} receives {voltage:.2f} V, above its {max_voltage:.1f} V maximum. Bring the supply down with a voltage divider.",
    "SENSOR_UNDERPOWERED": "{component} receives only {voltage:.2f} V, below the {min_voltage:.1f} V it needs to work. Check the divider ratio.",
    "SENSOR_REVERSED": "{component} is the wrong way round: its + terminal must go to the middle of the divider.",
    "BACKLIGHT_NO_RESISTOR": "The LCD backlight is connected straight to 5V. Put a resistor in series.",
}


def message(code, severity, component=None, key=None, **fmt):
    text = TEXTS[key or code].format(component=component, **fmt)
    return {"code": code, "severity": severity, "component": component, "text": text}


def status_of(messages):
    severities = {m["severity"] for m in messages}
    if "error" in severities:
        return "error"
    if "warning" in severities:
        return "warning"
    return "ok"


def load_json(name):
    with open(DATA_DIR / name, encoding="utf-8") as f:
        return json.load(f)


def load_component_library():
    return load_json("components.json")["types"]


def resolved_params(component, library):
    return {**library[component["type"]]["defaults"], **(component.get("params") or {})}


_POSITIVE = {
    "battery": ("voltage",),
    "resistor": ("resistance",),
    "led": ("forward_voltage", "max_current"),
    "diode": ("forward_voltage",),
    "buzzer": ("equivalent_resistance", "rated_voltage", "min_voltage"),
    "sensor_3v3": ("max_voltage", "min_voltage", "input_resistance"),
}


def _is_number(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def validate_input(netlist, library):
    """Rule 1: reject malformed data. Never raises; returns a list of error messages."""
    if not isinstance(netlist, dict):
        return [message("INVALID_NETLIST", "error", key="NOT_OBJECT")]
    errors = []
    if netlist.get("schema_version") != SCHEMA_VERSION:
        errors.append(message("UNSUPPORTED_VERSION", "error",
                              found=netlist.get("schema_version"), expected=SCHEMA_VERSION))
    comps, nets = netlist.get("components"), netlist.get("nets")
    if not isinstance(comps, list) or not isinstance(nets, list):
        errors.append(message("INVALID_NETLIST", "error"))
        return errors
    domain = netlist.get("domain", "analog")
    seen = {}
    for c in comps:
        if not isinstance(c, dict) or "id" not in c or "type" not in c:
            errors.append(message("INVALID_COMPONENT", "error"))
            continue
        cid, ctype = c["id"], c["type"]
        if cid in seen:
            errors.append(message("DUPLICATE_ID", "error", cid))
            continue
        if ctype not in library:
            errors.append(message("INVALID_COMPONENT", "error", cid, key="UNKNOWN_TYPE", type=ctype))
            continue
        seen[cid] = ctype
        raw = c.get("params") or {}
        if not isinstance(raw, dict):
            errors.append(message("INVALID_PARAM", "error", cid, param="params"))
            continue
        if domain == "analog" and ctype in DIGITAL_TYPES:
            errors.append(message("DOMAIN_MISMATCH", "error", cid))
        params = {**library[ctype]["defaults"], **raw}
        for key in _POSITIVE.get(ctype, ()):
            v = params.get(key)
            if not _is_number(v) or v <= 0:
                errors.append(message("INVALID_PARAM", "error", cid, param=key))
        if ctype == "switch" and not isinstance(params.get("closed"), bool):
            errors.append(message("INVALID_PARAM", "error", cid, param="closed"))
        if ctype == "hc_sr04" and (not _is_number(params.get("distance_cm")) or params["distance_cm"] < 0):
            errors.append(message("INVALID_PARAM", "error", cid, param="distance_cm"))
    used = {}
    for net in nets:
        if not isinstance(net, dict) or "id" not in net or not isinstance(net.get("connections"), list):
            errors.append(message("INVALID_NETLIST", "error", key="BAD_NET"))
            continue
        for t in net["connections"]:
            cid, _, term = str(t).partition(".")
            if cid not in seen or term not in library[seen[cid]]["terminals"]:
                errors.append(message("UNKNOWN_TERMINAL", "error", terminal=t))
            elif t in used and used[t] != net["id"]:
                errors.append(message("TERMINAL_IN_TWO_NETS", "error", terminal=t))
            else:
                used[t] = net["id"]
    return errors
