/**
 * Standalone phone demo for the integration layer.
 *
 * Served by services/sim/api.py (same origin as /api), so there is no CORS, no
 * second port and no second certificate — the same rule the app follows.
 *
 *   python3 services/sim/api.py --port 8000           # http://localhost:8000
 *   python3 services/sim/api.py --port 8443 --tls     # https, for a phone camera
 *
 * Camera access needs a secure context: on a phone, use --tls (self-signed is
 * fine, tap through the warning) or a tunnel in front of the service.
 */
import { createVision, homography, project, cornerReference } from '/src/vision.js';
import { createVisionPump } from '/src/cameraLoop.js';
import { createSimClient } from '/src/simClient.js';
import { createLabRuntime } from '/src/appBridge.js';
import { parseTokens, tokensByMarker } from '/src/tokens.js';

const el = (id) => document.getElementById(id);
const DETECT_W = 640;
const DETECT_H = 360;

const state = {
  labs: [],
  lab: null,
  template: null,
  byMarker: null,
  mapping: null,
  client: null,
  runtime: null,
  loop: null,
  stream: null,
  mat: null,
  slots: [],
  detections: 0,
  lastResult: null,
};

async function boot() {
  const [labsJson, csv, mapping] = await Promise.all([
    fetch('/shared/labs.json').then((r) => r.json()),
    fetch('/shared/components.csv').then((r) => r.text()),
    fetch('/shared/events.map.json').then((r) => r.json()),
  ]);
  state.labs = labsJson.labs;
  state.byMarker = tokensByMarker(parseTokens(csv));
  state.mapping = mapping;

  const select = el('lab');
  select.innerHTML = state.labs.map((l) => `<option value="${l.id}">${l.title_fr} — ${l.sub_fr}</option>`).join('');
  select.addEventListener('change', () => { if (state.loop?.running) restart(); });
  el('start').addEventListener('click', start);
  el('stop').addEventListener('click', stop);
  el('hint').className = '';
  el('hint').textContent = 'Appuyez sur « Démarrer la caméra », puis montrez le plateau A3 entier.';
}

async function loadLab(id) {
  state.lab = state.labs.find((l) => String(l.id) === String(id));
  state.template = await fetch('/shared/templates/' + state.lab.template).then((r) => r.json());
}

async function start() {
  try {
    await loadLab(el('lab').value);
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    const video = el('video');
    video.srcObject = state.stream;
    await video.play();
    el('overlay').width = video.videoWidth || 1280;
    el('overlay').height = video.videoHeight || 800;
    el('start').disabled = true;
    el('stop').disabled = false;
    el('camera').className = 'chip ok';
    el('camera').textContent = 'caméra : active';
    el('hint').className = 'hidden';
    startRuntime();
  } catch (err) {
    showHint(`Caméra indisponible : ${err.message}. Sur un téléphone il faut une page HTTPS (lancez le service avec --tls).`);
  }
}

function startRuntime() {
  state.client = createSimClient({
    baseUrl: '/api',
    scenario: state.lab.scenario,
    onStatus: ({ online, stale, result }) => {
      el('sim').className = 'chip ' + (online ? (stale ? 'warn' : 'ok') : 'bad');
      el('sim').textContent = online
        ? (stale ? 'simulateur : en retard' : 'simulateur : en ligne')
        : 'simulateur : hors ligne — dernier résultat gardé';
      if (result && !stale) {
        state.lastResult = result;
        state.runtime?.apply(result);
      }
    },
  });

  state.runtime = createLabRuntime({
    template: state.template,
    byMarker: state.byMarker,
    mapping: state.mapping,
    client: state.client,
    logEvent: (type, payload) => console.info('[event]', type, payload),
    uuid: () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)),
    onRender: (s) => { state.slots = state.runtime?.lastNetlist?.components ?? []; render(s); drawOverlay(); },
  });
  state.runtime.start({ lab: state.lab.id });

  const vision = createVision({ Detector: window.AR.Detector });
  const detect = document.createElement('canvas');
  detect.width = DETECT_W;
  detect.height = DETECT_H;
  const ctx = detect.getContext('2d', { willReadFrequently: true });
  const refs = cornerReference();
  let raf = null;
  let running = true;

  const pump = createVisionPump({
    vision,
    onMat: (mat) => {
      state.mat = mat;
      el('mat').className = 'chip ' + (mat.found ? 'ok' : 'warn');
      el('mat').textContent = mat.found ? 'plateau : détecté' : 'plateau : montrez les 4 coins';
      drawOverlay();
    },
    onFrames: (window) => {
      state.runtime.place(window);
      state.detections += 1;
    },
  });

  function tick() {
    if (!running) return;
    const video = el('video');
    if (video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, DETECT_W, DETECT_H);
      pump.push(ctx.getImageData(0, 0, DETECT_W, DETECT_H), performance.now());
    }
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  state.loop = {
    running: true,
    pump,
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
    },
  };

  setInterval(() => {
    el('fps').textContent = `${state.detections} détections`;
    state.detections = 0;
  }, 1000);

  // Redraw the overlay with the latest mat pose; the vision reference points are
  // mat-normalized, so the inverse of the same homography places slot rings.
  function drawOverlay() {
    draw(state.template, state.mat, refs, state.slots);
  }
}

async function restart() {
  await stop();
  await start();
}

async function stop() {
  state.loop?.stop();
  state.loop = null;
  await state.runtime?.end();
  state.runtime = null;
  state.client = null;
  for (const t of state.stream?.getTracks() ?? []) t.stop();
  state.stream = null;
  el('start').disabled = false;
  el('stop').disabled = true;
  el('camera').className = 'chip';
  el('camera').textContent = 'caméra : arrêtée';
  el('mat').className = 'chip';
  el('mat').textContent = 'plateau : —';
}

function showHint(text) {
  el('hint').className = '';
  el('hint').textContent = text;
}

function render(renderState = {}) {
  const parts = state.slots.filter((c) => c.id !== 'GND1');
  el('parts').innerHTML = parts.length
    ? parts.map((c) => `<li class="part"><b>${c.id}</b> · ${c.type}${fmtParams(c.params)}</li>`).join('')
    : '<li class="muted">—</li>';

  const led = state.lastResult?.components?.LED1 ?? renderState.components?.LED1;
  const bulb = el('bulb');
  bulb.className = 'bulb' + (led?.state === 'on' ? ' on' : led?.state === 'burned' ? ' burned' : '');
  el('bulbState').textContent = led ? `LED1 : ${led.state}` : 'rien sur le plateau';
  el('bulbCurrent').textContent = led?.current_a != null ? `${(led.current_a * 1000).toFixed(1)} mA` : '';

  const messages = (renderState.messages ?? state.lastResult?.messages ?? []);
  el('messages').innerHTML = messages.length
    ? messages.map((m) => `<li class="${m.severity === 'error' ? '' : 'muted'}">${m.text}</li>`).join('')
    : '<li class="muted">—</li>';
}

function fmtParams(params = {}) {
  const bits = [];
  if (params.resistance) bits.push(`${params.resistance} Ω`);
  if (params.voltage) bits.push(`${params.voltage} V`);
  if (params.closed != null) bits.push(params.closed ? 'fermé' : 'ouvert');
  return bits.length ? ` (${bits.join(', ')})` : '';
}

function draw(template, mat, refs, components) {
  const canvas = el('overlay');
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  if (!template || !mat?.found || !mat.corners) return;

  // image pixels -> mat coordinates
  const H = homography(mat.corners, [refs[100], refs[101], refs[102], refs[103]]);
  const inv = invert(H);
  if (!inv) return;
  const at = (x, y) => {
    const p = project(inv, [x, y]);    // mat-normalized -> normalized image quad
    return [p[0] * canvas.width, p[1] * canvas.height];
  };

  g.strokeStyle = '#3ddc97';
  g.lineWidth = 3;
  const quad = [refs[100], refs[101], refs[102], refs[103]].map(([x, y]) => at(x, y));
  g.beginPath();
  quad.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.stroke();

  const filled = new Set(components.map((c) => c.id));
  for (const slot of template.slots) {
    const [x, y] = at(slot.x, slot.y);
    g.strokeStyle = filled.has(slot.instance) ? '#3ddc97' : '#93a0c2';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y, 26, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = filled.has(slot.instance) ? '#3ddc97' : '#93a0c2';
    g.font = '600 16px system-ui';
    g.fillText(slot.instance, x + 32, y + 6);
  }
}

/** Invert a 3x3 homography (the mat -> pixel map we need is the inverse of pixel -> mat). */
function invert(H) {
  const [[a, b, c], [d, e, f], [g, h, i]] = H;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const inv = [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
  return inv;
}

boot().catch((err) => showHint(`Chargement impossible : ${err.message}`));
