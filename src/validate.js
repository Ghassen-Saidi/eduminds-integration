/**
 * Client-side guard for the netlist contract.
 * The simulator treats an unknown terminal as bad input and its session wrapper
 * then returns the previous result, so a builder that leaves an empty slot's
 * terminals in the nets looks like a frozen UI. Refuse to send that.
 */

const TERMINAL_TYPES = new Set(['battery', 'switch', 'resistor', 'led', 'diode', 'buzzer', 'ground', 'arduino_uno', 'hc_sr04', 'lcd_16x2']);

export function checkNetlist(netlist) {
  const errors = [];
  if (!netlist || typeof netlist !== 'object') return { ok: false, errors: ['not an object'] };
  if (netlist.schema_version !== '0.2') errors.push(`schema_version must be "0.2", got ${JSON.stringify(netlist.schema_version)}`);
  if (!Array.isArray(netlist.components)) errors.push('components must be an array');
  if (!Array.isArray(netlist.nets)) errors.push('nets must be an array');
  if (errors.length) return { ok: false, errors };

  const byId = new Map();
  for (const c of netlist.components) {
    if (!c || typeof c.id !== 'string' || typeof c.type !== 'string') { errors.push('a component is missing id or type'); continue; }
    if (byId.has(c.id)) errors.push(`duplicate component id ${c.id}`);
    if (!TERMINAL_TYPES.has(c.type)) errors.push(`unknown component type ${c.type} (${c.id})`);
    byId.set(c.id, c);
  }
  const seen = new Map();
  for (const net of netlist.nets) {
    if (!net || typeof net.id !== 'string' || !Array.isArray(net.connections)) { errors.push('a net is malformed'); continue; }
    for (const t of net.connections) {
      const id = String(t).split('.')[0];
      if (!byId.has(id)) errors.push(`net ${net.id} references ${t}, but ${id} is not in components`);
      if (seen.has(t) && seen.get(t) !== net.id) errors.push(`terminal ${t} is in two nets`);
      seen.set(t, net.id);
    }
  }
  return { ok: errors.length === 0, errors };
}
