/**
 * Simulator result -> rows for the Supabase `events` table.
 *
 * Database constraints drive two rules: only 'component_taken' carries
 * component_ref, and 'failure_caused' carries a failure_code that must exist in
 * failure_types. Everything else becomes 'hint_used' with the details in
 * payload, so the "money saved" views stay honest.
 */

export function mapResult(result, { sessionId, refByInstance = {}, mapping, uuid, now = () => new Date().toISOString() }) {
  const events = [];
  if (!result || !Array.isArray(result.messages)) return events;
  const seen = new Set();

  for (const m of result.messages) {
    const rule = mapping[m.code];
    if (!rule || !rule.event) continue;
    const key = `${m.code}:${m.component ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const instance = m.component ?? null;
    const componentRef = instance ? refByInstance[instance] ?? null : null;
    const row = {
      id: uuid(),
      session_id: sessionId,
      event_type: rule.event,
      occurred_at: now(),
      payload: {
        code: m.code,
        severity: m.severity,
        text: m.text,
        instance,
        component_ref: componentRef,
        hint: m.hint ?? null,
      },
    };
    if (rule.event === 'component_taken' && componentRef) row.component_ref = componentRef;
    if (rule.failure_code) row.failure_code = rule.failure_code;
    events.push({ table: 'events', row });
  }
  return events;
}

export function parseEventMap(text) {
  return JSON.parse(text);
}
