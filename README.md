# EduMinds integration

The layer that lets the student app, the ArUco vision prototype and Team 3's
circuit simulator work as one prototype, plus the tests that hold the seams
together. It is a library and a test suite, not a second app.

## What is here

| Path | What it is |
|---|---|
| `shared/labs.json` | lab (TP) ↔ scenario registry |
| `shared/components.csv` | token table: catalogue ref, simulator type and marker id |
| `shared/templates/*.json` | exercise geometry and authored wiring |
| `shared/events.map.json` | simulator message code → diagnostic/event mapping |
| `src/perception.js` | rolling 3-of-5 frame stabilization |
| `src/mapper.js` | token → slot → instance |
| `src/netlist.js` | template + placements → Netlist v0.2 |
| `src/events.js` | simulation results → constrained telemetry rows |
| `src/simClient.js` | bounded request scheduling, single-flight and offline fallback |
| `src/vision.js` | camera image → ArUco markers → mat coordinates |
| `src/appBridge.js` | lab runtime, frame history and event/render bridge |
| `services/sim/` | circuit engine and local HTTP service |
| `assets/print/` | generated printable token and mat PNGs |

## Run it

```bash
npm ci
npm run test:all
npm run sim
npm run print
node tools/run-case.mjs fixtures/placements/tp1_r_220.json
```

`npm test` regenerates the printable PNG fixtures automatically before the
Node test suite, so a clean checkout has the files expected by vision tests.

The app reaches the service through the Vite dev proxy. See
`docs/APP_WIRING.md`.

## Security boundary

The simulator binds to `127.0.0.1` by default. Do not expose it directly to the
public internet; use an authenticated reverse proxy for tunnels. Client-side
`sim_result` rows are marked as unverified diagnostics. Financial
`failure_caused` events must be created by a trusted server-side verifier,
not by a browser callback.

## Remaining work

See `docs/REMAINING_WORK.md` for checks that still need the student app,
an active Supabase project, trusted server verification and physical hardware.
