#!/usr/bin/env node
/**
 * Proof that the phone demo's whole path works without a phone:
 * composed camera frame -> vision -> rolling window -> runtime -> HTTP service
 * -> engine -> render state, over a real socket.
 *
 *   npm run check:demo
 *
 * Starts services/sim/api.py itself on a free port (with --demo), stops it at
 * the end. Exit code 0 only if the LED lights and the exercise completes.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createVision } from '../src/vision.js';
import { createVisionPump } from '../src/cameraLoop.js';
import { createSimClient } from '../src/simClient.js';
import { createLabRuntime } from '../src/appBridge.js';
import { parseTokens, tokensByMarker } from '../src/tokens.js';
import { readJson, path } from '../harness/chain.mjs';
import { composeFrame } from '../tests/support/images.mjs';

const require = createRequire(import.meta.url);
const { AR } = require('js-aruco2');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  for (const port of [8137, 8241, 8353, 8467]) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/health`);
      if (res.ok) continue;                     // something is already there
    } catch { return port; }
  }
  throw new Error('no free port in the check range');
}

async function waitForHealth(base, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(`${base}/v1/health`);
      if (res.ok) return await res.json();
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('service did not come up');
}

const port = await freePort();
const server = spawn('python3', [path('services/sim/api.py'), '--port', String(port), '--demo'], {
  cwd: path(''), stdio: ['ignore', 'pipe', 'inherit'],
});
let serverErr = '';
server.stdout.on('data', (b) => { serverErr += String(b); });

try {
  const base = `http://127.0.0.1:${port}`;
  const health = await waitForHealth(base);
  const page = await fetch(`${base}/`);
  const pageHtml = await page.text();
  const staticOk = page.ok && pageHtml.includes('EduMinds');

  const tp1 = readJson('shared/templates/tp1_slots.json');
  const mapping = readJson('shared/events.map.json');
  const byMarker = tokensByMarker(parseTokens(readFileSync(path('shared/components.csv'), 'utf8')));

  const frame = await composeFrame({
    template: tp1,
    tokens: [
      { instance: 'BAT1', markerId: 1 },
      { instance: 'R1', markerId: 23 },
      { instance: 'LED1', markerId: 4 },
      { instance: 'SW1', markerId: 8 },
    ],
  });

  let settled = false;
  const result = await new Promise((resolve) => {
    const client = createSimClient({
      baseUrl: `${base}/api`,
      scenario: 'ex1_led_series',
      onStatus: ({ online, stale, result: r }) => {
        if (!settled && online && !stale && r) { settled = true; client.stop(); resolve(r); }
      },
    });
    const runtime = createLabRuntime({
      template: tp1, byMarker, mapping, client,
      logEvent: () => {}, uuid: () => 'check-demo', now: () => '2026-11-23T00:00:00.000Z',
    });
    runtime.start({ lab: 1 });
    const pump = createVisionPump({
      vision: createVision({ Detector: AR.Detector }),
      minIntervalMs: 0, everyNFrames: 1,
      onFrames: (window) => runtime.place(window),
    });
    for (let i = 0; i < 3; i += 1) pump.push(frame, i * 50);
    setTimeout(() => resolve(null), 6000);
  });

  const led = result?.components?.LED1 ?? {};
  const ok = Boolean(result) && led.state === 'on' && result.scenario_check?.completed === true;
  console.log(JSON.stringify({
    service: { port, scenarios: health.scenarios, demoPage: staticOk },
    framesIn: 3,
    netlist: { components: result ? Object.keys(result.components) : [] },
    led: { state: led.state, current_ma: led.current_a == null ? null : Math.round(led.current_a * 1e5) / 100 },
    completed: result?.scenario_check?.completed ?? null,
    ok,
  }, null, 2));
  process.exitCode = ok ? 0 : 1;
} finally {
  server.kill('SIGTERM');
  await sleep(100);
}
