# Supabase hardening deployment

This branch adds a new migration and signed simulator attestation path. It is
not yet deployed to the live EduMinds project.

## Changes

1. Students can insert their own profile with `id` and `nickname`, and update
   only `nickname`. They cannot write `class_name`; class assignment belongs
   to a trusted teacher/admin process.
2. Students can create their own session with `id`, `student_id`, `lab_id`
   and `device`. PostgreSQL supplies `started_at`. Students can only update
   `ended_at`, and a trigger overwrites it using the database clock.
3. Browser clients cannot create `failure_caused` events. They may submit
   unverified `sim_result` snapshots for diagnostics.
4. The simulator signs only fresh recognized failure codes using HMAC-SHA256.
   The signature includes the application database session UUID, simulator
   session, scenario, issue time and unique run UUID.
5. The Edge Function requires a valid Supabase user, verifies the HMAC and
   freshness window, checks that the session belongs to that user, confirms
   the lab's scenario, and calls the database function.
6. The database function checks that the session is still active, maps only
   known simulator failure codes, records the attestation digest, and writes
   financial events in the same transaction. Duplicate run IDs cannot add
   events again.

## Required deployment order

1. Confirm the target project is `xxxscaqrfjxmsycbdebd` and inspect whether
   migrations 0001–0004 are already applied. Do not replay a base/rebuild
   migration over a live schema.
2. Verify the existing `labs.scenario` column, `teacher_classes` table,
   event type constraint, and current grants/policies.
3. Apply `0005_harden_student_writes.sql` after reconciling any schema drift.
4. Set a random high-entropy `EDUMINDS_ATTESTATION_SECRET` in the simulator
   service environment and in Supabase Edge Function secrets. Use the exact
   same secret in both secure server environments.
5. Deploy `record-signed-sim-result` with JWT verification enabled.
6. Configure the student app with only its Supabase URL and publishable key.
   Never put `service_role`, `sb_secret_...`, or the attestation secret in
   browser code or a `VITE_` variable.
7. Run `supabase/tests/checks.sql` and
   `supabase/tests/rls_hardening.sql` on a disposable database.
8. Test with separate anonymous student, permanent student and teacher
   accounts. Verify class assignment, session completion, teacher class
   scoping, signed failure creation, and replay rejection.
9. Run Supabase security, performance and health advisors after the migration.

## Deployment secrets

The student app requires `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` (a publishable key is recommended; the legacy env
name is retained for compatibility).

The simulator and Edge Function require `EDUMINDS_ATTESTATION_SECRET`.
The Edge Function uses the platform-provided server-side
`SUPABASE_SERVICE_ROLE_KEY`; it must never be exposed to the browser.

## Important limitation

A signed outcome proves that the trusted simulator engine produced the
recognized result for a submitted netlist. It does not prove physical hardware
was actually damaged, nor does it make arbitrary browser-authored diagnostic
snapshots authoritative. The financial reporting view should continue to be
described as estimated avoided component cost, not real cash savings.
