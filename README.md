# EduMinds integration

The layer that lets the student app, the ArUco vision prototype and Team 3's
circuit simulator work as one prototype, plus the tests that hold the seams
together. It is a library and a test suite, not a second app: the phone still
runs `edu-minds-app`, and the simulator is still Team 3's engine, unmodified.

## What is here

| Path | What it is |
|---|---|
| `shared/labs.json` | lab (TP) ↔ scenario registry — the mapping the four projects never had |
| `shared/components.csv` | token table: CMP ref → sim type, params, marker id (adds `sim_type`, `params`, `marker_id`, `token`, `polarized` to the app's CSV) |
| `shared/templates/*.json` | exercise geometry: slot positions on the mat, accepted refs, authored wiring |
| `shared/events.map.json` | every simulator message code → a `events` row (or explicitly nothing) |
| `src/perception.js` | 3-of-5 frame debounce: one bad camera frame cannot place or remove a part |
| `src/mapper.js` | token → slot → instance, with position/orientation tolerance and rejections |
| `src/netlist.js` | template + placements → Netlist v0.2 (Team 3's schema, unchanged) |
| `src/validate.js` | client-side guard so a malformed netlist is never sent |
| `src/events.js` | sim result → `events` rows that satisfy the DB constraints |
| `src/simClient.js` | debounced client, offline/stale fallback, last-good result survives reload |
| `src/vision.js` | camera frame → ArUco markers → mat homography → token frames in mat coordinates |
| `src/cameraLoop.js` | `<video>` → detection budget (every 2nd frame, ≤10/s) → the rolling window `perception.js` needs |
| `src/appBridge.js` | the module the app imports: one lab runtime, frames in, render state out |
| `services/sim/` | Team 3's engine (packaging fixed) + a stdlib HTTP service |
| `assets/print/` | printable token sheet and the two mats (corners 100–103) |
| `demo/` | a standalone phone page: camera → board → lamp, no app needed |
| `tests/` | 73 Node tests + 71 pytest tests (144) |

## Run it

```bash
npm install                    # sharper, js-aruco2, esbuild
npm run test:sim               # 71 python tests (engine, HTTP contract, demo routes)
npm test                       # 73 node tests (vision, camera loop, mapper, builder, events, client, pipeline, markers)
npm run test:all               # both
npm run check:demo             # runs the service itself and drives 3 frames end to end

npm run sim                    # HTTP service on 127.0.0.1:8000
npm run demo                   # + the phone page on http://127.0.0.1:8000/
npm run demo:tls               # https on :8443, needed for the camera on a phone (see docs/DEMO.md)
node tools/run-case.mjs fixtures/placements/tp1_r_220.json   # one case, end to end
npm run print                  # regenerate assets/print/*.png
```

The app reaches the service through the Vite dev proxy, never a second origin:
`server.proxy['/api'] = 'http://127.0.0.1:8000'`. See `docs/APP_WIRING.md`.

## Status

`docs/REPORT.md` is the honest account: what was built, what was verified here,
and what still needs a phone, a Supabase project or the vision team's source.
