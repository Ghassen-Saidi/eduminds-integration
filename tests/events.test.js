import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mapResult, parseEventMap } from '../src/events.js';
import { path, readJson } from '../harness/chain.mjs';

const mapping = parseEventMap(readFileSync(path('shared/events.map.json'), 'utf8'));
const uuid = (() => { let n = 0; return () => `id-${++n}`; })();

const res = (messages, components = {}) => ({ status: 'warning', messages, components });

test('every message code the engine can emit has a mapping', () => {
  const dump = execFileSync('python3', ['-c', `
import json, sys
sys.path.insert(0, 'services/sim')
from eduminds.netlist import TEXTS
print(json.dumps(sorted(TEXTS)))
`], { cwd: path('.'), encoding: 'utf8' });
  const ALIASES = new Set(['NOT_OBJECT', 'BAD_NET', 'UNKNOWN_TYPE']);   // text keys, not message codes
  const codes = JSON.parse(dump).filter((c) => !ALIASES.has(c));
  const missing = codes.filter((c) => !(c in mapping));
  assert.deepEqual(missing, [], 'unmapped engine codes: ' + missing.join(', '));
});

test('a burned LED becomes exactly one failure row with the DB failure code', () => {
  const rows = mapResult(res([{ code: 'LED_OVERCURRENT', severity: 'warning', component: 'LED1', text: 'x' }]), {
    sessionId: 's1', refByInstance: { LED1: 'CMP018' }, mapping, uuid, now: () => 'T',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].row.event_type, 'failure_caused');
  assert.equal(rows[0].row.failure_code, 'led_overcurrent');
  assert.equal(rows[0].row.component_ref, undefined, 'failure rows must not carry component_ref (DB constraint)');
  assert.equal(rows[0].row.payload.component_ref, 'CMP018');
});

test('hints never claim money', () => {
  const rows = mapResult(res([{ code: 'LED_REVERSED', severity: 'warning', component: 'LED1', text: 'flip it' }]), {
    sessionId: 's1', refByInstance: { LED1: 'CMP018' }, mapping, uuid, now: () => 'T',
  });
  assert.equal(rows[0].row.event_type, 'hint_used');
  assert.equal(rows[0].row.failure_code, undefined);
});

test('engine-level errors are shown, not logged', () => {
  const rows = mapResult(res([
    { code: 'UNSOLVABLE', severity: 'error', text: 'no solution' },
    { code: 'NUMERIC_ERROR', severity: 'error', text: 'nan' },
  ]), { sessionId: 's1', refByInstance: {}, mapping, uuid, now: () => 'T' });
  assert.deepEqual(rows, []);
});

test('a repeated code for the same component is logged once per result', () => {
  const rows = mapResult(res([
    { code: 'MISSING_COMPONENT', severity: 'warning', component: 'resistor', text: 'a' },
    { code: 'MISSING_COMPONENT', severity: 'warning', component: 'resistor', text: 'b' },
  ]), { sessionId: 's1', refByInstance: {}, mapping, uuid, now: () => 'T' });
  assert.equal(rows.length, 1);
});

test('the money view can only ever receive the three known codes', () => {
  const money = Object.entries(mapping).filter(([, v]) => v.event === 'failure_caused').map(([, v]) => v.failure_code);
  assert.deepEqual([...new Set(money)].sort(), ['led_overcurrent', 'sensor_overvoltage', 'short_circuit']);
});
