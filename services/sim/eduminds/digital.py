"""Exercise 3: Arduino + HC-SR04 + LCD, simulated as logic (not MNA).

The program is modelled directly: read distance, show it on the LCD.
Pin mapping is a PROPOSAL (the PDF's pins are not readable): see components in data/.
"""
from .netlist import message, resolved_params

SENSOR_PINS = [("TRIG", "D9"), ("ECHO", "D10")]
LCD_PINS = [("RS", "D12"), ("E", "D11"), ("D4", "D5"), ("D5", "D4"), ("D6", "D3"), ("D7", "D2")]
MIN_CM, MAX_CM = 2, 400


def simulate_digital(netlist, library, result):
    messages = result["messages"]
    comps = {c["id"]: {"type": c["type"], "params": resolved_params(c, library)}
             for c in netlist["components"]}
    first = {}
    for cid, c in comps.items():
        first.setdefault(c["type"], cid)
    net_of = {t: net["id"] for net in netlist["nets"] for t in net["connections"]}

    def linked(a, b):
        return a in net_of and b in net_of and net_of[a] == net_of[b]

    missing = [t for t in ("arduino_uno", "hc_sr04", "lcd_16x2") if t not in first]
    if missing:
        messages.append(message("MISSING_PART", "warning", missing=", ".join(missing)))
        for cid in comps:
            result["components"][cid] = {"state": "off"}
        return result

    uno, us, lcd = first["arduino_uno"], first["hc_sr04"], first["lcd_16x2"]
    sensor_power = linked(f"{us}.VCC", f"{uno}.5V") and linked(f"{us}.GND", f"{uno}.GND")
    lcd_power = linked(f"{lcd}.VDD", f"{uno}.5V") and linked(f"{lcd}.VSS", f"{uno}.GND")
    lcd_rw_v0 = linked(f"{lcd}.RW", f"{uno}.GND") and linked(f"{lcd}.V0", f"{uno}.GND")
    lcd_pins = all(linked(f"{lcd}.{a}", f"{uno}.{b}") for a, b in LCD_PINS)
    sensor_pins = all(linked(f"{us}.{a}", f"{uno}.{b}") for a, b in SENSOR_PINS)

    if not sensor_power:
        messages.append(message("SENSOR_NO_POWER", "error", us))
    if not lcd_power:
        messages.append(message("LCD_NO_POWER", "error", lcd))
    if not sensor_pins:
        messages.append(message("WIRING_TRIG_ECHO", "warning", us))
    if lcd_power and not lcd_pins:
        messages.append(message("WIRING_LCD", "warning", lcd))
    if lcd_power and not lcd_rw_v0:
        messages.append(message("WIRING_LCD_RW_V0", "warning", lcd))

    # backlight: A -> resistor -> 5V, K -> GND
    backlight = "off"
    if lcd_power and linked(f"{lcd}.K", f"{uno}.GND"):
        if linked(f"{lcd}.A", f"{uno}.5V"):
            backlight = "unprotected"
            messages.append(message("BACKLIGHT_NO_RESISTOR", "warning", lcd))
        else:
            for rid, r in comps.items():
                if r["type"] == "resistor" and (
                        (linked(f"{rid}.a", f"{lcd}.A") and linked(f"{rid}.b", f"{uno}.5V")) or
                        (linked(f"{rid}.b", f"{lcd}.A") and linked(f"{rid}.a", f"{uno}.5V"))):
                    backlight = "on"

    distance = comps[us]["params"]["distance_cm"]
    blank = [" " * 16, " " * 16]
    if not lcd_power:
        lcd_state, lines = "off", blank
    elif not (lcd_pins and lcd_rw_v0):
        lcd_state, lines = "no_text", blank
    elif not (sensor_power and sensor_pins):
        lcd_state = "waiting"
        lines = ["Distance: --- cm", "Distance: --- in"]
    elif not (MIN_CM <= distance <= MAX_CM):
        lcd_state, lines = "waiting", ["Out of range".ljust(16), blank[1]]
    else:
        cm, inch = round(distance), round(distance / 2.54)
        lcd_state = "showing_distance"
        lines = [f"Distance: {cm:>3} cm", f"Distance: {inch:>3} in"]
    lines = [l[:16].ljust(16) for l in lines]

    for cid, c in comps.items():
        result["components"][cid] = {"state": "off"}
    result["components"][uno] = {"state": "running" if (sensor_power or lcd_power) else "off"}
    result["components"][us] = {"state": "measuring" if sensor_power else "off", "distance_cm": distance}
    result["components"][lcd] = {"state": lcd_state, "lines": lines, "backlight": backlight}
    return result
