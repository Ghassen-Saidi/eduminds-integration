import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { path } from '../harness/chain.mjs';

const require = createRequire(import.meta.url);
let sharp, AR;
try {
  sharp = require('sharp');
  ({ AR } = require('js-aruco2'));
} catch {
  sharp = null;
}

const DICT = 'ARUCO_MIP_36h12';
const detector = () => new AR.Detector({ dictionaryName: DICT, maxHammingDistance: 6 });

async function decodeRegion(file, { x, y, size }) {
  const { data, info } = await sharp(path('assets/print/' + file))
    .extract({ left: x, top: y, width: size, height: size })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const markers = detector().detect({ width: info.width, height: info.height, data });
  return markers.map((m) => m.id);
}

test('the printed token sheet decodes back to its marker ids', { skip: !sharp && 'install js-aruco2 and sharp (npm ci)' }, async () => {
  const layout = JSON.parse(readFileSync(path('assets/print/tokens.layout.json'), 'utf8'));
  for (const t of layout.tokens) {
    const ids = await decodeRegion('tokens.png', t);
    assert.deepEqual(ids, [t.markerId], `token ${t.ref} (id ${t.markerId}) decoded as ${ids}`);
  }
});

test('both mats decode their four corners as 100-103', { skip: !sharp && 'install js-aruco2 and sharp (npm ci)' }, async () => {
  for (const file of ['mat-tp1.png', 'mat-tp2.png', 'mat-tp3.png']) {
    const layout = JSON.parse(readFileSync(path('assets/print/' + file.replace('.png', '.layout.json')), 'utf8'));
    const found = [];
    for (const c of layout.corners) found.push(...(await decodeRegion(file, { x: c.x, y: c.y, size: 400 })));
    assert.deepEqual(found.sort((a, b) => a - b), [100, 101, 102, 103], file);
  }
});

test('the mat never uses the part marker range 1-12 for corners', () => {
  for (const file of ['mat-tp1.layout.json', 'mat-tp2.layout.json', 'mat-tp3.layout.json']) {
    const layout = JSON.parse(readFileSync(path('assets/print/' + file), 'utf8'));
    assert.ok(layout.corners.every((c) => c.id >= 100));
  }
});

test('no token reuses a mat corner id', () => {
  const tokens = JSON.parse(readFileSync(path('assets/print/tokens.layout.json'), 'utf8')).tokens;
  assert.equal(new Set(tokens.map((t) => t.markerId)).size, tokens.length);
  assert.ok(tokens.every((t) => t.markerId < 100));
});
