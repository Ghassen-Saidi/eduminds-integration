#!/usr/bin/env python3
"""Read a netlist from stdin, print the simulation result as JSON on stdout.

Used by the JS pipeline harness so both halves of the integration are exercised
against the real engine. Exit code 2 on invalid JSON.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from eduminds import evaluate, simulate  # noqa: E402


def main() -> int:
    scenario = None
    if len(sys.argv) > 1 and sys.argv[1] == "--scenario":
        scenario = sys.argv[2]
    try:
        netlist = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(json.dumps({"status": "error", "messages": [{"code": "INVALID_JSON", "severity": "error", "text": str(exc)}]}))
        return 2
    scenario = scenario or (netlist.get("scenario") if isinstance(netlist, dict) else None)
    result = evaluate(netlist, scenario) if scenario else simulate(netlist)
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
