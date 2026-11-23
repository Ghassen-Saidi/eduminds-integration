-- 0004 — reference data for TP 2 (divider + 3.3 V sensor).
-- Data only: no schema change. CMP083 matches the student-app catalogue;
-- its 8.00 TND price remains estimated and must be confirmed.

insert into labs (id, code, title_fr, sub_fr, scenario) values
  (2, 'divider_sensor', 'TP 2 · Diviseur + capteur 3,3 V',
   'Diviseur de tension : alimenter un capteur 3,3 V depuis 9 V', 'ex4_divider_sensor')
on conflict (id) do nothing;

insert into components (ref, name_fr, category, unit_price_tnd) values
  ('CMP083', 'Capteur analogique 3,3 V', 'Capteurs', 8.00)
on conflict (ref) do nothing;

-- the failure now has a part to price in failures_prevented
update failure_types set component_ref = 'CMP083'
 where code = 'sensor_overvoltage' and component_ref is null;
