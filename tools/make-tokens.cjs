#!/usr/bin/env node
/** Render the printable token sheet and the two TP mats.
 *  usage: node tools/make-tokens.cjs   (needs js-aruco2 + sharp)
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { AR } = require('js-aruco2');
const { mm, TOKEN_MM, TOKEN_PX, SHEET } = require('./print-layout.cjs');

const ROOT = path.resolve(__dirname, '..');
const DICT = 'ARUCO_MIP_36h12';
const dict = new AR.Dictionary(DICT);
const inner = (svg) => svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
const VB = dict.markSize - 2 + 4;

function markerGroup(id, x, y, size) {
  return `<g shape-rendering="crispEdges" transform="translate(${x} ${y}) scale(${size / VB})">${inner(dict.generateSVG(id))}</g>`;
}

function readTokens() {
  const csv = fs.readFileSync(path.join(ROOT, 'shared/components.csv'), 'utf8').replace(/^\uFEFF/, '').trim();
  const [head, ...lines] = csv.split(/\r?\n/);
  const keys = head.split(';');
  return lines.filter(Boolean).map((line) => {
    const v = line.split(';');
    const row = Object.fromEntries(keys.map((k, i) => [k, (v[i] || '').trim()]));
    return {
      markerId: Number(row.marker_id), ref: row.ref, name: row.nom,
      params: row.params, simType: row.sim_type, polarized: row.polarized === 'yes',
    };
  });
}

async function tokenSheet() {
  const tokens = readTokens();
  const cols = 5, cellW = SHEET.w / cols, cellH = 380, top = 250;
  const placed = tokens.map((t, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    return { ...t, x: Math.round(col * cellW + (cellW - TOKEN_PX) / 2), y: top + row * cellH, size: TOKEN_PX };
  });

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET.w}" height="${SHEET.h}">
  <rect width="100%" height="100%" fill="white"/>
  <text x="${SHEET.w / 2}" y="70" font-family="Arial" font-size="46" text-anchor="middle" fill="#111">EduMinds — jetons de composants</text>
  <text x="${SHEET.w / 2}" y="120" font-family="Arial" font-size="28" text-anchor="middle" fill="#555">Découper sur les traits · coller sur carton · poser à plat sur le tapis · dictionnaire ${DICT}</text>`;
  for (const t of placed) {
    svg += `<rect x="${t.x - 8}" y="${t.y - 8}" width="${t.size + 16}" height="${t.size + 16}" fill="none" stroke="#bbb" stroke-width="2" stroke-dasharray="8 6"/>`;
    svg += markerGroup(t.markerId, t.x, t.y, t.size);
    svg += `<text x="${t.x + t.size / 2}" y="${t.y + t.size + 44}" font-family="Arial" font-size="30" text-anchor="middle" fill="#111">${t.name}</text>`;
    svg += `<text x="${t.x + t.size / 2}" y="${t.y + t.size + 82}" font-family="Arial" font-size="24" text-anchor="middle" fill="#666">${t.ref} · id ${t.markerId}${t.polarized ? ' · polarisé' : ''}</text>`;
  }
  svg += '</svg>';

  fs.mkdirSync(path.join(ROOT, 'assets/print'), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(path.join(ROOT, 'assets/print/tokens.png'));
  fs.writeFileSync(path.join(ROOT, 'assets/print/tokens.layout.json'),
    JSON.stringify({ sheet: SHEET, dictionary: DICT, tokens: placed.map(({ markerId, ref, name, x, y, size }) => ({ markerId, ref, name, x, y, size })) }, null, 2) + '\n');
  return placed.length;
}

const CORNERS = { TL: 100, TR: 101, BR: 102, BL: 103 };
const MAT_SIZE = 60;                       // mm
const MARGIN = 8;                          // mm

async function mat(templateFile, outName, title) {
  const tpl = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/templates', templateFile), 'utf8'));
  const W = Math.round(tpl.mat.w_mm * mm), H = Math.round(tpl.mat.h_mm * mm);
  const M = Math.round(MAT_SIZE * mm), pad = Math.round(MARGIN * mm);
  const corners = [
    { id: CORNERS.TL, x: pad, y: pad },
    { id: CORNERS.TR, x: W - pad - M, y: pad },
    { id: CORNERS.BR, x: W - pad - M, y: H - pad - M },
    { id: CORNERS.BL, x: pad, y: H - pad - M },
  ];

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="100%" height="100%" fill="white"/>`;
  for (const c of corners) svg += markerGroup(c.id, c.x, c.y, M);
  svg += `<rect x="${pad + M + 8}" y="${pad + 8}" width="${W - 2 * (pad + M + 8)}" height="${H - 2 * (pad + 8)}" fill="none" stroke="#999" stroke-width="1.2" stroke-dasharray="8 6"/>`;

  const boxW = Math.round(72 * mm), boxH = Math.round(52 * mm);
  for (const s of tpl.slots) {
    const cx = s.x * W, cy = s.y * H;
    svg += `<rect x="${Math.round(cx - boxW / 2)}" y="${Math.round(cy - boxH / 2)}" width="${boxW}" height="${boxH}" rx="10" fill="none" stroke="#1f6feb" stroke-width="2" stroke-dasharray="10 7"/>`;
    svg += `<text x="${Math.round(cx)}" y="${Math.round(cy - boxH / 2 - 12)}" font-family="Arial" font-size="26" text-anchor="middle" fill="#1f6feb">${s.instance}</text>`;
  }
  svg += `<text x="${W / 2}" y="${H - 26}" font-family="Arial" font-size="26" text-anchor="middle" fill="#666">${title} · ${tpl.scenario} · coins 100–103 · ${DICT}</text></svg>`;

  await sharp(Buffer.from(svg)).png().toFile(path.join(ROOT, 'assets/print', outName));
  fs.writeFileSync(path.join(ROOT, 'assets/print', outName.replace('.png', '.layout.json')),
    JSON.stringify({ w: W, h: H, dictionary: DICT, corners, slots: tpl.slots.map(({ instance, x, y }) => ({ instance, x, y })) }, null, 2) + '\n');
  return corners.length;
}

(async () => {
  const n = await tokenSheet();
  const c1 = await mat('tp1_slots.json', 'mat-tp1.png', 'EduMinds Mat — TP 1 · LED + résistance');
  const c3 = await mat('tp3_slots.json', 'mat-tp3.png', 'EduMinds Mat — TP 3 · Diode + buzzer');
  console.log(`tokens: ${n}, mat corners: ${c1} / ${c3}`);
})().catch((e) => { console.error(e); process.exit(1); });
