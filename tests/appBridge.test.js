import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTokens, tokensByMarker } from '../src/tokens.js';
import { createLabRuntime } from '../src/appBridge.js';
import { path, readJson, readCase } from '../harness/chain.mjs';

const byMarker = tokensByMarker(parseTokens(readFileSync(path('shared/components.csv'), 'utf8')));
const mapping = readJson('shared/events.map.json');
const tp1 = readJson('shared/templates/tp1_slots.json');

function runtime({ results = [] } = {}) {
  const sent = [];
  const logged = [];
  const rendered = [];
  const rt = createLabRuntime({
    template: tp1,
    byMarker,
    mapping,
    client: { update: (n) => sent.push(n), stop: () => sent.push('stopped') },
    logEvent: (type, opts) => logged.push({ type, ...opts }),
    uuid: (() => { let n = 0; return () => `u${++n}`; })(),
    now: () => 'T',
    onRender: (r) => rendered.push(r),
  });
  return { rt, sent, logged, rendered, results };
}

test('a correct board becomes a netlist and is sent', () => {
  const { rt, sent } = runtime();
  rt.start({ sessionId: 's1' });
  const c = readCase('fixtures/placements/tp1_all_330.json');
  const netlist = rt.place(c.frames);
  assert.equal(netlist.components.length, 5);
  assert.equal(sent.at(-1).components.length, 5);
});

test('a netlist the guard rejects is never sent', () => {
  const sent = [];
  const rendered = [];
  const broken = { ...tp1, fixed: [{ id: 'X1', type: 'not_a_real_type', params: {} }] };
  const rt = createLabRuntime({
    template: broken, byMarker, mapping,
    client: { update: () => sent.push('sent'), stop: () => {} },
    logEvent: () => {}, uuid: () => 'u', onRender: (r) => rendered.push(r),
  });
  const c = readCase('fixtures/placements/tp1_all_330.json');
  assert.equal(rt.place(c.frames), null);
  assert.equal(sent.length, 0);
  assert.equal(rendered.at(-1).error, 'netlist_rejected');
  assert.ok(rendered.at(-1).details.some((e) => e.includes('unknown component type')));
});

test('a burned LED result reaches db.js as one failure_caused event', async () => {
  const { rt, logged } = runtime();
  rt.start({ sessionId: 's1' });
  rt.place(readCase('fixtures/placements/tp1_r_220.json').frames);
  const result = readCase('fixtures/placements/tp1_r_220.json').result
    ?? JSON.parse(readFileSync(path('fixtures/expected/tp1_r_220.result.json'), 'utf8'));
  const { rows } = rt.apply(result);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].type, 'failure_caused');
  assert.equal(logged[0].failureCode, 'led_overcurrent');
  assert.equal(rows[0].row.component_ref, undefined);
});

test('render state carries the lamp and the exercise check', async () => {
  const { rt, rendered } = runtime();
  rt.start({ sessionId: 's1' });
  rt.place(readCase('fixtures/placements/tp1_all_330.json').frames);
  const result = JSON.parse(readFileSync(path('fixtures/expected/tp1_all_330.result.json'), 'utf8'));
  rt.apply(result);
  const last = rendered.at(-1);
  assert.equal(last.components.LED1.state, 'on');
  assert.equal(last.scenarioCheck.completed, true);
  assert.equal(last.stale, false);
});

test('a stale result is marked, not silently shown as fresh', () => {
  const { rt, rendered } = runtime();
  rt.start({ sessionId: 's1' });
  rt.place(readCase('fixtures/placements/tp1_all_330.json').frames);
  rt.apply({ status: 'ok', messages: [], components: {}, stale: true });
  assert.equal(rendered.at(-1).stale, true);
});

test('end() stops the client', async () => {
  const { rt, sent } = runtime();
  await rt.end();
  assert.equal(sent.at(-1), 'stopped');
});
