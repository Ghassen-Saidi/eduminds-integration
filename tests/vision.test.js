import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createVision, homography, project, cornerReference } from '../src/vision.js';
import { readJson } from '../harness/chain.mjs';
import { composeFrame, sharp } from './support/images.mjs';

const require = createRequire(import.meta.url);
const { AR } = require('js-aruco2');

const tp1 = readJson('shared/templates/tp1_slots.json');
const vision = createVision({ Detector: AR.Detector });
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const angleTo = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
const slotOf = (inst) => tp1.slots.find((s) => s.instance === inst);

test('homography maps the unit square onto itself', () => {
  const H = homography([[0, 0], [1, 0], [1, 1], [0, 1]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  const p = project(H, [0.3, 0.8]);
  assert.ok(near(p[0], 0.3, 1e-9) && near(p[1], 0.8, 1e-9));
});

test('corner reference points are the marker centres, inset from the paper edge', () => {
  const refs = cornerReference();
  assert.ok(near(refs[100][0], 38 / 420, 1e-6));
  assert.ok(near(refs[103][1], 1 - 38 / 297, 1e-6));
});

test('a photographed correct board yields four token sightings in mat coordinates', async () => {
  const frame = await composeFrame({
    template: tp1,
    tokens: [{ instance: 'BAT1', markerId: 1 }, { instance: 'R1', markerId: 23 }, { instance: 'LED1', markerId: 4 }, { instance: 'SW1', markerId: 8 }],
  });
  const out = vision.frameFromImage(frame);
  assert.equal(out.mat.found, true);
  const ids = out.frame.map((f) => f.markerId).sort((a, b) => a - b);
  assert.deepEqual(ids, [1, 4, 8, 23]);
  for (const sighting of out.frame) {
    const instance = { 1: 'BAT1', 4: 'LED1', 8: 'SW1', 23: 'R1' }[sighting.markerId];
    const slot = slotOf(instance);
    assert.ok(near(sighting.x, slot.x, 0.02), `${instance} x ${sighting.x} vs ${slot.x}`);
    assert.ok(near(sighting.y, slot.y, 0.02), `${instance} y ${sighting.y} vs ${slot.y}`);
    assert.ok(angleTo(sighting.theta_deg, 0) <= 8, `${instance} theta ${sighting.theta_deg}`);
  }
});

test('a token turned by 180 degrees reports the flip', async () => {
  const frame = await composeFrame({ template: tp1, tokens: [{ instance: 'LED1', markerId: 4, rotate: 180 }] });
  const out = vision.frameFromImage(frame);
  const led = out.frame.find((f) => f.markerId === 4);
  assert.ok(led, 'LED token not seen');
  assert.ok(angleTo(led.theta_deg, 180) <= 8, `theta ${led.theta_deg}`);
});

test('a missing board corner means no mat, and no frames are emitted', async () => {
  const frame = await composeFrame({ template: tp1, tokens: [{ instance: 'BAT1', markerId: 1 }], hide: [102] });
  const out = vision.frameFromImage(frame);
  assert.equal(out.mat.found, false);
  assert.equal(out.mat.missing, 102);
  assert.deepEqual(out.frame, []);
});

test('a token outside the board quad is not reported', async () => {
  const frame = await composeFrame({ template: tp1, tokens: [{ instance: 'BAT1', markerId: 1, x: 0.5, y: 0.03 }] });
  const out = vision.frameFromImage(frame);
  assert.equal(out.mat.found, true);
  assert.deepEqual(out.frame.map((f) => f.markerId), []);
});

test('board corners are never emitted as components', async () => {
  const frame = await composeFrame({ template: tp1, tokens: [] });
  const out = vision.frameFromImage(frame);
  assert.equal(out.mat.found, true);
  assert.deepEqual(out.frame, []);
});
