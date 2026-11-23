# EduMinds integration — follow-up diagnosis and implementation report

**Date:** 23 November 2026  
**Repository:** `Ghassen-Saidi/eduminds-integration` (private)  
**Diagnostic branch:** `fix/post-tp2-diagnostics-2026-11-23`  
**Base:** `feat/tp2-sensor-3v3`  
**Scope:** review and harden the camera-to-runtime pipeline and the local simulator API after PR #1 and PR #2.

## Executive summary

The current integration and TP2 branches have successful GitHub Actions runs on their latest PR heads. PR #1 targets `main`; PR #2 targets PR #1's integration branch and must be merged after PR #1. Neither PR was merged at the time of this report.

This follow-up identified and is correcting a camera history defect that can restore stale placements after the mat re-enters the camera view, plus three simulator service issues: incomplete expiry cleanup, unsafe non-loopback binding without authentication, and leaking raw engine exception details to API clients. A separate demo lifecycle leak (an interval retained after each stop/restart) is also being corrected.

The diagnostic branch is isolated from the two existing PRs. The new follow-up CI result is pending; this report deliberately does not claim its new tests have passed yet.

## 1. Repository and PR state verified

| Item | Verified state |
|---|---|
| Default branch | `main` |
| PR #1 | `integration/2026-11-23` → `main`, open |
| PR #2 | `feat/tp2-sensor-3v3` → `integration/2026-11-23`, open |
| PR #1 latest head | `6589e35d415c24e002afbec6276bba1d3c9ed86f` |
| PR #2 latest head | `e4b31a8b2dd918687b125239dac7538ba15a3e72` |
| Follow-up branch | `fix/post-tp2-diagnostics-2026-11-23`, created from TP2 head |
| Latest CI for PR #1 | run #32, success |
| Latest CI for PR #2 | run #34, success |
| Reviews on PR #1/#2 | none returned by GitHub at inspection time |

The existing branch report records 150 tests for the integration branch and 161 for TP2, with the TP2 run adding the divider/sensor tests. GitHub Actions confirms the latest two PR workflow runs concluded successfully. The PRs are not yet merged; the dependency order is PR #1 first, PR #2 second.

## 2. Findings and implementation status

### F-01 — stale camera frames can return after mat loss

**Severity:** high for live interaction  
**Evidence:** `src/cameraLoop.js`, `src/perception.js`, `src/appBridge.js`, and the demo's `onMat` callback.

Before this branch, a sampled frame with no mat caused the vision pump to retain its previous five-frame buffer and send nothing to `onFrames`. The demo separately called `runtime.place([])`, ageing the runtime's private history but not the pump's buffer. When the mat was seen again, the pump could send its old pre-loss sightings and make a component appear again without three new sightings.

**Change on this branch:** every sampled detection now contributes to the pump's rolling history. A missing mat contributes an empty frame (`[]`), and the updated window is sent to `onFrames` just like a normal detection. The demo no longer calls `runtime.place([])` in `onMat`, avoiding double-aging and buffer drift.

**Regression test added:** stabilise a component with three detections, remove the mat for three detections, verify the component disappears, then return the mat and verify the old sightings do not restore it. The component should only return after three fresh detections.

### F-02 — expiry cleanup only ran on POST

**Severity:** medium, long-running process resource hygiene  
**Evidence:** `purge()` was called inside `do_POST`, but the API also exposes GET health and DELETE session routes. An idle API receiving only GET/DELETE requests could retain expired sessions and rate-limit buckets longer than intended.

**Change on this branch:** `_access_error()` now performs expiry cleanup for every protected API request; the duplicate POST-only purge call was removed. A focused test checks that a protected request invokes cleanup.

### F-03 — an externally bound service could run without a bearer token

**Severity:** high if the operator changes the default host  
**Evidence:** the default bind is loopback, which is appropriate for local development, but `--host 0.0.0.0` was accepted even when `EDUMINDS_API_TOKEN` was unset.

**Change on this branch:** `validate_bind()` allows loopback addresses without a token, but rejects non-loopback binds unless `EDUMINDS_API_TOKEN` is configured. A reverse proxy must still enforce authentication; the environment token is for trusted proxy injection and must never be placed in browser code.

### F-04 — raw simulator exceptions were returned to browser callers

**Severity:** medium  
**Evidence:** the API returned `repr(exc)` in the `ENGINE_ERROR` body.

**Change on this branch:** exception detail is written to the service log and the client receives a generic `simulation failed` message. A regression test ensures internal exception text is absent from the response.

### F-05 — demo interval is not cleaned up across stop/restart

**Severity:** medium, repeated restart resource leak  
**Evidence:** `startRuntime()` created an untracked `setInterval` every time the demo started; `stop()` did not clear it. Repeated lab switches could accumulate timers updating the same UI.

**Change on this branch:** store the interval handle in demo state, clear it on stop and before creating a replacement. The error path now also stops any partially created loop/runtime and releases camera tracks. A new lab start clears prior lab render state so old simulation output is not displayed for the next exercise.

## 3. Files changed on the diagnostic branch

- `src/cameraLoop.js` — include empty frames in rolling history.
- `tests/cameraLoop.test.js` — mat-loss and no-resurrection regression coverage.
- `demo/main.js` — remove duplicate mat-loss ageing; manage interval and camera cleanup.
- `services/sim/api.py` — cleanup on protected requests, bind validation, generic engine error response.
- `services/sim/tests/test_api.py` — tests for bind policy, expiry cleanup and exception redaction.
- `docs/APP_WIRING.md` — document a single, consistent camera-history owner.

## 4. Existing implementation reviewed

The integration now has a defined pipeline from camera marker detection through a mat homography, token placement stabilisation, slot mapping, netlist validation, the Python circuit engine, and event mapping. The pump budgets detections to every second camera frame and at most 10 detections per second; the perception layer requires three hits in the last five frames.

The TP2 implementation adds a `sensor_3v3` analog load with a 2.0–3.3 V operating window and 100 kΩ input model, an `ex4_divider_sensor` scenario, TP2 fixture/template data, and a new component token. The automated divider values and outcomes are covered by the existing fixture tests. This is a teaching model, not a manufacturer-accurate sensor model: it does not model quiescent current, ADC conversion, or a specific device datasheet.

## 5. Supabase diagnosis and deployment boundary

The migrations in the repository were reviewed, but no database migration was applied in this round.

- The branch report references historical project `xxxscaqrfjxmsycbdebd`, but that project was not present in the current connected-project listing. The two projects currently listed by Supabase are both `INACTIVE`.
- The Supabase project-detail action returned a permission error for the historical project. Therefore the real schema, applied migration history, Auth settings, Data API exposure, logs and advisors could not be inspected.
- Migration `0003_secure_telemetry.sql` removes student ability to insert `failure_caused` directly. The browser runtime deliberately skips these financial rows. No trusted server-side verifier/event writer is implemented in the repository yet, so a hardened live deployment will not generate the financial rows that feed `failures_prevented` until that trusted path exists.
- Migration `0001_rebuild.sql` permits a student to update their own `students` row based on user ID alone. Since `class_name` is on that row and teacher analytics are scoped by class assignments, a student may be able to change their class and affect teacher scoping. Session self-update similarly appears broader than the likely app contract. This needs a reviewed column-level permission design and a confirmed app write contract; it has not been changed here.
- Migration `0004_tp2_sensor.sql` records CMP070 and 12.50 TND as estimates. These values must be checked against the course catalogue before application.
- The historic claim that anonymous sign-in was enabled and the initial migrations worked is carried forward from the earlier report; it was not reverified in this session.

**Do not apply migrations 0003/0004 or any permission rewrite until the correct active Supabase project and application contract are confirmed.** Do not place a service-role key in the browser or commit it to GitHub.

## 6. Important integration work still outstanding

1. Implement the trusted financial-event verifier/writer using authenticated student identity and server-side simulation results; reject browser-supplied failure codes, component prices and outcome claims.
2. Confirm the active Supabase project and inspect its migration history/schema/Auth/Data API before reconciling and applying migrations.
3. Restrict student updates to intended columns (e.g. nickname) and move class assignment/session lifecycle changes to trusted administrative/server paths after checking the app contract.
4. Integrate the adapter into the real student app repository. The previous access attempt to `zieddhieb/edu-minds` was 404 for the linked GitHub account, so the app lifecycle changes remain guidance, not merged code.
5. Complete the physical phone rehearsal: secure-origin camera permission, iOS/Android behaviour, angled/glare detection, mat-loss and recovery, sensor response, network loss/recovery.
6. Print the mats/tokens at 100% and confirm TP2's CMP070 model and catalogue price.

## 7. Verification

**Existing branches:** current GitHub Actions PR runs #32 and #34 succeeded. The 150/161 test counts come from the repository's previous clean-clone report.

**This follow-up branch:** new regression tests have been added. Its CI is not yet confirmed by this report. Do not merge the follow-up PR until the new GitHub Actions run passes.

**Not verified here:** real phone/camera operation, physical print scale/glare, real sensor characteristics, active Supabase schema or migration state, and end-to-end app wiring into the student-app repository.
