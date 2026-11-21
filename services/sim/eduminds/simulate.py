"""Netlist dict -> simulation_result dict. Stages: input rules, topology rules, solve, result rules."""
import math

from . import mna
from .digital import simulate_digital
from .netlist import (SCHEMA_VERSION, load_component_library, message, resolved_params,
                      status_of, validate_input)

SWITCH_ON_RESISTANCE = 1e-3     # closed switch = 1 milliohm
DIODE_ON_RESISTANCE = 1.0       # simple model: vf in series with 1 ohm
MAX_SOURCE_A = 1.0              # battery current above this = short circuit
LED_VISIBLE_A = 0.0005
LED_FULL_BRIGHT_A = 0.020
REVERSE_WARN_V = 1.0
BUZZER_OVERVOLTAGE_FACTOR = 1.25


class _UnionFind:
    def __init__(self):
        self.parent = {}

    def find(self, x):
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[rb] = ra

    def copy(self):
        u = _UnionFind()
        u.parent = dict(self.parent)
        return u


def simulate(netlist, library=None):
    library = library or load_component_library()
    scenario = netlist.get("scenario") if isinstance(netlist, dict) else None
    result = {"schema_version": SCHEMA_VERSION, "scenario": scenario, "status": "ok",
              "messages": [], "nodes": {}, "components": {}}
    errors = validate_input(netlist, library)
    if errors:
        result["messages"] = errors
        result["status"] = "error"
        return result
    try:
        if netlist.get("domain", "analog") == "digital":
            result = simulate_digital(netlist, library, result)
        else:
            result = _simulate_analog(netlist, library, result)
    except Exception as exc:       # safety net: the simulator must never crash the app
        result["messages"].append(message("NUMERIC_ERROR", "error"))
        result["components"] = {}
        result["debug"] = repr(exc)
    result["status"] = status_of(result["messages"])
    return _round(result)


def _round(obj):
    if isinstance(obj, float):
        return round(obj, 9)
    if isinstance(obj, dict):
        return {k: _round(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_round(v) for v in obj]
    return obj


def _idle(comps, result, battery_state="off"):
    for cid, c in comps.items():
        if c["type"] == "switch":
            result["components"][cid] = {"state": "closed" if c["params"]["closed"] else "open"}
        elif c["type"] == "battery":
            result["components"][cid] = {"state": battery_state}
        else:
            result["components"][cid] = {"state": "off"}


def _simulate_analog(netlist, library, result):
    messages = result["messages"]
    comps = {c["id"]: {"type": c["type"], "params": resolved_params(c, library)}
             for c in netlist["components"]}

    # --- map every terminal to a node name (a net id, or a private name if unconnected)
    uf = _UnionFind()
    term_node = {}
    for net in netlist["nets"]:
        uf.find(net["id"])
        for t in net["connections"]:
            term_node[t] = net["id"]
    dangling = []
    for cid, c in comps.items():
        for term in library[c["type"]]["terminals"]:
            key = f"{cid}.{term}"
            if key not in term_node:
                term_node[key] = "~" + key
                uf.find(term_node[key])
                dangling.append(key)
    for key in dangling:                                   # Rule 5
        messages.append(message("DANGLING_TERMINAL", "info", key.split(".")[0], terminal=key))

    # --- Rule 3: a power source is required
    batteries = [cid for cid, c in comps.items() if c["type"] == "battery"]
    if not batteries:
        messages.append(message("NO_SOURCE", "warning"))
        _idle(comps, result)
        return result

    # --- Rule 4: need a 0 V reference
    g_terms = [f"{cid}.gnd" for cid, c in comps.items()
               if c["type"] == "ground" and f"{cid}.gnd" not in dangling]
    if g_terms:
        for t in g_terms[1:]:
            uf.union(term_node[g_terms[0]], term_node[t])
        ref = uf.find(term_node[g_terms[0]])
    else:
        ref = uf.find(term_node[f"{batteries[0]}.neg"])
        messages.append(message("NO_GROUND_TOKEN", "info"))

    # --- Rule 7: short circuit = zero-resistance path across a battery
    zero_r = uf.copy()
    for cid, c in comps.items():
        if c["type"] == "switch" and c["params"]["closed"]:
            zero_r.union(term_node[f"{cid}.a"], term_node[f"{cid}.b"])
    for b in batteries:
        if zero_r.find(term_node[f"{b}.pos"]) == zero_r.find(term_node[f"{b}.neg"]):
            messages.append(message("SHORT_CIRCUIT", "error", b))
            _idle(comps, result)
            result["components"][b]["state"] = "short_circuit"
            return result

    # --- number the nodes (ground = None)
    index = {}

    def idx(term):
        root = uf.find(term_node[term])
        return None if root == ref else index.setdefault(root, len(index))

    for cid, c in comps.items():
        for term in library[c["type"]]["terminals"]:
            idx(f"{cid}.{term}")

    # --- stamp components
    conductances, vsources, vs_owner, diodes, d_owner = [], [], [], [], []
    for cid, c in comps.items():
        t, p = c["type"], c["params"]
        terms = library[t]["terminals"]
        if t == "ground":
            continue
        n1, n2 = idx(f"{cid}.{terms[0]}"), idx(f"{cid}.{terms[1]}")
        if t == "resistor":
            conductances.append((n1, n2, 1.0 / p["resistance"]))
        elif t == "buzzer":
            conductances.append((n1, n2, 1.0 / p["equivalent_resistance"]))
        elif t == "switch" and p["closed"]:
            conductances.append((n1, n2, 1.0 / SWITCH_ON_RESISTANCE))
        elif t == "battery":
            vsources.append((n1, n2, p["voltage"]))
            vs_owner.append(cid)
        elif t in ("led", "diode"):
            diodes.append((n1, n2, p["forward_voltage"], DIODE_ON_RESISTANCE))
            d_owner.append(cid)

    try:
        sol = mna.solve_dc(len(index), conductances, vsources, diodes)
    except mna.SolverError:
        messages.append(message("UNSOLVABLE", "error"))
        _idle(comps, result)
        return result

    def v(term):
        i = idx(term)
        return 0.0 if i is None else sol.node_v[i]

    # --- Stage 4: per-component results and result rules
    out = result["components"]
    led_over = False
    for cid, c in comps.items():
        t, p = c["type"], c["params"]
        terms = library[t]["terminals"]
        if t == "ground":
            out[cid] = {"state": "ok"}
            continue
        vd = v(f"{cid}.{terms[0]}") - v(f"{cid}.{terms[1]}")
        entry = {"voltage_v": vd}
        if t == "resistor":
            i = vd / p["resistance"]
            power = i * i * p["resistance"]
            entry.update(current_a=i, power_w=power, state="ok")
            if power > p["power_rating_w"]:
                entry["state"] = "overheating"
                messages.append(message("RESISTOR_OVERHEAT", "warning", cid, power=power, rating=p["power_rating_w"]))
        elif t == "switch":
            closed = p["closed"]
            entry.update(current_a=vd / SWITCH_ON_RESISTANCE if closed else 0.0,
                         state="closed" if closed else "open")
        elif t == "battery":
            i = -sol.vsrc_i[vs_owner.index(cid)]
            entry.update(current_a=i, state="ok")
        elif t == "buzzer":
            i = vd / p["equivalent_resistance"]
            entry.update(current_a=i, state="silent")
            if vd >= p["min_voltage"]:
                entry["state"] = "sounding"
                if vd > p["rated_voltage"] * BUZZER_OVERVOLTAGE_FACTOR:
                    messages.append(message("BUZZER_OVERVOLTAGE", "warning", cid, voltage=vd, rated=p["rated_voltage"]))
            elif vd <= -p["min_voltage"]:
                messages.append(message("BUZZER_REVERSED", "warning", cid))
        elif t in ("led", "diode"):
            i = sol.diode_i[d_owner.index(cid)]
            entry["current_a"] = i
            if t == "led":
                if i > p["max_current"]:                         # Rule 8
                    led_over = True
                    entry.update(state="burned", brightness=0.0)
                    messages.append(message("LED_OVERCURRENT", "warning", cid, current_ma=i * 1000))
                elif i >= LED_VISIBLE_A:
                    entry.update(state="on", brightness=min(1.0, i / LED_FULL_BRIGHT_A))
                else:
                    entry.update(state="off", brightness=0.0)
                    if vd < -REVERSE_WARN_V:                     # Rule 9
                        messages.append(message("LED_REVERSED", "warning", cid))
            else:                                                # Rule 10
                if i > p["max_current"]:
                    entry["state"] = "overloaded"
                elif i > 0:
                    entry["state"] = "conducting"
                else:
                    entry["state"] = "reverse_blocking" if vd < -0.1 else "off"
        out[cid] = entry

    # --- Rule 7 (backup): huge source current = something shorts the battery
    if not led_over:
        for b in batteries:
            if abs(out[b]["current_a"]) > MAX_SOURCE_A:
                messages.append(message("SHORT_CIRCUIT", "error", b, key="SHORT_CIRCUIT_CURRENT",
                                        current=out[b]["current_a"]))
                out[b]["state"] = "overloaded"
                break

    result["nodes"] = {net["id"]: v(net["connections"][0]) if net["connections"] else 0.0
                       for net in netlist["nets"]}

    # --- Rule 13: never pass NaN / infinity on
    for entry in out.values():
        if any(isinstance(x, float) and not math.isfinite(x) for x in entry.values()):
            messages.append(message("NUMERIC_ERROR", "error"))
            result["components"], result["nodes"] = {}, {}
            break
    return result
