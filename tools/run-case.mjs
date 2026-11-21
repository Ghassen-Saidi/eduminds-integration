#!/usr/bin/env node
/** usage: node tools/run-case.mjs fixtures/placements/tp1_all_330.json */
import { runCase } from '../harness/chain.mjs';

const file = process.argv[2];
if (!file) { console.error('usage: node tools/run-case.mjs <case.json>'); process.exit(1); }
const out = runCase(file);
if (!out.check.ok) {
  console.error(JSON.stringify({ error: 'netlist rejected', details: out.check.errors }, null, 2));
  process.exit(2);
}
console.log(JSON.stringify({
  case: out.caseName,
  placements: out.placements.length,
  rejected: out.mapped.rejected,
  instances: out.mapped.instances.map((i) => `${i.instance}:${i.ref}@${i.distanceMm}mm${i.flipped ? ' flipped' : ''}`),
  netlist: out.netlist,
  result: {
    status: out.result.status,
    messages: out.result.messages.map((m) => m.code),
    components: out.result.components,
    scenario_check: out.result.scenario_check,
  },
  events: out.events.map((e) => `${e.row.event_type}:${e.row.failure_code ?? e.row.payload.code}`),
}, null, 2));
