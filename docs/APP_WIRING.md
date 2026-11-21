# Wiring the app (the six edits)

The integration is designed to be dropped into `edu-minds-app` without touching
its gaze/stereo logic. Everything below is additive except two lines.

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
export const LABS = registry.labs.map((l) => ({ id: l.id, code: l.code, title: l.title_fr, sub: l.sub_fr, scenario: l.scenario, template: l.template }));
```

`lab.scenario` is what the simulator needs; `lab.id` stays what the database
needs. That is the mapping that was missing.

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

// Call this from the vision module for every processed camera frame.
export function onMarkerFrames(frames) {
  runtime?.place(frames);                   // frames = [[{markerId,x,y,theta_deg}, ...], ...]
}

// In the client that receives the simulation result (poll or callback):
export function onSimResult(result) { runtime?.apply(result); }
```

`frames` is the vision module's output: one array per processed frame, each
entry a detected token with normalized mat coordinates and rotation in degrees.
The runtime does the debounce, the slot matching, the netlist build and the
event mapping. Nothing else in `main.js` changes.

## 4. `stopLab`

```js
export async function stopLab(lab) {
  await runtime?.end();       // stops the client, keeps the last result for the next lab
  runtime = null; client = null;
  endSession();               // the existing DB call
}
```

## 5. Render the result

`vr.js` gains one method; the integration only hands it a plain object:

```js
applySimState({ components, messages, scenarioCheck, stale, error }) {
  if (error) return console.warn('[sim]', error);
  const led = components?.LED1;
  lamp.visible = Boolean(led && led.state === 'on');
  lamp.material.opacity = led?.brightness ?? 0;
  burnedBadge.visible = led?.state === 'burned';
  hintPanel.text = (messages ?? []).map((m) => m.text).join('\n');
  doneBadge.visible = Boolean(scenarioCheck?.completed);
  staleBadge.visible = Boolean(stale);
}
```

## 6. `takeComponent` and the toolbox

With physical tokens the toolbox is no longer how a part enters the circuit, so
`takeComponent` should stop being a simulation hook. Keep it logging
`component_taken` only if the toolbox stays visible; otherwise display the
detected inventory instead. Decide once — the current hook fires on every gaze
dwell and would double-count parts.
