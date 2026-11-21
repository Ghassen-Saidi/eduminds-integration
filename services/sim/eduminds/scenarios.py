"""Compare what the student built with the target circuit of an exercise."""
from collections import Counter

from .netlist import INPUT_ERROR_CODES, load_json, message, status_of
from .simulate import simulate


def load_scenarios():
    return {s["id"]: s for s in load_json("scenarios.json")["scenarios"]}


SYMMETRIC_TYPES = {"resistor", "switch"}     # no polarity: flipping them changes nothing


def _net_sets(nl):
    symmetric = {c["id"] for c in nl["components"] if c["type"] in SYMMETRIC_TYPES}

    def canon(t):
        cid, _, term = t.partition(".")
        return f"{cid}.a" if cid in symmetric else t

    return {frozenset(canon(t) for t in n["connections"])
            for n in nl["nets"] if len(n["connections"]) > 1}


def evaluate(netlist, scenario_id):
    result = simulate(netlist)
    if any(m["code"] in INPUT_ERROR_CODES for m in result["messages"]):
        return result                       # bad data: nothing to compare
    sc = load_scenarios()[scenario_id]
    target = load_json(sc["target_netlist"])
    have = Counter(c["type"] for c in netlist["components"])
    want = Counter(c["type"] for c in target["components"])
    missing = sorted((want - have).elements())
    extra = sorted((have - want).elements())
    wiring_differs = not missing and not extra and _net_sets(netlist) != _net_sets(target)

    for t in missing:
        result["messages"].append(message("MISSING_COMPONENT", "warning", t))
    for t in extra:
        result["messages"].append(message("EXTRA_COMPONENT", "warning", t))
    if wiring_differs:
        result["messages"].append(message("WIRING_DIFFERS", "warning"))
    for m in result["messages"]:
        if m["code"] in sc["hints"]:
            m["hint"] = sc["hints"][m["code"]]

    goal = sc["success"]
    goal_reached = result["components"].get(goal["component"], {}).get("state") == goal["state"]
    built = not missing and not extra and not wiring_differs
    result["scenario"] = scenario_id
    result["scenario_check"] = {"built_correctly": built, "goal_reached": goal_reached,
                                "completed": built and goal_reached and result["status"] == "ok",
                                "missing": missing, "extra": extra}
    result["status"] = status_of(result["messages"])
    return result
