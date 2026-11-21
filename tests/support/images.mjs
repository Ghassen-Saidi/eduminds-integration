/** Compose synthetic camera frames: the printed mat + tokens at slot positions.
 *  Real detector, real PNGs, no camera — the composition is the fixture.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { path } from '../../harness/chain.mjs';

const require = createRequire(import.meta.url);
export const sharp = require('sharp');

export const layouts = {
  tokens: JSON.parse(readFileSync(path('assets/print/tokens.layout.json'), 'utf8')),
  mat: JSON.parse(readFileSync(path('assets/print/mat-tp1.layout.json'), 'utf8')),
};

/** Crop one token from the printed sheet as a PNG buffer. */
export async function tokenPng(markerId, rotate = 0) {
  const t = layouts.tokens.tokens.find((x) => x.markerId === markerId);
  if (!t) throw new Error(`no token ${markerId}`);
  let img = sharp(path('assets/print/tokens.png')).extract({ left: t.x, top: t.y, width: t.size, height: t.size });
  let png = await img.png().toBuffer();
  if (rotate) png = await sharp(png).rotate(rotate, { background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
  return png;
}

/** Build a frame: the mat with tokens placed at template slots (or raw positions). */
export async function composeFrame({ template, tokens = [], hide = [], shift = [0, 0] }) {
  const base = sharp(path('assets/print/mat-tp1.png'));
  const overlays = [];
  for (const t of tokens) {
    const slot = template.slots.find((s) => s.instance === t.instance) ?? t;
    const png = await tokenPng(t.markerId, t.rotate ?? 0);
    const meta = await sharp(png).metadata();
    const size = layouts.tokens.tokens[0].size;
    let left = Math.round((t.x ?? slot.x) * layouts.mat.w - size / 2) + shift[0];
    let top = Math.round((t.y ?? slot.y) * layouts.mat.h - size / 2) + shift[1];
    if (meta.width !== size) { left += Math.round((size - meta.width) / 2); top += Math.round((size - meta.height) / 2); }
    overlays.push({ input: png, left, top });
  }
  let img = base;
  if (hide.length) {
    const patches = hide.map((id) => {
      const c = layouts.mat.corners.find((x) => x.id === id);
      return { input: { create: { width: 400, height: 400, channels: 3, background: '#ffffff' } }, left: c.x, top: c.y };
    });
    overlays.push(...patches);
  }
  img = img.composite(overlays);
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}
