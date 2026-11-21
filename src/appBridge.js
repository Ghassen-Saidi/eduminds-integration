/**
 * The glue the student app imports. It owns one lab session at a time:
 *   place(markerFrames)  -> stabilized placements -> netlist -> debounced sim
 *   apply(result)        -> rows for db.js logEvent + a render state for the scene
 * No DOM, no camera, no Three.js, so it is testable headlessly.
 */
import { stabilize } from './perception.js';
import { mapPlacements } from './mapper.js';
import { buildNetlist, instanceRefs } from './netlist.js';
import { checkNetlist } from './validate.js';
import { mapResult } from './events.js';

export function createLabRuntime({ template, byMarker, mapping, client, logEvent, uuid, now = () => new Date().toISOString(), onRender = () => {} }) {
  let active = false;
  let sessionId = null;
  let lastNetlist = null;
  let lastResult = null;

  function netlistFrom(frames) {
    const placements = stabilize(frames);
    const mapped = mapPlacements(placements, template, byMarker);
    const netlist = buildNetlist(template, mapped.instances);
    return { placements, mapped, netlist };
  }

  return {
    /** Called on every vision frame while a lab is open. Returns the netlist it sent (or null). */
    place(frames) {
      const { netlist, mapped } = netlistFrom(frames);
      const check = checkNetlist(netlist);
      if (!check.ok) {
        onRender({ error: 'netlist_rejected', details: check.errors });
        return null;                       // never send a netlist the service will reject as input
      }
      lastNetlist = netlist;
      if (!active) { client.update(netlist); return netlist; }
      client.update(netlist);
      onRender({ rejected: mapped.rejected });
      return netlist;
    },

    start({ sessionId: sid, lab } = {}) {
      active = true;
      sessionId = sid ?? null;
      onRender({ lab: lab ?? null, started: true });
      if (lastNetlist) client.update(lastNetlist);
    },

    /** Feed a simulation result through the event mapping into db.js logEvent. */
    apply(result) {
      lastResult = result;
      const refByInstance = lastNetlist
        ? instanceRefs(lastNetlist.components.map((c) => ({ instance: c.id, ref: c.id })))
        : {};
      const rows = mapResult(result, { sessionId, refByInstance, mapping, uuid, now });
      for (const { row } of rows) {
        const { event_type, failure_code, payload } = row;
        logEvent(event_type, {
          failureCode: failure_code ?? null,
          componentRef: event_type === 'component_taken' ? row.component_ref ?? null : null,
          payload,
        });
      }
      const render = {
        status: result.status,
        messages: result.messages,
        components: result.components,
        scenarioCheck: result.scenario_check,
        stale: Boolean(result.stale),
      };
      onRender(render);
      return { rows, render };
    },

    async end() {
      active = false;
      client.stop();
      return lastResult;
    },

    get lastNetlist() { return lastNetlist; },
    get lastResult() { return lastResult; },
  };
}
