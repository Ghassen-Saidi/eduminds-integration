-- Run only on a disposable database after migrations 0001–0005.
-- All checks run inside a transaction and roll back.
\set ON_ERROR_STOP on
begin;

do $$
begin
  if has_column_privilege('authenticated', 'public.students', 'nickname', 'UPDATE') is not true then
    raise exception 'authenticated must be allowed to update students.nickname';
  end if;
  if has_column_privilege('authenticated', 'public.students', 'class_name', 'UPDATE') is true then
    raise exception 'authenticated must not be allowed to update students.class_name';
  end if;
  if has_column_privilege('authenticated', 'public.students', 'class_name', 'INSERT') is true then
    raise exception 'authenticated must not be allowed to insert students.class_name';
  end if;
  if has_column_privilege('authenticated', 'public.sessions', 'ended_at', 'UPDATE') is not true then
    raise exception 'authenticated must be allowed to end own sessions';
  end if;
  if has_column_privilege('authenticated', 'public.sessions', 'started_at', 'UPDATE') is true then
    raise exception 'authenticated must not be allowed to change sessions.started_at';
  end if;
  if has_column_privilege('authenticated', 'public.sessions', 'student_id', 'UPDATE') is true then
    raise exception 'authenticated must not be allowed to reassign sessions.student_id';
  end if;
  if has_column_privilege('authenticated', 'public.sessions', 'lab_id', 'UPDATE') is true then
    raise exception 'authenticated must not be allowed to change sessions.lab_id';
  end if;
  if has_function_privilege('anon', 'public.record_verified_simulation(uuid,uuid,text,text,jsonb)', 'EXECUTE') is true then
    raise exception 'anon must not execute record_verified_simulation';
  end if;
  if has_function_privilege('authenticated', 'public.record_verified_simulation(uuid,uuid,text,text,jsonb)', 'EXECUTE') is true then
    raise exception 'authenticated must not execute record_verified_simulation';
  end if;
  if has_function_privilege('service_role', 'public.record_verified_simulation(uuid,uuid,text,text,jsonb)', 'EXECUTE') is not true then
    raise exception 'service_role must execute record_verified_simulation';
  end if;
  if has_schema_privilege('authenticated', 'private', 'USAGE') is true then
    raise exception 'authenticated must not have access to private schema';
  end if;
  if has_table_privilege('authenticated', 'private.verified_sim_runs', 'SELECT') is true then
    raise exception 'authenticated must not read verified simulator run ledger';
  end if;
end
$$;

rollback;
