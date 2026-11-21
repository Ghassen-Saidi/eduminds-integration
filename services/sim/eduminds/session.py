"""Rule 2: one unreadable camera frame must not erase the last good result."""
import copy

from .netlist import INPUT_ERROR_CODES
from .scenarios import evaluate
from .simulate import simulate


class Session:
    def __init__(self, scenario_id=None):
        self.scenario_id = scenario_id
        self.last_good = None

    def update(self, netlist):
        result = evaluate(netlist, self.scenario_id) if self.scenario_id else simulate(netlist)
        bad_input = any(m["code"] in INPUT_ERROR_CODES for m in result["messages"])
        if bad_input and self.last_good is not None:
            stale = copy.deepcopy(self.last_good)
            stale["stale"] = True
            return stale
        if not bad_input:
            self.last_good = result
        return result
