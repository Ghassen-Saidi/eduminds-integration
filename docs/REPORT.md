# EduMinds integration — diagnosis, state and what is left

**23 November 2026.** Written to be checked rather than believed: every claim
has the command that proves it. Supersedes the 21 November report.

**Where it lives:** GitHub, private repo `Ghassen-Saidi/eduminds-integration`.
- `main` = `0917911` (21 Nov), untouched so far.
- `integration/2026-11-23` = this work, PR #1 → `main`.
- `feat/tp2-sensor-3v3` = TP 2, PR #2 → `integration/2026-11-23` (merge #1 first).

## 1. Diagnosis — what was actually wrong

The repository was not "one thing left to finish". Two branches had diverged
from `main` and neither contained the other's work, and the status document no
longer matched the repository.

| # | Finding | Evidence | Fixed |
|---|---|---|---|
| F1 | `feat/camera-demo` (camera loop, phone page) and `fix/integration-stability-2026-11-21` (single-flight client, bounded history, service hardening, migrations 0001/0003) both branch from `main` `0917911` and share no commit. Merging either alone silently drops the other. | `list_commits` on both branches: first commit after `0917911`; no common head | merged into `integration/2026-11-23` by hand over the conflicting files (`api.py`, `README`, `APP_WIRING`, `package.json`, `.gitignore`) |
| F2 | CI was red on a clean checkout. The marker/vision tests read `assets/print/*.png`, which are generated (and gitignored), but CI ran `npm test` without generating them — 13 Node tests fail on a fresh clone. | fresh clone: `npm test` → 60/73 before `npm run print` | `pretest: npm run print` in `package.json`; CI unchanged and now green |
| F3 | The wiring guide told the app to call `place([frame])` once per camera frame. `perception.stabilize` needs 3 sightings in the last 5 frames, so the board could never show anything. | `docs/APP_WIRING.md` (old §3) vs `src/perception.js` | camera loop hands over the rolling window; runtime also accepts single frames and ages the window on `place([])` |
| F4 | With the runtime owning the window, nothing cleared the board when the mat left the camera: a stale board stayed forever. | runtime history code | demo page and wiring doc call `place([])` per missed detection — 3 misses clear, 1 bad frame does not |
| F5 | `src/validate.js` had its own hardcoded component-type list; a new engine type would be rejected client-side before it was ever sent. | `TERMINAL_TYPES` in `src/validate.js` | list now includes `sensor_3v3` (and any future type must be added there — documented) |
| F6 | **Design conflict, unresolved:** `0003_secure_telemetry.sql` correctly stops browser clients from inserting `failure_caused` (money) rows. But nothing replaces them, so the teacher screen's "0.50 TND saved" cannot come from a phone run. | migration `0003`, `appBridge.apply()` now skips financial rows | **decision needed**: build the trusted server-side verifier (the sim service already knows the result and could write it with a service-role key) or keep client rows for the prototype |
| F7 | The six app edits still cannot be applied: `zieddhieb/edu-minds` returns 404 for the connected GitHub account — no collaborator access. | `get_file_contents(zieddhieb/edu-minds)` → 404 | unchanged; the `demo/` phone page covers the camera path without the app, and `docs/APP_WIRING.md` is ready for whoever has the repo |
| F8 | `docs/REPORT.md` claimed 132 tests, said the work could not go to GitHub, and said Supabase was never applied. All three were stale. | this file | rewritten |
| F9 | Telemetry schema state is ambiguous: `0001` was rebuilt after the original Supabase project was deleted; `0001`+`0002` were applied to `xxxscaqrfjxmsycbdebd` and verified (anon sign-in → rows → `failures_prevented` 0.50 TND); `0003`/`0004` are **not** applied. | my 21 Nov acceptance run; migrations in repo | stated plainly; nothing applied from this branch |

Two findings from the earlier round still stand and are still true:
removing the resistor gives an open circuit (`MISSING_COMPONENT`), not a burn —
the burn case is the 220 Ω value; and an A4 mat cannot hold four 45 mm tokens
beside four 60 mm corners, so the mat is A3 landscape.

## 2. What was built in this round

### Integration branch (PR #1)

- Union of both branches, conflicts resolved in `services/sim/api.py` (demo
  static routes + TLS + `/api` prefix **and** bearer token, per-IP rate limit,
  CORS allowlist, session locks, strict body handling), `README.md`,
  `docs/APP_WIRING.md`, `package.json`, `.gitignore`.
- Merged wiring doc: one-origin proxy, lab registry, one runtime per lab,
  camera loop contract (window **or** single frame + `place([])`), `stopLab`,
  `applySimState`, `takeComponent`, and what the browser may write.
- `docs/REMAINING_WORK.md` and `docs/SUPABASE_TESTS.md` from the stability work
  are kept, with the verifier and live-DB items explicit.
- Print assets regenerate before tests (`pretest`), CI runs `test:sim`,
  `test`, `check:demo`.

### TP 2 branch (PR #2) — divider + 3.3 V sensor

Engine: `sensor_3v3` analog type (`pos`/`neg`, max 3.3 V, min 2.0 V, 100 kΩ
input) stamped as a load, states `powered` / `underpowered` / `destroyed` /
`reversed` with three new message codes, all mapped in `events.map.json`
(`SENSOR_OVERVOLTAGE` is a `failure_caused` money event, the other two hints).
Validation rejects non-positive limits.

Scenario `ex4_divider_sensor`: 9 V battery → R1 → node → R2 → GND, sensor
across R2; success = sensor `powered`. Template `tp2_slots.json` reuses the
battery, the three resistor tokens and a new sensor token (CMP070, marker 24).
Lab id 2 added to `shared/labs.json`; third A3 mat and the 11-token sheet are
generated by `npm run print`; the demo page shows the sensor voltage;
`check:demo` now drives TP1 **and** TP2.

The arithmetic, exercised by the tests:

| R1 | R2 | sensor | outcome |
|---|---|---|---|
| 1 kΩ | 330 Ω | 2.23 V | `powered`, exercise complete |
| 1 kΩ | 220 Ω | 1.62 V | `underpowered` hint, no money |
| 220 Ω | 330 Ω | 5.39 V | `destroyed`, one `sensor_overvoltage` event |
| 1 kΩ | 1 kΩ | 4.48 V | `destroyed` |
| 330 Ω | 220 Ω | 3.60 V | `destroyed` (just over 3.3 V) |

Data: `supabase/migrations/0004_tp2_sensor.sql` adds lab 2, component CMP070
(**price 12.50 TND estimated — confirm against the course catalogue**) and
prices `sensor_overvoltage` for `failures_prevented`. Data only, not applied.

## 3. Verification, on a fresh clone of each pushed branch

```
integration/2026-11-23 : npm ci && npm run test:all  -> 73 python + 77 node = 150, 0 failures
                         npm run check:demo          -> LED on 21.15 mA, complete
feat/tp2-sensor-3v3    : npm ci && npm run test:all  -> 81 python + 80 node = 161, 0 failures
                         npm run check:demo          -> LED on 21.15 mA + sensor 2.23 V, both complete
```

`check:demo` starts the real service on a free port, composes camera frames from
the printed mats and tokens, runs the real ArUco detector, the mapper, the
netlist builder, the HTTP service and the engine, and asserts the exercise
completes. Marker tests decode all 11 printed tokens and the three mats
(corners 100–103) from the generated PNGs.

Supabase, from the 21 Nov verification (not re-run today, nothing changed):
anonymous sign-in on, anon user → student/session/events 201 under RLS,
`failures_prevented` → CMP018 / 1 / 0.50 TND, test rows deleted. `0003`/`0004`
are **not** applied, so the live project still allows client `failure_caused`
rows — i.e. the demo's money panel still works, but not with the hardened
policy.

## 4. Still open, in the order that matters for 25 November

| # | Item | Owner / blocker | Effort |
|---|---|---|---|
| 1 | Print the TP1 (and TP2) A3 mats at 100 %, cut the 11 tokens, mount them; run `npm test` after printing | printer + 30 min | 0.5 h |
| 2 | Phone rehearsal of the demo page on the LAN with TLS: camera permission, mat detection at an angle, mat loss, network drop | a phone and a person | 2 h |
| 3 | Decide F6 (trusted verifier vs client rows) and apply 0003 + 0004 accordingly | Ghassen + backend | 0.5–1 d |
| 4 | Six app edits in `zieddhieb/edu-minds` (access needed) | repo access | 0.5 d |
| 5 | Confirm CMP070 catalogue ref and price | course catalogue | 15 min |
| 6 | Physical TP2 sensor token; verify the 3.3 V module really reads on the phone | after 1–2 | 0.5 h |
| 7 | Teacher dashboard UI (SQL views only today) | out of this prototype | 2–3 d |
| 8 | Component photos for the toolbox | cosmetic | 0.5 d |

## 5. What I could not verify, stated plainly

- No camera, no phone, no printer here: the camera path, the print at real
  size, glare, the certificate on iOS Safari and the 90-second script are
  unverified by me.
- No access to the student app repository: the six edits are instructions, not
  merged code.
- `0003`/`0004` are not applied to any live database; the hardened policy and
  the TP2 reference rows exist only as SQL.
- The CMP070 ref and its 12.50 TND price are estimates.
- The TP2 sensor model is a load with a voltage window, not a datasheet model
  (no quiescent current, no analog reading conversion) — enough for the
  divider lesson, not for sensor calibration.
