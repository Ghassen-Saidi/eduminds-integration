import test from 'node:test';
import assert from 'node:assert/strict';
import { runCase } from '../harness/chain.mjs';

const INPUT_ERROR_CODES = new Set(['INVALID_NETLIST', 'UNSUPPORTED_VERSION', 'INVALID_COMPONENT', 'DUPLICATE_ID',
  'UNKNOWN_TERMINAL', 'TERMINAL_IN_TWO_NETS', 'INVALID_PARAM', 'DOMAIN_MISMATCH']);
const codes = (out) => out.result.messages.map((m) => m.code);

/** Every case runs placements -> mapper -> netlist -> real engine -> events. */
function caseOut(name) { return runCase(`fixtures/placements/${name}.json`); }

test('every case produces a netlist the client guard accepts', () => {
  for (const name of ['tp1_all_330', 'tp1_r_220', 'tp1_missing_r', 'tp1_led_reversed', 'tp1_switch_open',
    'tp1_empty', 'tp1_blip', 'tp1_wrong_slot', 'tp1_crowded', 'tp2_correct',
    'tp2_overvoltage', 'tp2_underpowered', 'tp3_all']) {
    const out = caseOut(name);
    assert.equal(out.check.ok, true, `${name}: ${out.check.errors}`);
    assert.ok(out.result, `${name}: no engine result`);
  }
});

test('no case is ever rejected by the engine as bad input (the frozen-simulator trap)', () => {
  for (const name of ['tp1_all_330', 'tp1_r_220', 'tp1_missing_r', 'tp1_led_reversed', 'tp1_empty', 'tp1_blip']) {
    const out = caseOut(name);
    assert.notEqual(out.result.status, 'error', name);
    const bad = codes(out).filter((c) => INPUT_ERROR_CODES.has(c));
    assert.deepEqual(bad, [], `${name} produced input errors: ${bad}`);
  }
});

test('TP1 with 330 ohm: LED on at 21.1 mA, exercise complete, nothing logged', () => {
  const out = caseOut('tp1_all_330');
  const led = out.result.components.LED1;
  assert.equal(led.state, 'on');
  assert.equal(led.brightness, 1);
  assert.ok(Math.abs(led.current_a - 0.02115) < 0.0005);
  assert.equal(out.result.scenario_check.completed, true);
  assert.equal(out.result.status, 'ok');
  assert.deepEqual(out.events, []);
});

test('TP1 with 220 ohm: burned at 31.7 mA, wired correctly, one money event', () => {
  const out = caseOut('tp1_r_220');
  const led = out.result.components.LED1;
  assert.equal(led.state, 'burned');
  assert.ok(Math.abs(led.current_a - 0.03167) < 0.0005);
  assert.equal(out.result.scenario_check.built_correctly, true);
  assert.equal(out.result.scenario_check.goal_reached, false);
  const failures = out.events.filter((e) => e.row.event_type === 'failure_caused');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].row.failure_code, 'led_overcurrent');
});

test('TP2 with 1k over 330 ohm: sensor powered at 2.23 V, exercise complete', () => {
  const out = caseOut('tp2_correct');
  const sensor = out.result.components.SENSOR1;
  assert.equal(sensor.state, 'powered');
  assert.ok(Math.abs(sensor.voltage_v - 2.2276) < 0.005);
  assert.equal(out.result.scenario_check.completed, true);
  assert.equal(out.result.status, 'ok');
  assert.deepEqual(out.events, []);
});

test('TP2 with 220 over 330 ohm: sensor destroyed, wired correctly, one money event', () => {
  const out = caseOut('tp2_overvoltage');
  const sensor = out.result.components.SENSOR1;
  assert.equal(sensor.state, 'destroyed');
  assert.ok(Math.abs(sensor.voltage_v - 5.3929) < 0.01);
  assert.equal(out.result.scenario_check.built_correctly, true);
  assert.equal(out.result.scenario_check.goal_reached, false);
  const failures = out.events.filter((e) => e.row.event_type === 'failure_caused');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].row.failure_code, 'sensor_overvoltage');
});

test('TP2 with 1k over 220 ohm: underpowered hint, no money event', () => {
  const out = caseOut('tp2_underpowered');
  assert.equal(out.result.components.SENSOR1.state, 'underpowered');
  assert.ok(codes(out).includes('SENSOR_UNDERPOWERED'));
  assert.equal(out.events.filter((e) => e.row.event_type === 'failure_caused').length, 0);
  assert.equal(out.result.scenario_check.built_correctly, true);
});

test('TP1 without the resistor slot filled: open circuit, part reported missing, no money event', () => {
  const out = caseOut('tp1_missing_r');
  assert.deepEqual(out.result.scenario_check.missing, ['resistor']);
  assert.equal(out.result.components.LED1.state, 'off');
  assert.ok(codes(out).includes('MISSING_COMPONENT'));
  assert.equal(out.events.filter((e) => e.row.event_type === 'failure_caused').length, 0);
});

test('TP1 with the LED reversed: off, LED_REVERSED hint, no money event', () => {
  const out = caseOut('tp1_led_reversed');
  assert.equal(out.result.components.LED1.state, 'off');
  assert.ok(codes(out).includes('LED_REVERSED'));
  assert.ok(codes(out).includes('WIRING_DIFFERS'));
  assert.equal(out.events.filter((e) => e.row.event_type === 'failure_caused').length, 0);
});

test('TP1 with the open switch token: wired correctly, lamp off, no messages', () => {
  const out = caseOut('tp1_switch_open');
  assert.equal(out.result.components.LED1.state, 'off');
  assert.equal(out.result.scenario_check.built_correctly, true);
  assert.deepEqual(codes(out), []);
});

test('an empty mat is a warning, not an error', () => {
  const out = caseOut('tp1_empty');
  assert.ok(codes(out).includes('NO_SOURCE'));
  assert.equal(out.result.components.GND1.state, 'off');
});

test('a one-frame blip cannot put a part in the netlist', () => {
  const out = caseOut('tp1_blip');
  const ids = out.netlist.components.map((c) => c.id);
  assert.deepEqual(ids.sort(), ['BAT1', 'GND1', 'SW1']);
});

test('a token in the wrong slot is rejected and leaves that slot empty', () => {
  const out = caseOut('tp1_wrong_slot');
  assert.equal(out.mapped.rejected[0].reason, 'wrong_component_for_slot');
  assert.ok(!out.netlist.components.some((c) => c.id === 'R1'));
  assert.deepEqual(out.result.scenario_check.missing, ['led', 'resistor']);
});

test('two tokens in one slot: the closer one is used, the other is reported', () => {
  const out = caseOut('tp1_crowded');
  const r1 = out.netlist.components.find((c) => c.id === 'R1');
  assert.equal(r1.params.resistance, 220);
  assert.equal(out.mapped.rejected[0].reason, 'crowded_slot');
  assert.equal(out.result.components.LED1.state, 'burned');
});

test('TP3 (diode + buzzer): sounding, diode blocking, exercise complete', () => {
  const out = caseOut('tp3_all');
  assert.equal(out.result.components.BUZZER1.state, 'sounding');
  assert.equal(out.result.components.D1.state, 'reverse_blocking');
  assert.equal(out.result.scenario_check.completed, true);
  assert.deepEqual(out.events, []);
});
