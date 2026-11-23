# EduMinds integration

The layer that lets the student app, the ArUco vision prototype and Team 3's
circuit simulator work as one prototype, plus the tests that hold the seams
together. It is a library, a test suite and a phone page — not a second app:
the phone still runs `edu-minds-app`, and the simulator is still Team 3's
engine, unmodified.

## What is here

| Path | What it is |
|---|---|
| `shared/labs.json` | lab (TP) ↔ scenario registry — the mapping the four projects never had |
| `shared/components.csv` | token table: CMP ref → sim type, params, marker id (10 tokens) |
| `shared/templates/*.json` | exercise geometry: slot positions on the mat, accepted refs, authored wiring |
| `shared/events.map.json` | every simulator message code → an `events` row (or explicitly nothing) |
| `src/perception.js` | 3-of-5 frame debounce: one bad camera frame cannot place or remove a part |
| `src/mapper.js` | token → slot → instance, with position/orientation tolerance and rejections |
| `src/netlist.js` | template + placements → Netlist v0.2 (Team 3's schema, unchanged) |
| `src/validate.js` | client-side guard so a malformed netlist is never sent |
| `src/events.js` | sim result → `events` rows that satisfy the DB constraints |
| `src/simClient.js` | bounded coalescing client: single flight, offline/stale fallback, last-good survives reload |
| `src/vision.js` | camera frame → ArUco markers → mat homography → token frames in mat coordinates |
| `src/cameraLoop.js` | `<video>` → detection budget (every 2nd frame, ≤10/s) → the rolling window `perception.js` needs |
| `src/appBridge.js` | the module the app imports: one lab runtime, frames in, event rows + render state out |
| `services/sim/` | Team 3's engine (packaging fixed) + a stdlib HTTP service (optional bearer token, rate limit, TLS) |
| `assets/print/` | printable token sheet and the two mats (corners 100–103) |
| `demo/` | a standalone phone page: camera → board → lamp/sensor, no app needed |
| `tests/` | 77 Node tests + 73 pytest tests (150) |

## Run it

```bash
npm ci                         # sharp, js-aruco2, esbuild
npm run test:all               # 73 python + 77 node tests (node tests print the assets first)
npm run check:demo             # runs the service and drives TP1 end to end on a real socket

npm run sim                    # HTTP service on 127.0.0.1:8000
npm run demo                   # + the phone page on http://127.0.0.1:8000/
npm run demo:tls               # https on :8443, needed for the camera on a phone (see docs/DEMO.md)
node tools/run-case.mjs fixtures/placements/tp1_r_220.json   # one case, end to end
npm run print                  # regenerate assets/print/*.png
npm run freeze                 # re-freeze the golden engine results after a deliberate change
```

`npm test` runs `npm run print` first (`pretest`), so a clean clone and CI both
produce the PNGs the marker tests decode.

The app reaches the service through the Vite dev proxy, never a second origin:
`server.proxy['/api'] = 'http://127.0.0.1:8000'`. See `docs/APP_WIRING.md`.
If the service is exposed beyond loopback, set `EDUMINDS_API_TOKEN` and put an
authenticated proxy in front of it; the token never goes into browser code.

## Status

`docs/REPORT.md` is the honest account: what was built, what was verified here,
what still needs a phone, Supabase or another team's source. `docs/REMAINING_WORK.md`
is the short list of what needs external access or physical testing.
