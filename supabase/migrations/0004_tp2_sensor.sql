-- 0004 — reference data for TP 2 (divider + 3.3 V sensor).
-- Data only: no schema change. Prices and the catalogue ref CMP070 are
-- estimates to confirm against the course catalogue before the demo.

insert into labs (id, code, title_fr, sub_fr, scenario) values
  (2, 'divider_sensor', 'TP 2 · Diviseur + capteur 3,3 V',
   'Diviseur de tension : alimenter un capteur 3,3 V depuis 9 V', 'ex4_divider_sensor')
on conflict (id) do nothing;

insert into components (ref, name_fr, category, unit_price_tnd) values
  ('CMP070', 'Capteur 3,3 V (module)', 'Capteurs', 12.50)
on conflict (ref) do nothing;

-- the failure now has a part to price in failures_prevented
update failure_types set component_ref = 'CMP070'
 where code = 'sensor_overvoltage' and component_ref is null;
