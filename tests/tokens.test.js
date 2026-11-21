import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTokens, tokensByMarker } from '../src/tokens.js';
import { path } from '../harness/chain.mjs';

const tokens = parseTokens(readFileSync(path('shared/components.csv'), 'utf8'));

test('the token table parses every row with its sim columns', () => {
  assert.equal(tokens.length, 10);
  const led = tokens.find((t) => t.ref === 'CMP018');
  assert.deepEqual(led.params, { color: 'red', forward_voltage: 2.0, max_current: 0.03 });
  assert.equal(led.simType, 'led');
  assert.equal(led.markerId, 4);
  assert.equal(led.polarized, true);
  assert.equal(led.priceTnd, 0.5);
});

test('French decimal commas and lab flags are read correctly', () => {
  const r330 = tokens.find((t) => t.markerId === 23);
  assert.equal(r330.priceTnd, 0.1);
  assert.deepEqual(r330.labs, []);              // not in any lab's toolbox yet
  const sw = tokens.filter((t) => t.ref === 'CMP038');
  assert.equal(sw.length, 2);                   // one token per switch state
  assert.deepEqual(sw.map((t) => t.params.closed).sort(), [false, true]);
});

test('marker ids are unique across the table', () => {
  const ids = tokens.map((t) => t.markerId);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(tokensByMarker(tokens).get(8).params.closed, true);
});
