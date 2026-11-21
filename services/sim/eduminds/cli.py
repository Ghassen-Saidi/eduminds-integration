"""Usage: python -m eduminds.cli data/netlist_ex1_led.json [--scenario ex1_led_series]"""
import argparse
import json

from .scenarios import evaluate
from .simulate import simulate


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("netlist")
    ap.add_argument("--scenario")
    args = ap.parse_args()
    with open(args.netlist, encoding="utf-8") as f:
        nl = json.load(f)
    res = evaluate(nl, args.scenario) if args.scenario else simulate(nl)
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
