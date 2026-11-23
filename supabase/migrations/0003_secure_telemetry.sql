-- 0003 — restrict client event writes and scope teacher analytics to assigned classes.
-- A financial failure event must be created by a trusted server-side verifier.

create table if not exists teacher_classes (
  teacher_id uuid not null references teachers(user_id) on delete cascade,
  class_name text not null,
  primary key (teacher_id, class_name)
);
alter table teacher_classes enable row level security;

drop policy if exists "teacher reads own record" on teachers;
create policy "teacher reads own record" on teachers
  for select to authenticated using (user_id = (select auth.uid()));
create policy "teacher reads own class assignments" on teacher_classes
  for select to authenticated using (teacher_id = (select auth.uid()));

drop policy if exists "student reads own record" on students;
drop policy if exists "student inserts own record" on students;
drop policy if exists "student updates own record" on students;
drop policy if exists "teacher reads assigned students" on students;
create policy "student reads own record" on students
  for select to authenticated using (id = (select auth.uid()));
create policy "teacher reads assigned students" on students
  for select to authenticated using (
    exists (select 1 from teacher_classes tc
      where tc.teacher_id = (select auth.uid()) and tc.class_name = students.class_name));
create policy "student inserts own record" on students
  for insert to authenticated with check (id = (select auth.uid()));
create policy "student updates own record" on students
  for update to authenticated using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "student reads own sessions" on sessions;
drop policy if exists "student inserts own sessions" on sessions;
drop policy if exists "student updates own sessions" on sessions;
drop policy if exists "teacher reads assigned sessions" on sessions;
create policy "student reads own sessions" on sessions
  for select to authenticated using (student_id = (select auth.uid()));
create policy "teacher reads assigned sessions" on sessions
  for select to authenticated using (
    exists (select 1 from students st
      join teacher_classes tc on tc.class_name = st.class_name
      where st.id = sessions.student_id and tc.teacher_id = (select auth.uid())));
create policy "student inserts own sessions" on sessions
  for insert to authenticated with check (student_id = (select auth.uid()));
create policy "student updates own sessions" on sessions
  for update to authenticated using (student_id = (select auth.uid()))
  with check (student_id = (select auth.uid()));

drop policy if exists "student reads own events" on events;
drop policy if exists "student inserts own events" on events;
drop policy if exists "teacher reads assigned events" on events;
create policy "student reads own events" on events
  for select to authenticated using (
    exists (select 1 from sessions s
      where s.id = events.session_id and s.student_id = (select auth.uid())));
create policy "teacher reads assigned events" on events
  for select to authenticated using (
    exists (select 1 from sessions s
      join students st on st.id = s.student_id
      join teacher_classes tc on tc.class_name = st.class_name
      where s.id = events.session_id and tc.teacher_id = (select auth.uid())));

-- Remove the old broad insert policy before creating the limited policy.
drop policy if exists "student inserts own events" on events;
create policy "students insert nonfinancial telemetry" on events
  for insert to authenticated with check (
    event_type in ('lab_started', 'component_taken', 'hint_used', 'lab_ended', 'sim_result')
    and exists (select 1 from sessions s
      where s.id = events.session_id and s.student_id = (select auth.uid())));

grant select on teachers, teacher_classes to authenticated;
revoke insert, update, delete on teacher_classes from anon, authenticated;
grant all on teacher_classes to service_role;

create index if not exists students_class_name_idx on students (class_name);
create index if not exists sessions_student_id_idx on sessions (student_id);
create index if not exists sessions_lab_id_idx on sessions (lab_id);
create index if not exists events_component_ref_idx on events (component_ref);
create index if not exists events_failure_code_idx on events (failure_code);
create index if not exists failure_types_component_ref_idx on failure_types (component_ref);
create index if not exists teacher_classes_class_name_idx on teacher_classes (class_name);
