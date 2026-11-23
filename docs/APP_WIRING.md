# Wiring the app

The integration drops into `edu-minds-app` without touching its gaze/stereo
logic. Everything below is additive except two lines (`stopLab` and the
`vr.applySimState` call).

## 1. Vite proxy — one origin, no CORS, no second certificate

`vite.config.js`:

```js
export default defineConfig({
  plugins: [basicSsl()],
  server: {
    host: true,
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') } },
  },
});
```

With this, `POST /api/v1/simulate` from the phone reaches the laptop's service
through the same HTTPS origin as the page. This is also what a Cloudflare
Tunnel needs: one hostname, `/api` proxied, nothing on a second port.

## 2. Load the lab list from the shared registry

`src/labs.js` becomes:

```js
import registry from '../../shared/labs.json';       // path depends where you vendor the folder
export const LABS = registry.labs.map((l) => ({ id: l.id, code: l.code, title_fr: l.title_fr, sub_fr: l.sub_fr, scenario: l.scenario, template: l.template }));
```

`lab.scenario` is what the simulator needs; `lab.id` stays what the database
needs. That is the mapping that was missing. The registry now carries TP 1,
TP 2 (divider + 3.3 V sensor) and TP 3.

## 3. One runtime per lab, created on startLab

```js
import { createSimClient } from '../../eduminds-integration/src/simClient.js';
import { createLabRuntime } from '../../eduminds-integration/src/appBridge.js';
import { parseTokens, tokensByMarker } from '../../eduminds-integration/src/tokens.js';
import componentsCsv from '../../shared/components.csv?raw';
import eventMap from '../../shared/events.map.json';
import template from /* lab.template */ '../../shared/templates/tp1_slots.json';

const byMarker = tokensByMarker(parseTokens(componentsCsv));

let runtime = null;
let client = null;

export function startSim(lab) {
  client = createSimClient({ scenario: lab.scenario, onStatus: (s) => showSimStatus(s) });
  runtime = createLabRuntime({
    template, byMarker, mapping: eventMap,
    client, logEvent,                       // db.js logEvent, unchanged
    uuid: () => crypto.randomUUID(),
    onRender: (state) => vr.applySimState(state),   // new: see 5
  });
  runtime.start({ lab });
}

// In the client that receives the simulation result (poll or callback):
export function onSimResult(result) { runtime?.apply(result); }
```

## 4. Camera callback

```js
import { createVision } from '../../eduminds-integration/src/vision.js';
import { startCameraLoop } from '../../eduminds-integration/src/cameraLoop.js';
import { AR } from 'js-aruco2';                    // the library the vision prototype already uses

const vision = createVision({ Detector: AR.Detector });
const detectCanvas = document.createElement('canvas');     // 640x360, downscaled
detectCanvas.width = 640;
detectCanvas.height = 360;

const camera = startCameraLoop({
  video, canvas: detectCanvas, vision,
  onFrames: (window) => runtime?.place(window),     // the rolling window, see below
  onMat: (mat) => {
    if (!mat.found) { showMatHint('montrez les quatre coins'); runtime?.place([]); }
  },
});

// startLab: camera.start();   stopLab: camera.stop();
```

`onFrames` receives the **window** of the last five sighting frames. The loop
enforces the phone budget — detection on every second camera frame, at most
10 detections per second — and `runtime.place(window)` runs the 3-of-5 debounce,
the slot matching, the netlist build and the event mapping. Each entry is
`{markerId, x, y, theta_deg}` in mat coordinates.

One frame can never satisfy the debounce, so never call `place([frame])` once
per camera frame unless you keep your own history — the runtime accepts a
single frame too (`place([frame])` per processed frame) and keeps its own
five-frame window, but then it must also be told when the mat is gone:
`place([])` per missed detection, which ages the window out. Pick one of the
two styles; the demo page uses the window style plus `place([])` on mat loss.

## 5. `stopLab`

```js
export async function stopLab(lab) {
  await runtime?.end();       // stops the client, keeps the last result for the next lab
  runtime = null; client = null;
  endSession();               // the existing DB call
}
```

## 6. Render the result

`vr.js` gains one method; the integration only hands it a plain object:

```js
applySimState({ components, messages, scenarioCheck, stale, error }) {
  if (error) return console.warn('[sim]', error);
  const led = components?.LED1;
  lamp.visible = Boolean(led && led.state === 'on');
  lamp.material.opacity = led?.brightness ?? 0;
  burnedBadge.visible = led?.state === 'burned';
  const sensor = components?.SENSOR1;                 // TP 2
  sensorPanel.text = sensor ? `capteur : ${sensor.state} · ${sensor.voltage_v.toFixed(2)} V` : '';
  hintPanel.text = (messages ?? []).map((m) => m.text).join('\n');
  doneBadge.visible = Boolean(scenarioCheck?.completed);
  staleBadge.visible = Boolean(stale);
}
```

## 7. `takeComponent` and the toolbox

With physical tokens the toolbox is no longer how a part enters the circuit, so
`takeComponent` should stop being a simulation hook. Keep it logging
`component_taken` only if the toolbox stays visible; otherwise display the
detected inventory instead. Decide once — the current hook fires on every gaze
dwell and would double-count parts.

## 8. What the browser may write

`runtime.apply()` now maps only non-financial messages into `db.logEvent`:
`failure_caused` rows are edge-triggered and counted in the returned rows, but
the client never submits them. A burnt LED or an overvolted sensor must be
recorded by a trusted server-side verifier (see `docs/REMAINING_WORK.md`), which
is what `supabase/migrations/0003_secure_telemetry.sql` enforces. The client
writes `lab_started` / `component_taken` / `hint_used` / `lab_ended` and a
throttled `sim_result` snapshot tagged `student_client_unverified`.
