/**
 * Glue between the student app, the camera frames, simulator and event logger.
 * The runtime owns the rolling perception window and component-ref mapping.
 */
import { stabilize } from './perception.js';
import { mapPlacements } from './mapper.js';
import { buildNetlist, instanceRefs } from './netlist.js';
import { checkNetlist } from './validate.js';
import { mapResult } from './events.js';

const FRAME_WINDOW = 5;

export function createLabRuntime({
  template, byMarker, mapping, client, logEvent, submitAttestation = () => {}, uuid,
  now = () => new Date().toISOString(), nowMs = () => Date.now(),
  snapshotThrottleMs = 2000, onRender = () => {},
}) {
  let active = false;
  let sessionId = null;
  let lastNetlist = null;
  let lastResult = null;
  let lastRefs = {};
  let frameHistory = [];
  let previousFailureKeys = new Set();
  let lastSnapshotSignature = null;
  let lastSnapshotAt = 0;

  function updateFrameHistory(input) {
    const supplied = Array.isArray(input) ? input : [];
    // Multi-frame fixture/batch mode remains supported. Live mode passes
    // place([frame]) once per captured frame.
    if (supplied.length > 1 && supplied.every(Array.isArray)) {
      frameHistory = supplied.slice(-FRAME_WINDOW).map((frame) => frame.slice());
    } else {
      const frame = supplied.length === 0
        ? []
        : (supplied.length === 1 && Array.isArray(supplied[0]) ? supplied[0] : supplied);
      frameHistory.push(frame);
      frameHistory = frameHistory.slice(-FRAME_WINDOW);
    }
    return frameHistory;
  }

  function netlistFrom(frameOrHistory) {
    const placements = stabilize(updateFrameHistory(frameOrHistory));
    const mapped = mapPlacements(placements, template, byMarker);
    return { mapped, netlist: buildNetlist(template, mapped.instances) };
  }

  function emitEvent(type, details) {
    if (typeof logEvent === 'function') logEvent(type, details);
  }

  return {
    /**
     * Live camera: call place([frame]) per processed frame.
     * Mat loss: call place([]) per processed frame while the mat is missing.
     * Tests may pass a complete array of frames.
     */
    place(frameOrHistory) {
      const { mapped, netlist } = netlistFrom(frameOrHistory);
      const check = checkNetlist(netlist);
      if (!check.ok) {
        onRender({ error: 'netlist_rejected', details: check.errors });
        return null;
      }
      lastNetlist = netlist;
      // Preserve true catalogue refs such as LED1 -> CMP018; the simulator
      // netlist intentionally contains simulator types, not catalogue refs.
      lastRefs = instanceRefs(mapped.instances);
      client.update(netlist);
      if (active) onRender({ rejected: mapped.rejected });
      return netlist;
    },

    start({ sessionId: sid, lab } = {}) {
      if (sid !== sessionId) {
        previousFailureKeys = new Set();
        lastSnapshotSignature = null;
        lastSnapshotAt = 0;
      }
      active = true;
      sessionId = sid ?? null;
      onRender({ lab: lab ?? null, started: true });
      if (lastNetlist) client.update(lastNetlist);
    },

    apply(result) {
      lastResult = result;
      const fresh = Boolean(result) && !result.stale && !result.offline;
      const messages = Array.isArray(result?.messages) ? result.messages : [];
      // Only a server-signed attestation is eligible for the trusted financial
      // event path. Plain browser-derived failure messages remain untrusted.
      if (fresh && active && sessionId && result?.attestation) {
        submitAttestation(result.attestation);
      }
      const currentFailureKeys = new Set(
        messages
          .filter((m) => mapping[m.code]?.event === 'failure_caused')
          .map((m) => `${m.code}:${m.component ?? ''}`)
      );

      // Edge-trigger failure candidates: a persistent fault is one incident,
      // not a new event on every camera frame. A cleared fault can recur.
      const messagesToMap = fresh
        ? messages.filter((m) => mapping[m.code]?.event !== 'failure_caused'
          || !previousFailureKeys.has(`${m.code}:${m.component ?? ''}`))
        : [];
      if (fresh) previousFailureKeys = currentFailureKeys;

      const rows = mapResult(
        fresh ? { ...result, messages: messagesToMap } : null,
        { sessionId, refByInstance: lastRefs, mapping, uuid, now },
      );

      for (const { row } of rows) {
        // Browser-originated financial events are deliberately not submitted.
        // A trusted server verifier must create failure_caused rows.
        if (row.event_type === 'failure_caused') continue;
        emitEvent(row.event_type, {
          failureCode: row.failure_code ?? null,
          componentRef: row.event_type === 'component_taken' ? row.component_ref ?? null : null,
          payload: row.payload,
        });
      }

      // Client snapshots are diagnostic/untrusted. Throttle them to avoid a
      // database write on every small floating-point simulation change.
      if (fresh && sessionId) {
        const snapshot = {
          source: 'student_client_unverified',
          status: result.status,
          scenario_check: result.scenario_check ?? null,
          components: result.components ?? {},
          messages,
        };
        const signature = JSON.stringify(snapshot);
        const stamp = nowMs();
        if (signature !== lastSnapshotSignature && stamp - lastSnapshotAt >= snapshotThrottleMs) {
          emitEvent('sim_result', { failureCode: null, componentRef: null, payload: snapshot });
          lastSnapshotSignature = signature;
          lastSnapshotAt = stamp;
        }
      }

      const render = {
        status: result?.status ?? 'unknown',
        messages,
        components: result?.components ?? {},
        scenarioCheck: result?.scenario_check ?? null,
        stale: Boolean(result?.stale || result?.offline),
      };
      onRender(render);
      return { rows, render };
    },

    async end() {
      active = false;
      client.stop();
      frameHistory = [];
      return lastResult;
    },

    get lastNetlist() { return lastNetlist; },
    get lastResult() { return lastResult; },
    get frameHistory() { return frameHistory.map((frame) => frame.slice()); },
  };
}
