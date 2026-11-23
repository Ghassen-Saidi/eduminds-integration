-- Run with: psql "$DATABASE_URL" -f supabase/tests/checks.sql
-- On a disposable database after migrations 0001, 0002 and 0003.
-- This file is not a production migration and all fixture data is rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id) values ('00000000-0000-4000-8000-000000000001') on conflict do nothing;
insert into students (id, nickname, class_name)
  values ('00000000-0000-4000-8000-000000000001', 'Test', '1A') on conflict do nothing;
insert into sessions (id, student_id, lab_id)
  values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000001', 1) on conflict do nothing;

-- Simulate a trusted financial writer to test the aggregate view.
insert into events (id, session_id, event_type, failure_code)
  values ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000000aa',
          'failure_caused', 'led_overcurrent') on conflict do nothing;

do $$
declare saved numeric;
begin
  select saved_tnd into saved from failures_prevented where component_ref = 'CMP018';
  if saved is null or saved <> 0.50 then
    raise exception 'failures_prevented expected 0.50 for CMP018, got %', saved;
  end if;
end $$;

-- Browser-authenticated students may submit unverified snapshots but cannot
-- forge the event counted as money saved.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

do $$
begin
  begin
    insert into events (id, session_id, event_type, failure_code)
      values ('00000000-0000-4000-8000-0000000000ee', '00000000-0000-4000-8000-0000000000aa',
              'failure_caused', 'led_overcurrent');
    raise exception 'client was allowed to insert a financial failure event';
  exception when insufficient_privilege then
    null; -- expected RLS denial
  end;
end $$;

insert into events (id, session_id, event_type, payload)
  values ('00000000-0000-4000-8000-0000000000ef', '00000000-0000-4000-8000-0000000000aa',
          'sim_result', '{"source":"student_client_unverified","status":"ok"}'::jsonb);
reset role;

do $$
begin
  begin
    insert into events (id, session_id, event_type, failure_code)
      values ('00000000-0000-4000-8000-0000000000dd', '00000000-0000-4000-8000-0000000000aa',
              'failure_caused', 'made_up_code');
    raise exception 'an unknown failure_code was accepted';
  exception when foreign_key_violation then
    null;
  end;
end $$;

rollback;
