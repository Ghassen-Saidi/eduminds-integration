-- 0001 (rebuilt) — base schema for the EduMinds telemetry layer.
-- Reconstructed from the app data contract and project documentation.

create table if not exists labs (
  id int primary key,
  code text not null unique,
  title_fr text not null,
  sub_fr text,
  scenario text
);
create table if not exists components (
  ref text primary key,
  name_fr text not null,
  category text,
  unit_price_tnd numeric(10,2) not null check (unit_price_tnd >= 0)
);
create table if not exists failure_types (
  code text primary key,
  component_ref text references components(ref),
  label_fr text not null
);
create table if not exists students (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null,
  class_name text,
  created_at timestamptz not null default now()
);
create table if not exists teachers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text
);
create table if not exists sessions (
  id uuid primary key,
  student_id uuid not null references students(id) on delete cascade,
  lab_id int not null references labs(id),
  device text,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create table if not exists events (
  id uuid primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  event_type text not null,
  component_ref text references components(ref),
  failure_code text references failure_types(code),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint events_event_type_check check (event_type in
    ('lab_started', 'component_taken', 'failure_caused', 'hint_used', 'lab_ended')),
  constraint component_matches_type check ((event_type = 'component_taken') = (component_ref is not null)),
  constraint failure_matches_type check ((event_type = 'failure_caused') = (failure_code is not null))
);
create index if not exists events_session_idx on events (session_id, occurred_at);
create index if not exists events_type_idx on events (event_type);

create or replace view failures_prevented with (security_invoker = true) as
select ft.component_ref, count(*)::int as failures, sum(c.unit_price_tnd) as saved_tnd
from events e join failure_types ft on ft.code = e.failure_code
left join components c on c.ref = ft.component_ref
where e.event_type = 'failure_caused'
group by ft.component_ref;

create or replace view completed_tps_summary with (security_invoker = true) as
select s.lab_id,
       count(distinct s.id) filter (where s.ended_at is not null) as sessions_completed,
       count(distinct s.id) as sessions_started,
       avg(extract(epoch from (s.ended_at - s.started_at))) filter (where s.ended_at is not null) as avg_duration_s,
       count(e.id) filter (where e.event_type = 'failure_caused') as failures
from sessions s left join events e on e.session_id = s.id
group by s.lab_id;

create or replace view common_mistakes with (security_invoker = true) as
select ft.code, ft.label_fr, ft.component_ref, count(*)::int as occurrences
from events e join failure_types ft on ft.code = e.failure_code
where e.event_type = 'failure_caused'
group by ft.code, ft.label_fr, ft.component_ref
order by occurrences desc;

create or replace view student_progress with (security_invoker = true) as
select st.id as student_id, st.nickname, st.class_name,
       count(distinct s.id) as sessions,
       count(distinct s.lab_id) filter (where s.ended_at is not null) as labs_completed,
       count(e.id) filter (where e.event_type = 'failure_caused') as mistakes,
       max(s.started_at) as last_seen
from students st
left join sessions s on s.student_id = st.id
left join events e on e.session_id = s.id
group by st.id, st.nickname, st.class_name;

alter table students enable row level security;
alter table teachers enable row level security;
alter table sessions enable row level security;
alter table events enable row level security;
alter table labs enable row level security;
alter table components enable row level security;
alter table failure_types enable row level security;

create policy "student reads own record" on students
  for select to authenticated using (id = (select auth.uid()));
create policy "student inserts own record" on students
  for insert to authenticated with check (id = (select auth.uid()));
create policy "student updates own record" on students
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "student reads own sessions" on sessions
  for select to authenticated using (student_id = (select auth.uid()));
create policy "student inserts own sessions" on sessions
  for insert to authenticated with check (student_id = (select auth.uid()));
create policy "student updates own sessions" on sessions
  for update to authenticated using (student_id = (select auth.uid())) with check (student_id = (select auth.uid()));

create policy "student reads own events" on events
  for select to authenticated using (
    exists (select 1 from sessions s where s.id = events.session_id and s.student_id = (select auth.uid())));
create policy "student inserts own events" on events
  for insert to authenticated with check (
    exists (select 1 from sessions s where s.id = events.session_id and s.student_id = (select auth.uid())));

create policy "reference data is readable" on labs
  for select to anon, authenticated using (true);
create policy "reference data is readable" on components
  for select to anon, authenticated using (true);
create policy "reference data is readable" on failure_types
  for select to anon, authenticated using (true);

grant usage on schema public to anon, authenticated;
grant select on labs, components, failure_types to anon, authenticated;
grant select, insert, update on students, sessions to authenticated;
grant select, insert on events to authenticated;
grant select on failures_prevented, completed_tps_summary, common_mistakes, student_progress to authenticated;
grant all on labs, components, failure_types, students, teachers, sessions, events to service_role;

insert into labs (id, code, title_fr, sub_fr, scenario) values
  (1, 'led_resistor', 'TP 1 · LED + résistance', 'Loi d''Ohm : la LED brûle sans résistance', 'ex1_led_series'),
  (3, 'diode_buzzer', 'TP 3 · Diode + buzzer', 'Une diode de protection : le sens compte', 'ex2_diode_buzzer')
on conflict (id) do nothing;
insert into components (ref, name_fr, category, unit_price_tnd) values
  ('CMP063', 'Pile 9 V', 'Alimentation et protection', 36.86),
  ('CMP059', 'Alimentation DC de laboratoire 12 V', 'Alimentation et protection', 429.49),
  ('CMP018', 'LED rouge', 'Semi-conducteurs', 0.50),
  ('CMP024', 'Diode de redressement', 'Semi-conducteurs', 4.13),
  ('CMP045', 'Buzzer', 'Actionneurs', 6.14),
  ('CMP038', 'Interrupteur à bascule', 'Interrupteurs et relais', 18.51),
  ('CMP003', 'Résistance 220 Ω', 'Composants passifs', 0.10),
  ('CMP005', 'Résistance 1 kΩ', 'Composants passifs', 0.10),
  ('CMP004', 'Résistance 330 Ω', 'Composants passifs', 0.10)
on conflict (ref) do nothing;
insert into failure_types (code, component_ref, label_fr) values
  ('led_overcurrent', 'CMP018', 'LED en surintensité'),
  ('short_circuit', null, 'Court-circuit'),
  ('sensor_overvoltage', null, 'Capteur en surtension')
on conflict (code) do nothing;
