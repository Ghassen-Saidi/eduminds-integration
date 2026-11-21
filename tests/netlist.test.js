import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTokens, tokensByMarker } from '../src/tokens.js';
import { buildNetlist } from '../src/netlist.js';
import { checkNetlist } from '../src/validate.js';
import { path, readJson } from '../harness/chain.mjs';

const byMarker = tokensByMarker(parseTokens(readFileSync(path('shared/components.csv'), 'utf8')));
const tp1 = readJson('shared/templates/tp1_slots.json');
const tp3 = readJson('shared/templates/tp3_slots.json');

const instance = (slotName, markerId, flipped = false) => {
  const t = byMarker.get(markerId);
  return { instance: slotName, ref: t.ref, markerId, type: t.simType, params: t.params, flipped };
};

test('the full TP1 build matches the frozen golden netlist', () => {
  const built = buildNetlist(tp1, [
    instance('BAT1', 1), instance('R1', 23), instance('LED1', 4), instance('SW1', 8),
  ]);
  const golden = readJson('fixtures/expected/tp1_all_330.netlist.json');
  assert.deepEqual(built, golden);
});

test('the TP3 build matches its golden netlist', () => {
  const built = buildNetlist(tp3, [
    instance('BAT1', 2), instance('D1', 5), instance('BUZZER1', 6), instance('SW1', 8),
  ]);
  assert.deepEqual(built, readJson('fixtures/expected/tp3_all.netlist.json'));
});

test('an empty slot loses its component and every terminal reference to it', () => {
  const built = buildNetlist(tp1, [instance('BAT1', 1), instance('LED1', 4), instance('SW1', 8)]);
  const text = JSON.stringify(built);
  assert.ok(!text.includes('"R1"'), 'R1 must not appear as a component');
  assert.ok(!text.includes('R1.'), 'no net may still reference R1 terminals');
  assert.equal(built.components.filter((c) => c.type === 'resistor').length, 0);
  assert.equal(checkNetlist(built).ok, true);
});

test('the fixed ground part is always present', () => {
  const built = buildNetlist(tp1, []);
  assert.deepEqual(built.components, [{ id: 'GND1', type: 'ground', params: {} }]);
  assert.deepEqual(built.nets, []);
});

test('a flipped polarized part swaps its terminals in the nets', () => {
  const built = buildNetlist(tp1, [
    instance('BAT1', 1), instance('R1', 23), instance('LED1', 4, true), instance('SW1', 8),
  ]);
  const gnd = built.nets.find((n) => n.id === 'GND');
  assert.ok(gnd.connections.includes('LED1.anode'));
  assert.ok(!gnd.connections.includes('LED1.cathode'));
  const n2 = built.nets.find((n) => n.id === 'N2');
  assert.ok(n2.connections.includes('LED1.cathode'));
});

test('every subset of filled slots produces a netlist the service will accept', () => {
  const optional = [['R1', 23], ['LED1', 4], ['SW1', 8]];
  const total = 1 << optional.length;
  for (let mask = 0; mask < total; mask += 1) {
    const chosen = optional.filter((_, i) => mask & (1 << i));
    const instances = [instance('BAT1', 1), ...chosen.map(([s, m]) => instance(s, m))];
    const built = buildNetlist(tp1, instances);
    const check = checkNetlist(built);
    assert.deepEqual(check.errors, [], `subset ${chosen.map((c) => c[0]).join(',') || '(none)'} rejected`);
    // the simulator's own input rules reject an unknown terminal; this guard is the client side of it
    if (!chosen.some(([slot]) => slot === 'R1')) assert.ok(!JSON.stringify(built).includes('R1.'));
  }
});

test('two-nets-for-one-terminal is caught by the guard', () => {
  const bad = {
    schema_version: '0.2',
    components: [{ id: 'A', type: 'battery', params: {} }],
    nets: [{ id: 'N1', connections: ['A.pos'] }, { id: 'N2', connections: ['A.pos'] }],
  };
  const check = checkNetlist(bad);
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => e.includes('two nets')));
});
