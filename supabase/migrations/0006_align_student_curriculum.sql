-- 0006 — align live catalogue and lab registry with the student application.
-- Prices are copied from the uploaded student app's catalogue; estimated values remain estimates.
insert into public.components(ref,name_fr,category,unit_price_tnd) values
 ('CMP001','Résistance 10 Ω','Composants passifs',0.10),
 ('CMP007','Résistance 10 kΩ','Composants passifs',0.10),
 ('CMP011','Potentiomètre 10 kΩ','Composants passifs',3.72),
 ('CMP039','Interrupteur à glissière','Interrupteurs et relais',6.47),
 ('CMP065','Régulateur de tension 3,3 V','Alimentation et protection',46.03),
 ('CMP068','Fusible 500 mA','Alimentation et protection',0.80),
 ('CMP083','Capteur analogique 3,3 V','Capteurs',8.00)
on conflict(ref) do update set name_fr=excluded.name_fr,category=excluded.category,unit_price_tnd=excluded.unit_price_tnd;

update public.labs set code='led_resistor', title_fr='TP 1 · LED + résistance',
 sub_fr='Loi d’Ohm : protéger une LED alimentée en 12 V', scenario='ex1_led_series' where id=1;
update public.labs set code='divider_sensor', title_fr='TP 2 · Régulateur 3,3 V + potentiomètre',
 sub_fr='Alimenter et ajuster un capteur analogique 3,3 V depuis une alimentation 12 V',
 scenario='ex4_divider_sensor' where id=2;
update public.labs set code='short_circuit', title_fr='TP 3 · Court-circuit et fusible',
 sub_fr='Comprendre le rôle du fusible et éviter un court-circuit',
 scenario='ex5_short_circuit' where id=3;

update public.failure_types set component_ref='CMP018' where code='led_overcurrent';
update public.failure_types set component_ref='CMP068' where code='short_circuit';
update public.failure_types set component_ref='CMP083' where code='sensor_overvoltage';

create index if not exists verified_sim_runs_session_id_idx on private.verified_sim_runs(session_id);
