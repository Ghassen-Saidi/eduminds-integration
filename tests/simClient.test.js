import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimClient } from '../src/simClient.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    clear: () => map.clear(),
  };
}

test('a burst of updates is sent once', async () => {
  const fetchImpl = fakeFetch();
  const client = createSimClient({ scenario: 'ex1_led_series', fetchImpl, debounceMs: 10, storage: memoryStorage() });
  for (let i = 0; i < 10; i += 1) client.update({ n: i });
  await sleep(60);
  const calls = fetchImpl.calls.filter((call) => call.url.endsWith('/v1/simulate'));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.netlist, { n: 9 });
});

test('one session is created and reused', async () => {
  const fetchImpl = fakeFetch();
  const client = createSimClient({ scenario: 'ex1_led_series', fetchImpl, debounceMs: 5, storage: memoryStorage() });
  client.update({ a: 1 });
  await sleep(40);
  client.update({ a: 2 });
  await sleep(40);
  assert.equal(fetchImpl.calls.filter((call) => call.url.endsWith('/v1/session')).length, 1);
  assert.equal(fetchImpl.calls.filter((call) => call.url.endsWith('/v1/simulate')).length, 2);
});

test('a dropped request degrades to the last good result without throwing', async () => {
  const fetchImpl = fakeFetch({ failAfter: 2 });
  const statuses = [];
  const client = createSimClient({
    scenario: 'ex1_led_series', fetchImpl, debounceMs: 5, storage: memoryStorage(),
    onStatus: (status) => statuses.push(status),
  });
  client.update({ a: 1 });
  await sleep(40);
  client.update({ a: 2 });
  await sleep(40);
  assert.equal(statuses.at(-1).online, false);
  assert.equal(statuses.at(-1).result.components.LED1.state, 'on');
  assert.equal(client.lastGood.components.LED1.state, 'on');
});

test('a stale service answer never overwrites the last good result', async () => {
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

test('continuous camera updates are coalesced and do not starve forever', async () => {
  let active = 0;
  let maxActive = 0;
  const seen = [];
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/v1/session')) {
      return { ok: true, json: async () => ({ session_id: 'bounded-session' }) };
    }
    if (url.endsWith('/v1/simulate')) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      seen.push(JSON.parse(options.body).netlist.value);
      await sleep(35);
      active -= 1;
      return { ok: true, json: async () => ({ status: 'ok', messages: [], components: {} }) };
    }
    throw new Error('unexpected URL ' + url);
  };
  const client = createSimClient({
    scenario: 'ex1_led_series', fetchImpl, debounceMs: 20, timeoutMs: 500,
    storage: memoryStorage(),
  });
  for (let value = 0; value < 10; value += 1) {
    client.update({ value });
    await sleep(5);
  }
  await sleep(180);
  assert.ok(seen.length >= 2, 'steady camera frames should produce bounded periodic requests');
  assert.equal(seen.at(-1), 9, 'the final coalesced request contains the newest netlist');
  assert.equal(maxActive, 1, 'only one simulation request should be in flight');
  client.stop();
});

test('stop aborts an active request and prevents a late result from being persisted', async () => {
  const storage = memoryStorage();
  let aborted = false;
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/v1/session')) return { ok: true, json: async () => ({ session_id: 's1' }) };
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('aborted'));
      }, { once: true });
    });
  };
  const client = createSimClient({
    scenario: 'ex1_led_series', fetchImpl, debounceMs: 5, timeoutMs: 1000,
    storage, onStatus: () => assert.fail('stopped client should not publish status'),
  });
  client.update({ a: 1 });
  await sleep(15);
  client.stop();
  await sleep(20);
  assert.equal(aborted, true);
  assert.equal(client.lastGood, null);
});


test('simulator session receives the owning database session id', async () => {
  const fetchImpl = fakeFetch();
  const client = createSimClient({
    scenario: 'ex1_led_series',
    applicationSessionId: '00000000-0000-4000-8000-000000000123',
    fetchImpl,
    debounceMs: 5,
    storage: memoryStorage(),
  });
  client.update({ a: 1 });
  await sleep(40);
  const sessionCall = fetchImpl.calls.find((call) => call.url.endsWith('/v1/session'));
  assert.equal(sessionCall.body.application_session_id, '00000000-0000-4000-8000-000000000123');
  client.stop();
});
