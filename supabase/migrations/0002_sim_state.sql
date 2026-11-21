-- 0002 — allow the diagnostic simulator snapshot alongside the app events.
alter table events drop constraint if exists events_event_type_check;
alter table events add constraint events_event_type_check check (event_type in
  ('lab_started', 'component_taken', 'failure_caused', 'hint_used', 'lab_ended', 'sim_result'));
comment on column events.payload is
  'sim_result rows: unverified diagnostic snapshot {status, scenario_check, components, messages}';
