/** The full integration chain, reusable by tests and by tools/run-case.mjs.
 *  placements -> mapper -> netlist -> python engine -> events
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseTokens, tokensByMarker } from '../src/tokens.js';
import { stabilize } from '../src/perception.js';
import { mapPlacements } from '../src/mapper.js';
import { buildNetlist, instanceRefs } from '../src/netlist.js';
import { checkNetlist } from '../src/validate.js';
import { mapResult } from '../src/events.js';

export const ROOT = new URL('../', import.meta.url);
export const path = (p) => new URL(p, ROOT).pathname;
export const readJson = (p) => JSON.parse(readFileSync(path(p), 'utf8'));

const byMarker = tokensByMarker(parseTokens(readFileSync(path('shared/components.csv'), 'utf8')));
export const mapping = readJson('shared/events.map.json');

export function readCase(file) {
  const c = readJson(file);
  return { ...c, template: readJson('shared/templates/' + c.template) };
}

export function buildChain(c) {
  const placements = stabilize(c.frames);
  const mapped = mapPlacements(placements, c.template, byMarker);
  const netlist = buildNetlist(c.template, mapped.instances);
  return { placements, mapped, netlist, check: checkNetlist(netlist) };
}

export function runEngine(netlist) {
  const r = spawnSync('python3', [path('services/sim/run_sim.py')], { input: JSON.stringify(netlist), encoding: 'utf8' });
  if (r.status !== 0) throw new Error('engine failed: ' + (r.stderr || r.stdout));
  return JSON.parse(r.stdout);
}

export function runCase(file) {
  const c = readCase(file);
  const built = buildChain(c);
  if (!built.check.ok) return { ...built, caseName: c.name, result: null, events: [] };
  const result = runEngine(built.netlist);
  let n = 0;
  const events = mapResult(result, {
    sessionId: 'session-fixture',
    refByInstance: instanceRefs(built.mapped.instances),
    mapping,
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    now: () => '2026-11-21T00:00:00.000Z',
  });
  return { ...built, caseName: c.name, result, events };
}
