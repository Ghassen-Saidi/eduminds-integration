# Supabase validation

Run `psql "$DATABASE_URL" -f supabase/tests/checks.sql` only on a disposable
database after migrations 0001, 0002 and 0003. The checks wrap fixtures in a
transaction and roll back.

They verify a trusted failure aggregate, allow an unverified snapshot, deny a
student-authored financial failure, and reject an invalid failure code. They
do not replace live Auth, Data API, teacher-account or advisor verification.
