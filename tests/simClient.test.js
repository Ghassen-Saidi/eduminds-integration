import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimClient } from '../src/simClient.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeFetch({ failAfter = Infinity } = {}) {
  const calls = [];
  let session = 0;
  const fn = async (url, opts) => {
    calls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
    if (calls.length > failAfter) throw new Error('network down');
    if (url.endsWith('/v1/session')) {
      session += 1;
      return { ok: true, json: async () => ({ session_id: `s${session}` }) };
    }
    return { ok: true, json: async () => ({ status: 'ok', components: { LED1: { state: 'on' } }, messages: [] }) };
  };
  fn.calls = calls;
  return fn;
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    clear: () => map.clear(),
  };
}

test('a burst of updates is sent once', async () => {
  const fetchImpl = fakeFetch();
  const client = createSimClient({ scenario: 'ex1_led_series', fetchImpl, debounceMs: 10, storage: memoryStorage() });
  for (let i = 0; i < 10; i += 1) client.update({ n: i });
  await sleep(60);
  const simCalls = fetchImpl.calls.filter((c) => c.url.endsWith('/v1/simulate'));
  assert.equal(simCalls.length, 1);
  assert.deepEqual(simCalls[0].body.netlist, { n: 9 });
});

test('one session is created and reused', async () => {
  const fetchImpl = fakeFetch();
  const client = createSimClient({ scenario: 'ex1_led_series', fetchImpl, debounceMs: 5, storage: memoryStorage() });
  await client.update({ a: 1 }), await sleep(40);
  await client.update({ a: 2 }), await sleep(40);
  const sessionCalls = fetchImpl.calls.filter((c) => c.url.endsWith('/v1/session'));
  assert.equal(sessionCalls.length, 1);
  assert.equal(fetchImpl.calls.filter((c) => c.url.endsWith('/v1/simulate')).length, 2);
});

test('a dropped request degrades to the last good result, without throwing', async () => {
  const fetchImpl = fakeFetch({ failAfter: 2 });   // session + one simulate succeed
  const statuses = [];
  const client = createSimClient({
    scenario: 'ex1_led_series', fetchImpl, debounceMs: 5, storage: memoryStorage(),
    onStatus: (s) => statuses.push(s),
  });
  client.update({ a: 1 });
  await sleep(40);
  client.update({ a: 2 });
  await sleep(40);
  const last = statuses.at(-1);
  assert.equal(last.online, false);
  assert.equal(last.result.components.LED1.state, 'on');
  assert.equal(client.lastGood.components.LED1.state, 'on');
});

test('a stale answer from the service does not overwrite the last good result', async () => {
  const storage = memoryStorage();
  let call = 0;
  const fetchImpl = async (url) => {
    call += 1;
    if (url.endsWith('/v1/session')) return { ok: true, json: async () => ({ session_id: 's1' }) };
    const payload = call === 2
      ? { status: 'ok', messages: [], components: { LED1: { state: 'on' } } }
      : { status: 'ok', messages: [], components: {}, stale: true };
    return { ok: true, json: async () => payload };
  };
  const client = createSimClient({ scenario: 'ex1_led_series', fetchImpl, debounceMs: 5, storage });
  client.update({ a: 1 });
  await sleep(40);
  client.update({ a: 2 });
  await sleep(40);
  assert.equal(client.lastGood.components.LED1.state, 'on');
  assert.ok(JSON.parse(storage.getItem('edu_sim_last_ex1_led_series')).components.LED1);
});

test('the last good result survives a page reload', () => {
  const storage = memoryStorage();
  storage.setItem('edu_sim_last_ex1_led_series', JSON.stringify({ components: { LED1: { state: 'on' } } }));
  const client = createSimClient({ scenario: 'ex1_led_series', fetchImpl: fakeFetch(), storage });
  assert.equal(client.lastGood.components.LED1.state, 'on');
});

test('stop() prevents any further send', async () => {
  const fetchImpl = fakeFetch();
  const client = createSimClient({ scenario: 'ex1_led_series', fetchImpl, debounceMs: 10, storage: memoryStorage() });
  client.update({ a: 1 });
  client.stop();
  await sleep(50);
  assert.equal(fetchImpl.calls.length, 0);
});
