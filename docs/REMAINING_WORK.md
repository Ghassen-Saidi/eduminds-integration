# Remaining integration work

## Automated in this branch
- Rebuild print assets before Node tests on a clean checkout.
- Test rolling 3-of-5 camera history and mat-loss ageing.
- Test bounded coalescing and single-flight simulation requests, including abort on stop.
- Test catalogue reference mapping, failure edge-triggering and throttled diagnostic snapshots.
- Test simulator session behavior, configured bearer auth and per-IP rate limits.
- Review migrations 0001–0003 and SQL assertions; these have not been applied to a live database.

## Still requires external access or physical testing
- Identify the correct active Supabase project and inspect its real schema, migration history, Auth configuration, Data API exposure, logs and advisors.
- Apply the migrations only after reconciling them with that live schema; the connected projects visible here are inactive.
- Provide the student-app repository so its camera callback and database integration can be verified in context.
- Implement a trusted server-side simulator verifier/event writer; browser clients intentionally cannot insert financial failure rows.
- Provision teacher-to-class assignments from a trusted administrative path and test with real teacher/student accounts.
- Physically test a phone, printed A3 mat and tokens, camera permission, sensors, mat-loss and network recovery.
- Test the service behind the intended authenticated tunnel/reverse proxy.

No live Supabase database was changed from this branch.
