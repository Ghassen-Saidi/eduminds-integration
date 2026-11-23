-- 0005 — restrict student-controlled columns and establish a trusted simulator attestation path.
-- Apply only after 0001_rebuild, 0002_sim_state and 0003_secure_telemetry.
-- This migration intentionally does not assign students to classes; a trusted
-- teacher/admin workflow must populate students.class_name and teacher_classes.

-- Column-level grants prevent a student from changing their class assignment,
-- creating timestamps, or altering lab/session ownership through the Data API.
revoke insert, update on table public.students from public, anon, authenticated;
grant select on table public.students to authenticated;
grant insert (id, nickname) on table public.students to authenticated;
grant update (nickname) on table public.students to authenticated;

-- Sessions are created with caller identity checked by the existing RLS policy.
-- started_at remains database-generated (DEFAULT now()). The client can only
-- set ended_at; the trigger below replaces its value with the database clock.
revoke insert, update on table public.sessions from public, anon, authenticated;
grant select on table public.sessions to authenticated;
grant insert (id, student_id, lab_id, device) on table public.sessions to authenticated;
grant update (ended_at) on table public.sessions to authenticated;

create or replace function public.enforce_session_ended_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.ended_at is not null then
    raise exception 'session is already ended' using errcode = '23514';
  end if;
  if new.ended_at is null then
    raise exception 'ended_at cannot be cleared' using errcode = '23514';
  end if;
  new.ended_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

drop trigger if exists sessions_enforce_server_ended_at on public.sessions;
create trigger sessions_enforce_server_ended_at
before update of ended_at on public.sessions
for each row execute function public.enforce_session_ended_at();

revoke all on function public.enforce_session_ended_at() from public, anon, authenticated;

-- A non-exposed ledger makes each signed simulator run idempotent.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table if not exists private.verified_sim_runs (
  run_id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  scenario text not null,
  attestation_sha256 text not null check (attestation_sha256 ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table private.verified_sim_runs enable row level security;
revoke all on table private.verified_sim_runs from public, anon, authenticated;
grant select, insert on table private.verified_sim_runs to service_role;

-- The Edge Function is the only caller granted EXECUTE. It verifies the
-- simulator HMAC and the authenticated session owner before invoking this
-- function. The database repeats scenario/code checks and performs writes
-- atomically, so a run ID cannot be replayed to inflate failure statistics.
create or replace function public.record_verified_simulation(
  p_run_id uuid,
  p_session_id uuid,
  p_scenario text,
  p_attestation_sha256 text,
  p_failures jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
  v_item record;
  v_failure_code text;
  v_component_ref text;
  v_inserted integer := 0;
begin
  if p_run_id is null or p_session_id is null or p_scenario is null then
    raise exception 'missing signed simulation identity' using errcode = '22023';
  end if;
  if p_attestation_sha256 is null or p_attestation_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid attestation digest' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_failures) is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_failures) > 100 then
    raise exception 'invalid failure list' using errcode = '22023';
  end if;
  if not exists (
    select 1
      from public.sessions s
      join public.labs l on l.id = s.lab_id
     where s.id = p_session_id
       and s.ended_at is null
       and l.scenario = p_scenario
  ) then
    raise exception 'simulator scenario does not match the database session' using errcode = '23514';
  end if;

  insert into private.verified_sim_runs
    (run_id, session_id, scenario, attestation_sha256)
  values
    (p_run_id, p_session_id, p_scenario, p_attestation_sha256)
  on conflict (run_id) do nothing;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return pg_catalog.jsonb_build_object('duplicate', true, 'events_inserted', 0);
  end if;

  for v_item in
    select distinct entry.value->>'code' as simulator_code,
                    nullif(entry.value->>'component', '') as simulator_component
      from pg_catalog.jsonb_array_elements(p_failures) as entry(value)
  loop
    v_failure_code := case v_item.simulator_code
      when 'LED_OVERCURRENT' then 'led_overcurrent'
      when 'SHORT_CIRCUIT' then 'short_circuit'
      when 'SHORT_CIRCUIT_CURRENT' then 'short_circuit'
      when 'SENSOR_OVERVOLTAGE' then 'sensor_overvoltage'
      else null
    end;

    if v_failure_code is null then
      raise exception 'simulator code is not a financial failure code: %', v_item.simulator_code
        using errcode = '22023';
    end if;

    select ft.component_ref
      into v_component_ref
      from public.failure_types ft
     where ft.code = v_failure_code;

    if not found then
      raise exception 'failure code is not present in failure_types: %', v_failure_code
        using errcode = '23503';
    end if;

    insert into public.events (
      id, session_id, event_type, failure_code, payload, occurred_at
    ) values (
      pg_catalog.gen_random_uuid(),
      p_session_id,
      'failure_caused',
      v_failure_code,
      pg_catalog.jsonb_build_object(
        'source', 'signed_simulator_attestation',
        'run_id', p_run_id,
        'scenario', p_scenario,
        'simulator_code', v_item.simulator_code,
        'simulator_component', v_item.simulator_component,
        'component_ref', v_component_ref,
        'attestation_sha256', p_attestation_sha256
      ),
      pg_catalog.clock_timestamp()
    );
    v_inserted := v_inserted + 1;
  end loop;

  return pg_catalog.jsonb_build_object('duplicate', false, 'events_inserted', v_inserted);
end;
$$;

revoke all on function public.record_verified_simulation(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_verified_simulation(uuid, uuid, text, text, jsonb)
  to service_role;
