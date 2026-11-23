/**
 * Bounded coalescing simulator client.
 * A continuous camera stream cannot starve requests, and only one request is
 * in flight so an older result cannot overwrite a newer one.
 */
const KEY = (scenario) => `edu_sim_last_${scenario}`;

export function createSimClient({
  baseUrl = '/api', scenario, fetchImpl = globalThis.fetch,
  debounceMs = 350, timeoutMs = 1500, storage = safeStorage(), onStatus = () => {},
  applicationSessionId = null,
} = {}) {
  let timer = null;
  let pending = null;
  let sessionId = null;
  let lastGood = read();
  let stopped = false;
  let sending = null;
  const controllers = new Set();

  function safeRead() {
    try { return storage ? JSON.parse(storage.getItem(KEY(scenario)) || 'null') : null; }
    catch { return null; }
  }
  function read() { return safeRead(); }
  function write(result) {
    lastGood = result;
    try { storage?.setItem(KEY(scenario), JSON.stringify(result)); } catch {}
  }

  async function call(path, body, method = 'POST') {
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(baseUrl + path, {
        method, headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`sim service ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  }

  async function ensureSession() {
    if (sessionId) return sessionId;
    const { session_id } = await call('/v1/session', {
      scenario,
      ...(applicationSessionId ? { application_session_id: applicationSessionId } : {}),
    });
    if (!session_id) throw new Error('sim service did not return a session_id');
    sessionId = session_id;
    return sessionId;
  }

  async function perform(netlist) {
    try {
      const sid = await ensureSession();
      if (stopped) return lastGood;
      const result = await call('/v1/simulate', { session_id: sid, netlist });
      if (stopped) return lastGood;
      if (result.stale) {
        onStatus({ online: true, stale: true, result });
        return result;
      }
      write(result);
      onStatus({ online: true, stale: false, result });
      return result;
    } catch (err) {
      if (!stopped) onStatus({ online: false, stale: true, error: String(err), result: lastGood });
      return lastGood ? { ...lastGood, stale: true, offline: true } : null;
    }
  }

  function schedule() {
    if (stopped || timer !== null || sending || !pending) return;
    timer = setTimeout(() => {
      timer = null;
      void drain();
    }, debounceMs);
  }

  function drain() {
    if (sending) return sending;
    if (stopped || !pending) return Promise.resolve(lastGood);
    const netlist = pending;
    pending = null;
    const request = perform(netlist);
    sending = request;
    request.finally(() => {
      if (sending === request) sending = null;
      if (pending && !stopped) schedule();
    }).catch(() => {});
    return request;
  }

  return {
    update(netlist) {
      if (stopped) return;
      pending = netlist;
      // Do not reset an existing timer: its deadline is bounded by first update.
      schedule();
    },

    async flush() {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      if (sending) await sending;
      if (timer !== null) { clearTimeout(timer); timer = null; }
      if (pending && !stopped) return drain();
      return lastGood;
    },

    stop() {
      stopped = true;
      pending = null;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      for (const controller of controllers) controller.abort();
      controllers.clear();
    },

    get lastGood() { return lastGood; },
    get sessionId() { return sessionId; },
    get pending() { return pending !== null; },
    get inFlight() { return sending !== null; },
  };
}

function safeStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; }
  catch { return null; }
}
