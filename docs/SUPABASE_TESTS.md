# Supabase validation

Run these checks only against a disposable database, never against production:

```bash
psql "$DATABASE_URL" -f supabase/tests/checks.sql
psql "$DATABASE_URL" -f supabase/tests/rls_hardening.sql
```

`checks.sql` verifies a trusted failure aggregate, allows an unverified
snapshot, denies a student-authored financial failure, and rejects an invalid
failure code. It applies after migrations 0001–0003.

`rls_hardening.sql` verifies the column-level student/session grants and
server-only simulator function introduced by migration 0005. Run it after
migrations 0001–0005.

Neither file replaces live Auth, Data API, anonymous-user, teacher-account,
Edge Function secret, or Supabase advisor verification. These must still be
tested against the intended active project after deployment.
