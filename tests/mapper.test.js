import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTokens, tokensByMarker } from '../src/tokens.js';
import { mapPlacements } from '../src/mapper.js';
import { path, readJson } from '../harness/chain.mjs';

const byMarker = tokensByMarker(parseTokens(readFileSync(path('shared/components.csv'), 'utf8')));
const tp1 = readJson('shared/templates/tp1_slots.json');
const at = (slot, markerId, x, y, theta_deg = 0) => ({ markerId, x, y, theta_deg });
const SLOT = Object.fromEntries(tp1.slots.map((s) => [s.instance, s]));

test('a correct token in its slot becomes an instance with the slot name', () => {
  const { instances, rejected } = mapPlacements([
    at('BAT1', 1, 0.18, 0.34), at('R1', 23, 0.52, 0.22), at('LED1', 4, 0.52, 0.62), at('SW1', 8, 0.84, 0.62),
  ], tp1, byMarker);
  assert.deepEqual(rejected, []);
  assert.deepEqual(instances.map((i) => i.instance), ['BAT1', 'R1', 'LED1', 'SW1']);
  assert.equal(instances[1].params.resistance, 330);
  assert.equal(instances[3].params.closed, true);
});

test('a token in the wrong slot is rejected, never coerced', () => {
  const { instances, rejected } = mapPlacements([at('R1', 4, 0.52, 0.22)], tp1, byMarker);
  assert.equal(instances.length, 0);
  assert.equal(rejected[0].reason, 'wrong_component_for_slot');
  assert.equal(rejected[0].slot, 'R1');
});

test('position tolerance: 15 mm is accepted, 25 mm is not', () => {
  const near = mapPlacements([at('R1', 23, 0.52 + 15 / 297, 0.22)], tp1, byMarker);
  assert.equal(near.instances.length, 1);
  assert.ok(near.instances[0].distanceMm <= 18);
  const far = mapPlacements([at('R1', 23, 0.52 + 25 / 297, 0.22)], tp1, byMarker);
  assert.equal(far.instances.length, 0);
  assert.equal(far.rejected[0].reason, 'no_slot_in_range');
});

test('orientation decides polarity: 180 degrees flips, 15 does not', () => {
  const flipped = mapPlacements([at('LED1', 4, 0.52, 0.62, 180)], tp1, byMarker);
  assert.equal(flipped.instances[0].flipped, true);
  const straight = mapPlacements([at('LED1', 4, 0.52, 0.62, 15)], tp1, byMarker);
  assert.equal(straight.instances[0].flipped, false);
});

test('a token off the mat is rejected', () => {
  const { rejected } = mapPlacements([at('BAT1', 1, 1.4, 0.3)], tp1, byMarker);
  assert.equal(rejected[0].reason, 'off_mat');
});

test('two tokens in one slot: the closer one wins', () => {
  const { instances, rejected } = mapPlacements([
    at('R1', 23, 0.528, 0.228), at('R1', 21, 0.515, 0.215),
  ], tp1, byMarker);
  assert.equal(instances.length, 1);
  assert.equal(instances[0].ref, 'CMP003');           // the 220 ohm token, closer to the slot centre
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, 'crowded_slot');
});

test('an unknown marker id is reported, not mapped', () => {
  const { rejected } = mapPlacements([at('BAT1', 55, 0.18, 0.34)], tp1, byMarker);
  assert.equal(rejected[0].reason, 'unknown_token');
});
