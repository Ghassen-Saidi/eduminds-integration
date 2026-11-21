import test from 'node:test';
import assert from 'node:assert/strict';
import { stabilize, MAT_CORNER_IDS } from '../src/perception.js';

const f = (...ids) => ids.map((markerId) => ({ markerId, x: 0.5, y: 0.5, theta_deg: 0 }));

test('a marker seen in 3 of the last 5 frames becomes a placement', () => {
  const out = stabilize([f(1, 8), f(1), f(1, 8), f(1), f(1, 8)]);
  assert.deepEqual(out.map((p) => p.markerId).sort((a, b) => a - b), [1, 8]);
});

test('a one-frame blip never becomes a placement', () => {
  const out = stabilize([f(1), f(1), f(1, 23), f(1), f(1)]);
  assert.deepEqual(out.map((p) => p.markerId), [1]);
});

test('mat corners are never treated as components', () => {
  for (const id of MAT_CORNER_IDS) assert.ok(MAT_CORNER_IDS.has(id));
  const out = stabilize([f(100, 101, 102, 103), f(100, 101, 102, 103), f(100, 101, 102, 103)]);
  assert.deepEqual(out, []);
});

test('only the last window is considered', () => {
  const old = [f(4), f(4), f(4), f(4), f(4)];
  const fresh = [f(8), f(8), f(8), f(8), f(8)];
  const out = stabilize([...old, ...fresh]);
  assert.deepEqual(out.map((p) => p.markerId), [8]);
});

test('an empty history is empty, not a crash', () => {
  assert.deepEqual(stabilize([]), []);
  assert.deepEqual(stabilize(undefined), []);
});
