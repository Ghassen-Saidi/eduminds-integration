-- 0002 — let the app store a simulator snapshot next to the events it already logs.
-- Team 3's result is richer than the three failure codes: brightness, per-part
-- voltage and current, and the exercise check. Without this, that is thrown away.
-- Review before applying: it widens an existing check constraint.

alter table events drop constraint if exists events_event_type_check;

alter table events add constraint events_event_type_check check (event_type in
  ('lab_started', 'component_taken', 'failure_caused', 'hint_used', 'lab_ended', 'sim_result'));

-- component_ref stays null for sim_result: payload.components carries the state.
comment on column events.payload is
  'sim_result rows: {status, scenario_check, components:{id:{state,voltage_v,current_a,brightness}}}';
