import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createVision } from '../src/vision.js';
import { runEngine, path, readJson } from '../harness/chain.mjs';
import { parseTokens, tokensByMarker } from '../src/tokens.js';
import { createLabRuntime } from '../src/appBridge.js';
import { composeFrame } from './support/images.mjs';

const require = createRequire(import.meta.url);
const { AR } = require('js-aruco2');

const tp1 = readJson('shared/templates/tp1_slots.json');
const mapping = readJson('shared/events.map.json');
const byMarker = tokensByMarker(parseTokens(readFileSync(path('shared/components.csv'), 'utf8')));
const vision = createVision({ Detector: AR.Detector });

const BOARD = [
  { instance: 'BAT1', markerId: 1 },
  { instance: 'R1', markerId: 23 },
  { instance: 'LED1', markerId: 4 },
  { instance: 'SW1', markerId: 8 },
];

/** Five identical frames, as the debounce expects from a steady camera. */
async function frames(tokens) {
  const image = await composeFrame({ template: tp1, tokens });
  const sighting = vision.frameFromImage(image).frame;
  return Array.from({ length: 5 }, () => sighting);
}

test('a photographed 330 ohm board lights the LED through the real engine', async () => {
  const runtime = createLabRuntime({
    template: tp1, byMarker, mapping,
    client: { update: () => {}, stop: () => {} },
    logEvent: () => {}, uuid: () => 'u',
  });
  const netlist = runtime.place(await frames(BOARD));
  assert.equal(netlist.components.length, 5);
  const result = runEngine(netlist);
  assert.equal(result.status, 'ok');
  assert.equal(result.components.LED1.state, 'on');
  assert.equal(result.scenario_check.completed, true);
});

test('a photographed 220 ohm board burns the LED and logs one failure', async () => {
  const tokens = BOARD.map((t) => (t.instance === 'R1' ? { ...t, markerId: 21 } : t));
  const logged = [];
  const runtime = createLabRuntime({
    template: tp1, byMarker, mapping,
    client: { update: () => {}, stop: () => {} },
    logEvent: (type, opts) => logged.push({ type, ...opts }),
    uuid: (() => { let n = 0; return () => `u${++n}`; })(),
  });
  runtime.start({ sessionId: 's1' });
  const netlist = runtime.place(await frames(tokens));
  const result = runEngine(netlist);
  runtime.apply(result);
  assert.equal(result.components.LED1.state, 'burned');
  assert.equal(logged.length, 1);
  assert.equal(logged[0].type, 'failure_caused');
  assert.equal(logged[0].failureCode, 'led_overcurrent');
});

test('a photographed reversed LED is reported as reversed, not burned', async () => {
  const tokens = BOARD.map((t) => (t.instance === 'LED1' ? { ...t, rotate: 180 } : t));
  const runtime = createLabRuntime({
    template: tp1, byMarker, mapping,
    client: { update: () => {}, stop: () => {} },
    logEvent: () => {}, uuid: () => 'u',
  });
  const netlist = runtime.place(await frames(tokens));
  const led = netlist.components.find((c) => c.id === 'LED1');
  assert.ok(led, 'LED missing from the netlist');
  const result = runEngine(netlist);
  assert.equal(result.components.LED1.state, 'off');
  assert.ok(result.messages.some((m) => m.code === 'LED_REVERSED'));
});

test('a board photographed earlier in the frame still maps to the same slots', async () => {
  const shifted = BOARD;
  const image = await composeFrame({ template: tp1, tokens: shifted, shift: [40, 25] });
  const sighting = vision.frameFromImage(image).frame;
  const runtime = createLabRuntime({
    template: tp1, byMarker, mapping,
    client: { update: () => {}, stop: () => {} },
    logEvent: () => {}, uuid: () => 'u',
  });
  const netlist = runtime.place(Array.from({ length: 5 }, () => sighting));
  assert.equal(netlist.components.length, 5);
});
