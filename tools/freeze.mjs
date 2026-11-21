#!/usr/bin/env node
/** Re-freeze the golden netlists and engine results for every case.
 *  usage: node tools/freeze.mjs      (review the diff before committing)
 */
import { writeFileSync } from 'node:fs';
import { runCase, path } from '../harness/chain.mjs';

const cases = ['tp1_all_330', 'tp1_r_220', 'tp1_missing_r', 'tp1_led_reversed', 'tp1_switch_open',
  'tp1_empty', 'tp1_blip', 'tp1_wrong_slot', 'tp1_crowded', 'tp3_all'];

for (const name of cases) {
  const out = runCase(`fixtures/placements/${name}.json`);
  if (!out.result) { console.error(name, 'rejected', out.check.errors); process.exit(1); }
  writeFileSync(path(`fixtures/expected/${name}.result.json`), JSON.stringify(out.result, null, 2) + '\n');
  if (name === 'tp1_all_330' || name === 'tp3_all') {
    writeFileSync(path(`fixtures/expected/${name}.netlist.json`), JSON.stringify(out.netlist, null, 2) + '\n');
  }
  console.log(name, out.result.status, out.result.messages.map((m) => m.code).join(',') || '-');
}
