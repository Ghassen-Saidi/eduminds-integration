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

export function startSim(lab, databaseSession) {
  if (!databaseSession?.id) throw new Error('A persisted EduMinds database session is required');
  client = createSimClient({
    scenario: lab.scenario,
    applicationSessionId: databaseSession.id,
    onStatus: (s) => showSimStatus(s),
  });
  runtime = createLabRuntime({
    template, byMarker, mapping: eventMap,
    client, logEvent,
    submitAttestation: submitSimulationAttestation,
    uuid: () => crypto.randomUUID(),
    onRender: (state) => vr.applySimState(state),
  });
  runtime.start({ sessionId: databaseSession.id, lab });
}

// In the client that receives the simulation result (poll or callback):
export function onSimResult(result) { runtime?.apply(result); }

// The student app must await the database session before creating the
// simulator session. The simulator server signs fresh failure candidates,
// and runtime forwards that attestation separately from client telemetry.
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
  onFrames: (window) => runtime?.place(window),     // includes [] frames while the mat is missing
  onMat: (mat) => {
    if (!mat.found) showMatHint('montrez les quatre coins');
  },
});

// startLab: camera.start();   stopLab: camera.stop();
```

`onFrames` receives the **window** of the last five sampled detections.
When the mat is missing, the pump appends an empty frame (`[]`) and still
calls `onFrames`; three misses age the old placement out of the 3-of-5
debounce. The loop enforces the phone budget — detection on every second
camera frame, at most 10 detections per second — and
`runtime.place(window)` runs the debounce, slot matching, netlist build and
event mapping. Each sighting entry is `{markerId, x, y, theta_deg}` in mat
coordinates.

Use one history owner. When using `createVisionPump`, do not also call
`runtime.place([])` from `onMat`: every sampled miss is already delivered
through `onFrames`. Calling it twice desynchronizes the pump and runtime
histories. A single-frame integration that owns no pump may instead call
`runtime.place([frame])` for each sampled frame and `runtime.place([])`
for each sampled miss.

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


## 9. Trusted financial telemetry (migration 0005)

The simulator session must be bound to the UUID returned by the student app's
`startSession(lab)`. Pass that UUID as `applicationSessionId` when creating
`createSimClient`. The simulator service signs fresh financial failure
candidates only when `EDUMINDS_ATTESTATION_SECRET` is configured on the
server; this secret must never appear in browser code.

`createLabRuntime` receives `submitAttestation: submitSimulationAttestation`.
The student app sends the signed envelope to the
`record-signed-sim-result` Edge Function. The function verifies the logged-in
user, HMAC, signature age, application session ownership, and lab scenario.
The database function then records the signed run atomically and rejects
replays. Browser `logEvent('failure_caused')` calls are deliberately blocked.

Deployment order and secret setup are documented in
`docs/SUPABASE_HARDENING.md`. Do not deploy this feature before migration
`0005_harden_student_writes.sql` is applied and both server environments share
the same high-entropy attestation secret.
