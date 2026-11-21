/**
 * Debounced client for the local simulation service.
 * Keeps the last good result (memory + storage) so a dropped request or an
 * unreachable service degrades to "stale", exactly like the engine's Session.
 */

const KEY = (scenario) => `edu_sim_last_${scenario}`;

export function createSimClient({
  baseUrl = '/api',
  scenario,
  fetchImpl = globalThis.fetch,
  debounceMs = 350,
  timeoutMs = 1500,
  storage = safeStorage(),
  onStatus = () => {},
} = {}) {
  let timer = null;
  let pending = null;
  let sessionId = null;
  let lastGood = read();
  let stopped = false;
  let inflight = 0;

  function safeRead() {
    try { return storage ? JSON.parse(storage.getItem(KEY(scenario)) || 'null') : null; } catch { return null; }
  }
  function read() { return safeRead(); }
  function write(result) {
    lastGood = result;
    try { storage?.setItem(KEY(scenario), JSON.stringify(result)); } catch {}
  }

  async function call(path, body, method = 'POST') {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(baseUrl + path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`sim service ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  async function ensureSession() {
    if (sessionId) return sessionId;
    const { session_id } = await call('/v1/session', { scenario });
    sessionId = session_id;
    return sessionId;
  }

  async function send(netlist) {
    inflight += 1;
    try {
      const sid = await ensureSession();
      const result = await call('/v1/simulate', { session_id: sid, netlist });
      if (result.stale) {
        onStatus({ online: true, stale: true, result });
        return result;
      }
      write(result);
      onStatus({ online: true, stale: false, result });
      return result;
    } catch (err) {
      onStatus({ online: false, stale: true, error: String(err), result: lastGood });
      return lastGood ? { ...lastGood, stale: true, offline: true } : null;
    } finally {
      inflight -= 1;
    }
  }

  return {
    update(netlist) {
      if (stopped) return;
      pending = netlist;
      clearTimeout(timer);
      timer = setTimeout(() => { const n = pending; pending = null; if (n) send(n); }, debounceMs);
    },
    async flush() {
      clearTimeout(timer);
      const n = pending; pending = null;
      return n ? send(n) : (inflight ? null : lastGood);
    },
    stop() { stopped = true; clearTimeout(timer); },
    get lastGood() { return lastGood; },
    get sessionId() { return sessionId; },
  };
}

function safeStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
