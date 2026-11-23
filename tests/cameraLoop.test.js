import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createVision } from '../src/vision.js';
import { createVisionPump } from '../src/cameraLoop.js';
import { createLabRuntime } from '../src/appBridge.js';
import { parseTokens, tokensByMarker } from '../src/tokens.js';
import { readFileSync } from 'node:fs';
import { readJson, path } from '../harness/chain.mjs';
import { composeFrame } from './support/images.mjs';

const require = createRequire(import.meta.url);
const { AR } = require('js-aruco2');

const tp1 = readJson('shared/templates/tp1_slots.json');
const mapping = readJson('shared/events.map.json');
const byMarker = tokensByMarker(parseTokens(readFileSync(path('shared/components.csv'), 'utf8')));
const vision = createVision({ Detector: AR.Detector });

/** A detector stub that answers without pixels. */
function stubVision(matFound, tokenFrame = [{ markerId: 4, x: 0.62, y: 0.66, theta_deg: 0 }]) {
  const calls = { frames: 0 };
  let found = matFound;
  return {
    calls,
    setMatFound(value) { found = value; },
    frameFromImage() {
      calls.frames += 1;
      return { mat: { found }, markers: [], frame: found ? tokenFrame : [] };
    },
  };
}

test('the pump detects on every second frame and never faster than 10 Hz', () => {
  const v = stubVision(true);
  const pump = createVisionPump({ vision: v, minIntervalMs: 100, everyNFrames: 2 });
  const image = { width: 640, height: 360, data: new Uint8ClampedArray(0) };

  // 60 fps for 300 ms: frames at 0,16.7,33.3,... Only frame 1, 3, 5... are candidates,
  // and the 100 ms gate keeps that down to one detection per ~100 ms.
  let frames = 0;
  let pushed = 0;
  for (let t = 0; t < 300; t += 1000 / 60) {
    const out = pump.push(image, t);
    pushed += 1;
    if (out.detected) frames += 1;
  }
  assert.ok(frames <= 3, `detected ${frames} times in 300 ms`);
  assert.ok(frames >= 2, `detected only ${frames} times in 300 ms`);
  assert.equal(v.calls.frames, frames, 'vision ran once per detection');
  assert.equal(pump.stats.framesSeen, pushed);
});

test('a missing mat contributes an empty frame without immediately clearing history', () => {
  const v = stubVision(true);
  const sent = [];
  const pump = createVisionPump({ vision: v, onFrames: (w) => sent.push(w), minIntervalMs: 0, everyNFrames: 1 });
  pump.push({}, 0);
  v.setMatFound(false);
  const out = pump.push({}, 10);
  assert.equal(out.matFound, false);
  assert.deepEqual(out.sent.at(-1), []);
  assert.equal(sent.length, 2, 'the runtime receives each sampled detection');
  assert.equal(pump.window.length, 2);
  assert.deepEqual(pump.window.at(-1), []);
});

test('the rolling window is what the runtime receives, capped at five frames', () => {
  const v = stubVision(true);
  const sent = [];
  const pump = createVisionPump({ vision: v, onFrames: (w) => sent.push(w), minIntervalMs: 0, everyNFrames: 1, windowFrames: 5 });
  for (let i = 0; i < 7; i += 1) pump.push({}, i * 16);
  assert.equal(sent.length, 7);
  assert.equal(sent.at(-1).length, 5, 'window capped at five frames');
  assert.equal(sent[2].length, 3);
});

test('three camera frames of the real mat become a four-token netlist (no camera needed)', async () => {
  const frame = await composeFrame({
    template: tp1,
    tokens: [
      { instance: 'BAT1', markerId: 1 },
      { instance: 'R1', markerId: 23 },
      { instance: 'LED1', markerId: 4 },
      { instance: 'SW1', markerId: 8 },
    ],
  });

  const updates = [];
  const client = { update: (n) => updates.push(n), stop: () => {} };
  const runtime = createLabRuntime({
    template: tp1, byMarker, mapping, client,
    logEvent: () => {}, uuid: () => 'uuid', now: () => '2026-11-23T00:00:00.000Z',
  });

  let placed = null;
  const pump = createVisionPump({
    vision,
    minIntervalMs: 0,
    everyNFrames: 1,
    onFrames: (window) => { placed = runtime.place(window); },
  });

  // Three detections of the same board: the 3-of-5 debounce needs all three.
  for (let i = 0; i < 3; i += 1) pump.push(frame, i * 50);

  assert.ok(placed, 'runtime.place returned a netlist');
  assert.equal(placed.schema_version, '0.2');
  const ids = placed.components.map((c) => c.id).sort();
  assert.deepEqual(ids, ['BAT1', 'GND1', 'LED1', 'R1', 'SW1']);
  assert.equal(updates.length, 3, 'every detection reached the debounced client');
});


test('mat loss ages runtime history and a returning mat cannot resurrect stale placements', () => {
  const ledSlot = tp1.slots.find((slot) => slot.instance === 'LED1');
  const tokenFrame = [{ markerId: 4, x: ledSlot.x, y: ledSlot.y, theta_deg: 0 }];
  const v = stubVision(true, tokenFrame);
  const runtime = createLabRuntime({
    template: tp1, byMarker, mapping,
    client: { update: () => {}, stop: () => {} },
    logEvent: () => {}, uuid: () => 'uuid',
  });
  const pump = createVisionPump({
    vision: v, minIntervalMs: 0, everyNFrames: 1,
    onFrames: (window) => runtime.place(window),
  });
  const ids = () => runtime.lastNetlist.components.map((c) => c.id).sort();

  pump.push({}, 0);
  pump.push({}, 50);
  pump.push({}, 100);
  assert.ok(ids().includes('LED1'), 'three detections stabilise the LED');

  v.setMatFound(false);
  pump.push({}, 150);
  pump.push({}, 200);
  pump.push({}, 250);
  assert.deepEqual(ids(), ['GND1'], 'three empty detections age the LED out');

  v.setMatFound(true);
  pump.push({}, 300);
  assert.deepEqual(ids(), ['GND1'], 'one returning sighting must not replay stale frames');
  pump.push({}, 350);
  pump.push({}, 400);
  assert.ok(ids().includes('LED1'), 'three new detections stabilise the returning LED');
});

test('one frame is not enough to place a component (the debounce is real)', async () => {
  const frame = await composeFrame({ template: tp1, tokens: [{ instance: 'LED1', markerId: 4 }] });
  const updates = [];
  const runtime = createLabRuntime({
    template: tp1, byMarker, mapping,
    client: { update: (n) => updates.push(n), stop: () => {} },
    logEvent: () => {}, uuid: () => 'uuid', now: () => '2026-11-23T00:00:00.000Z',
  });
  const pump = createVisionPump({ vision, minIntervalMs: 0, everyNFrames: 1, onFrames: (w) => runtime.place(w) });
  pump.push(frame, 0);
  assert.deepEqual(runtime.lastNetlist.components.map((c) => c.id), ['GND1'], 'only the fixed ground is on the board');
});

test('reset empties the window so a new lab does not inherit the old board', () => {
  const v = stubVision(true);
  const pump = createVisionPump({ vision: v, minIntervalMs: 0, everyNFrames: 1 });
  pump.push({}, 0);
  pump.push({}, 10);
  assert.equal(pump.window.length, 2);
  pump.reset();
  assert.deepEqual(pump.window, []);
});
