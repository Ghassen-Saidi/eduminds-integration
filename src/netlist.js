/**
 * Template + instances -> Netlist v0.2 (the simulator's schema, unchanged).
 * Empty slots lose their component AND every terminal reference to it: the
 * simulator reports an unknown terminal as bad input, and its session wrapper
 * then silently keeps the previous result.
 */

const POLARITY_SWAP = {
  led: ['anode', 'cathode'],
  diode: ['anode', 'cathode'],
  battery: ['pos', 'neg'],
  buzzer: ['pos', 'neg'],
  hc_sr04: ['VCC', 'GND'],
};

export function buildNetlist(template, instances, { domain = 'analog' } = {}) {
  const filled = new Map(instances.map((i) => [i.instance, i]));
  const components = [
    ...(template.fixed ?? []).map((c) => ({ id: c.id, type: c.type, params: { ...c.params } })),
    ...template.slots
      .filter((s) => filled.has(s.instance))
      .map((s) => {
        const i = filled.get(s.instance);
        return { id: s.instance, type: i.type, params: { ...i.params } };
      }),
  ];

  const present = new Set(components.map((c) => c.id));
  const swapped = new Set(instances.filter((i) => i.flipped && POLARITY_SWAP[i.type]).map((i) => i.instance));

  const terminalName = (raw) => {
    const [id, terminal] = raw.split('.');
    if (!swapped.has(id)) return raw;
    const pair = POLARITY_SWAP[filled.get(id).type];
    if (!pair) return raw;
    if (terminal === pair[0]) return `${id}.${pair[1]}`;
    if (terminal === pair[1]) return `${id}.${pair[0]}`;
    return raw;
  };

  const nets = template.nets
    .map((net) => ({ id: net.id, connections: net.connections.filter((c) => present.has(c.split('.')[0])).map(terminalName) }))
    .filter((net) => net.connections.length > 1);

  return { schema_version: '0.2', scenario: template.scenario, domain, components, nets };
}

export function instanceRefs(instances) {
  return Object.fromEntries(instances.map((i) => [i.instance, i.ref]));
}
