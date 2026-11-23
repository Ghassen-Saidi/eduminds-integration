import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTokens, tokensByMarker } from '../src/tokens.js';
import { createLabRuntime } from '../src/appBridge.js';
import { path, readJson, readCase } from '../harness/chain.mjs';

const byMarker = tokensByMarker(parseTokens(readFileSync(path('shared/components.csv'), 'utf8')));
const mapping = readJson('shared/events.map.json');
const tp1 = readJson('shared/templates/tp1_slots.json');

function runtime({ nowMs = () => 10000 } = {}) {
  const sent = [];
  const logged = [];
  const rendered = [];
  const rt = createLabRuntime({
    template: tp1, byMarker, mapping,
    client: { update: (n) => sent.push(n), stop: () => sent.push('stopped') },
    logEvent: (type, opts) => logged.push({ type, ...opts }),
    uuid: (() => { let n = 0; return () => `u${++n}`; })(),
    now: () => 'T', nowMs, onRender: (r) => rendered.push(r),
  });
  return { rt, sent, logged, rendered };
}

test('a correct board becomes a netlist and is sent', () => {
  const { rt, sent } = runtime();
  rt.start({ sessionId: 's1' });
  const netlist = rt.place(readCase('fixtures/placements/tp1_all_330.json').frames);
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
  assert.equal(rt.place(readCase('fixtures/placements/tp1_all_330.json').frames), null);
  assert.equal(sent.length, 0);
  assert.equal(rendered.at(-1).error, 'netlist_rejected');
  assert.ok(rendered.at(-1).details.some((e) => e.includes('unknown component type')));
});

test('component reference mapping preserves catalogue refs in event payloads', () => {
  const { rt } = runtime();
  rt.start({ sessionId: 's1' });
  rt.place(readCase('fixtures/placements/tp1_r_220.json').frames);
  const result = JSON.parse(readFileSync(path('fixtures/expected/tp1_r_220.result.json'), 'utf8'));
  const { rows } = rt.apply(result);
  const failure = rows.find(({ row }) => row.event_type === 'failure_caused');
  assert.equal(failure.row.payload.component_ref, 'CMP018');
  assert.equal(failure.row.payload.instance, 'LED1');
});

test('client does not submit financial failure events; it stores a diagnostic snapshot', () => {
  const { rt, logged } = runtime();
  rt.start({ sessionId: 's1' });
  rt.place(readCase('fixtures/placements/tp1_r_220.json').frames);
  const result = JSON.parse(readFileSync(path('fixtures/expected/tp1_r_220.result.json'), 'utf8'));
  rt.apply(result);
  assert.equal(logged.some((event) => event.type === 'failure_caused'), false);
  const snapshot = logged.find((event) => event.type === 'sim_result');
  assert.equal(snapshot.payload.source, 'student_client_unverified');
  assert.equal(snapshot.payload.messages[0].code, 'LED_OVERCURRENT');
});

test('failure candidates are edge-triggered and can recur after recovery', () => {
  const { rt } = runtime();
  rt.start({ sessionId: 's1' });
  const failed = {
    status: 'warning',
    messages: [{ code: 'LED_OVERCURRENT', severity: 'warning', component: 'LED1', text: 'burned' }],
    components: { LED1: { state: 'burned' } },
  };
  assert.equal(rt.apply(failed).rows.filter(({ row }) => row.event_type === 'failure_caused').length, 1);
  assert.equal(rt.apply(failed).rows.filter(({ row }) => row.event_type === 'failure_caused').length, 0);
  rt.apply({ status: 'ok', messages: [], components: { LED1: { state: 'on' } } });
  assert.equal(rt.apply(failed).rows.filter(({ row }) => row.event_type === 'failure_caused').length, 1);
});

test('stale results are rendered but never persisted', () => {
  const { rt, logged, rendered } = runtime();
  rt.start({ sessionId: 's1' });
  rt.apply({
    status: 'warning', stale: true,
    messages: [{ code: 'LED_OVERCURRENT', severity: 'warning', component: 'LED1', text: 'burned' }],
    components: { LED1: { state: 'burned' } },
  });
  assert.equal(logged.length, 0);
  assert.equal(rendered.at(-1).stale, true);
});

test('snapshot writes are throttled even when values keep changing', () => {
  let clock = 10000;
  const { rt, logged } = runtime({ nowMs: () => clock });
  rt.start({ sessionId: 's1' });
  rt.apply({ status: 'ok', messages: [], components: { LED1: { state: 'on', current_a: 0.01 } } });
  clock += 100;
  rt.apply({ status: 'ok', messages: [], components: { LED1: { state: 'on', current_a: 0.02 } } });
  assert.equal(logged.filter((event) => event.type === 'sim_result').length, 1);
  clock += 2100;
  rt.apply({ status: 'ok', messages: [], components: { LED1: { state: 'on', current_a: 0.03 } } });
  assert.equal(logged.filter((event) => event.type === 'sim_result').length, 2);
});

test('end() stops the client', async () => {
  const { rt, sent } = runtime();
  await rt.end();
  assert.equal(sent.at(-1), 'stopped');
});
