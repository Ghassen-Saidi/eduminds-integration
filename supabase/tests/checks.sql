-- Run with: psql "$DATABASE_URL" -f supabase/tests/checks.sql
-- Against a scratch database after 0001 (schema + seed) and 0002.
-- NOT verified from the sandbox: no Postgres was reachable here.

\set ON_ERROR_STOP on
begin;

-- one virtual burnt LED, for a student and a session
insert into auth.users (id) values ('00000000-0000-4000-8000-000000000001') on conflict do nothing;
insert into students (id, nickname, class_name)
  values ('00000000-0000-4000-8000-000000000001', 'Test', '1A') on conflict do nothing;
insert into sessions (id, student_id, lab_id)
  values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000001', 1) on conflict do nothing;
insert into events (id, session_id, event_type, failure_code)
  values ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000000aa',
          'failure_caused', 'led_overcurrent') on conflict do nothing;

-- failures_prevented must price one burnt red LED at its unit price (0.50 TND)
do $$
declare saved numeric;
begin
  select saved_tnd into saved from failures_prevented where component_ref = 'CMP018';
  if saved is null or saved <> 0.50 then
    raise exception 'failures_prevented expected 0.50 for CMP018, got %', saved;
  end if;
end $$;

-- a sim_result row must be accepted, and a failure row must not need component_ref
insert into events (id, session_id, event_type, payload)
  values ('00000000-0000-4000-8000-0000000000cc', '00000000-0000-4000-8000-0000000000aa',
          'sim_result', '{"status":"ok","components":{"LED1":{"state":"on","current_a":0.0211}}}'::jsonb);

-- an unknown failure code must be refused by the foreign key
do $$
begin
  begin
    insert into events (id, session_id, event_type, failure_code)
      values ('00000000-0000-4000-8000-0000000000dd', '00000000-0000-4000-8000-0000000000aa',
              'failure_caused', 'made_up_code');
    raise exception 'an unknown failure_code was accepted';
  exception when foreign_key_violation then
    null;   -- expected
  end;
end $$;

rollback;
