# Remaining integration work

## Automated in this branch
- Rebuild print assets before Node tests on a clean checkout.
- Test rolling 3-of-5 camera history and mat-loss ageing.
- Test bounded coalescing and single-flight simulation requests, including abort on stop.
- Test catalogue reference mapping, failure edge-triggering and throttled diagnostic snapshots.
- Test simulator session behavior, configured bearer auth and per-IP rate limits.
- Review migrations 0001–0003 and SQL assertions; these have not been applied to a live database.

## Still requires external access or physical testing
- Re-authorize the Supabase MCP connection for the Healthy EduMinds project (ref `xxxscaqrfjxmsycbdebd`) and inspect its real schema, migration history, Auth configuration, Data API exposure, logs and advisors. The dashboard screenshot shows it Healthy, but the current MCP connection still returns permission denied.
- Review and apply `0005_harden_student_writes.sql` only after confirming that migrations 0001–0004 match the live database.
- Deploy `record-signed-sim-result` and configure the same high-entropy `EDUMINDS_ATTESTATION_SECRET` in the simulator and Edge Function secret stores.
- Integrate the hardened data-layer adapter into the student-app repository; a ZIP snapshot is being reviewed, but GitHub access to the private `zieddhieb/edu-minds` repository is not currently available.
- Run the PostgreSQL/RLS assertions in `supabase/tests/rls_hardening.sql` on a disposable database, then verify real student and teacher accounts before release.
- Provision teacher-to-class assignments from a trusted administrative path and test with real teacher/student accounts.
- Physically test a phone, printed A3 mat and tokens, camera permission, sensors, mat-loss and network recovery.
- Test the service behind the intended authenticated tunnel/reverse proxy.

No live Supabase database was changed from this branch.
