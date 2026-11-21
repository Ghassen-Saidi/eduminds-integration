# EduMinds integration — what is done, what is verified, what is left

21 November 2026. This is the status of the integration work, written to be
checked rather than believed: every claim below has a command next to it.

**Where it lives:** the private git store repo `eduminds-integration`
(read it with `gsk sb-git find -r eduminds-integration` / `gsk sb-git cat -r eduminds-integration -p <path>`).
It could not go to GitHub: `gsk github` has no create-repo action and `gh` is not
authenticated here. The print assets are PNGs, which that store refuses, so they
are in Ghassen's Drive and regenerate with `npm run print`.

## 1. Built in this repository

| Piece | File | State |
|---|---|---|
| Lab ↔ scenario registry | `shared/labs.json` | done |
| Token table (CMP → sim type/params/marker) | `shared/components.csv` | done, 10 demo tokens |
| Exercise geometry (slots + authored wiring) | `shared/templates/tp1_slots.json`, `tp3_slots.json` | done |
| Failure/hint mapping, total over the engine's codes | `shared/events.map.json` | done and tested |
| Frame debounce, slot mapper, netlist builder, guard | `src/perception.js`, `mapper.js`, `netlist.js`, `validate.js` | done |
| Sim result → `events` rows | `src/events.js` | done |
| Debounced client with stale/offline fallback | `src/simClient.js` | done |
| App-facing runtime (frames in, render state out) | `src/appBridge.js` | done |
| HTTP service over the unchanged engine | `services/sim/api.py` | done, stdlib only |
| Engine packaging fixed | `services/sim/eduminds/` | done (was `edumind_simu` with `eduminds` imports) |
| Printable token sheet and two mats, corners 100–103 | `assets/print/` | generated and decoded |
| Tests | `tests/`, `services/sim/tests/` | 56 Node + 65 Python |
| CI | `.github/workflows/ci.yml` | done |
| Supabase migration + SQL checks | `supabase/` | written, **not applied** |
| App wiring instructions | `docs/APP_WIRING.md` | written, **not merged** |

## 2. Verified here (with the command that proves it)

`npm run test:all` → 121 tests, 0 failures.

1. **The engine runs as shipped in this repo** — `npm run test:sim` runs the 57
   original Team 3 tests. As downloaded it could not run at all: the package
   folder was `edumind_simu`, every import and the CLI said `eduminds`, and
   `pytest.ini` pointed at `tests/` while the folder was `test/`.
2. **The HTTP service behaves** — 8 tests over real sockets: session creation,
   unknown scenario → 422, bad body → 400, stateless fallback when a session is
   unknown, delete idempotency, five sessions staying isolated under
   interleaved good/bad input.
3. **The stale rule works end to end** — valid → invalid → valid returns
   `stale: true` with the previous components, then a fresh result. This is the
   behaviour a dropped camera frame relies on.
4. **Ten integration cases run through the real engine** — correct board, 220 Ω,
   missing resistor, reversed LED, open switch, empty mat, one-frame blip, wrong
   slot, crowded slot, TP3. No case produces an engine input-error code, which
   is the failure mode that silently freezes the UI.
5. **The correct board completes the exercise** — TP1 with 330 Ω: LED on,
   brightness 1.0, 21.15 mA, `scenario_check.completed = true`, nothing logged.
   TP3: buzzer sounding, diode reverse-blocking, completed. Note the switch sits
   on the return path because the exercise grader compares topology, not just
   connectivity: a switch on the positive side is electrically identical and
   still scores `WIRING_DIFFERS`. The template was aligned to the target netlist
   after seeing that.
6. **The money path is exact** — 220 Ω → 31.67 mA → LED `burned` → exactly one
   `failure_caused` row with `failure_code: "led_overcurrent"`, wired correctly
   but goal missed. Reversed LED and missing parts produce hints, never money.
7. **The event mapping is total** — a test reads the engine's own `TEXTS` table
   in Python and fails if any code the engine can emit has no mapping. It caught
   `UNKNOWN_TYPE` on the first run.
8. **Event rows obey the database constraints** — `failure_caused` rows carry no
   `component_ref` (the schema says `component_ref IS NOT NULL` only for
   `component_taken`); the part reference travels in `payload`.
9. **The printed artefacts actually decode** — `tests/markers.test.js` crops
   every token and all four corners from the generated PNGs and decodes them
   with the same detector settings the vision code uses (`ARUCO_MIP_36h12`,
   max hamming 6). All 10 tokens and both mats return their ids; corners are
   100–103 and no token reuses that range.
10. **The builder cannot emit an unknown terminal** — a property test walks every
    subset of filled slots and asserts the client guard accepts the result, and
    that an empty slot leaves no terminal reference behind.
11. **Client behaviour** — 10 updates in 60 ms send one request; one session is
    reused; a dropped request returns the last good result without throwing; a
    server-side `stale` answer does not overwrite the last good result; the last
    good result survives a reload; `stop()` sends nothing.
12. **Perception debounce** — a marker must appear in 3 of the last 5 frames; a
    one-frame blip changes nothing in the netlist; mat corners are never parts.

## 3. A finding that corrects the earlier plan

The plan said "removing the resistor token burns the LED". It does not: with
guided slots an empty slot is an **open circuit**, so the LED goes dark and the
engine reports `MISSING_COMPONENT` — verified in `tp1_missing_r`. The burn case
is the wrong value (220 Ω), which is what the demo should show. Teaching "no
resistor = burnt LED" needs either free placement (the engine already supports
it) or a 0 Ω jumper token in the resistor slot; neither is built.

## 4. Leftover work, in the order it blocks the demo

| # | Item | Why it is still open | Effort |
|---|---|---|---|
| 1 | **Vision must emit frames.** `onMarkerFrames([[{markerId,x,y,theta_deg}]])` in normalized mat coordinates. Today the archived detector draws on a canvas and exports nothing, and the phase-3 build with homography is not in the Drive folder. | needs the vision team or a 120-line rebuild from the mat geometry | 1–2 d |
| 2 | **Apply the six app edits** (`docs/APP_WIRING.md`): proxy, lab registry, one runtime per lab, stopLab, `vr.applySimState`, takeComponent decision. | their repo, their merge | 0.5 d |
| 3 | **Supabase**: apply `supabase/migrations/0002_sim_state.sql`, run `supabase/tests/checks.sql`, confirm anonymous sign-ins are enabled. | no Supabase access from here (the connector is not enabled for this agent) | 0.5 d |
| 4 | **Phone + browser rehearsal**: the page on a real phone, real mat, real tokens; then the fake-camera Playwright run in CI (`--use-file-for-fake-video-capture`) for regression. | no camera, no browser stack and no physical mat here | 1 d |
| 5 | **TP2** (divider + 3.3 V sensor): the engine has no analog 3.3 V sensor type; needs `sensor_3v3` + `ex4_divider_sensor` + template + tokens. | nobody owns it | 1 d |
| 6 | **Print and mount** `assets/print/*.png` on A4 landscape at 100 %; the files are verified but not physical yet. | printer | 0.5 h |
| 7 | **Teacher dashboard UI** — still only SQL views. | out of this prototype | 2–3 d |
| 8 | **Component photos** for the toolbox (`public/components/` is empty). | cosmetic once tokens are physical | 0.5 d |
| 9 | **A private GitHub repo.** `gsk github` can read repos and manage issues but has no create-repo action, and `gh` is not authenticated here, so this work is in the private Genspark git repo `eduminds-integration` instead. Point me at an empty GitHub repo and I will push it there. | needs a repo or a token | 5 min |
| 10 | **Detection budget.** The demo video's HUD reads 79 ms per ArUco frame at 720p; downscaling to 640×360 and every second frame is specified but not implemented (vision side). | vision team | 0.5 d |

## 5. What I could not verify, stated plainly

- No camera, no phone, no headset: the camera path, the gyroscope, the stereo
  render and the frame rate are unverified by me.
- No browser: the Playwright/fake-camera test is specified in the plan but not
  written or run here.
- No Supabase: the migration and SQL checks are written but never executed.
- The phase-3 vision source (mat homography, hand gestures, 68 tests) is still
  absent from the Drive folder.
- The printed artefacts decode from PNG; whether the paper print survives a
  phone camera at an angle is a physical test.
