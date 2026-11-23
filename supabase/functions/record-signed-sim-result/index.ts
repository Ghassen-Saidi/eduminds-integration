import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FAILURE_CODES = new Set([
  "LED_OVERCURRENT",
  "SHORT_CIRCUIT",
  "SHORT_CIRCUIT_CURRENT",
  "SENSOR_OVERVOLTAGE",
]);
const encoder = new TextEncoder();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(message: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(message));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse(405, { error: "method_not_allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const attestationSecret = Deno.env.get("EDUMINDS_ATTESTATION_SECRET");
  if (!supabaseUrl || !publishableKey || !serviceRoleKey || !attestationSecret) {
    return jsonResponse(500, { error: "server_configuration_incomplete" });
  }

  const authorization = request.headers.get("Authorization") || "";
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return jsonResponse(401, { error: "authentication_required" });

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: authError } = await userClient.auth.getUser();
  if (authError || !userData.user) return jsonResponse(401, { error: "invalid_session" });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  const sessionId = body.session_id;
  const attestation = body.attestation as { payload?: Record<string, unknown>; signature?: string } | undefined;
  const payload = attestation?.payload;
  const signature = attestation?.signature;
  if (typeof sessionId !== "string" || !UUID_RE.test(sessionId)
      || !payload || typeof payload !== "object" || typeof signature !== "string"
      || !/^[0-9a-f]{64}$/i.test(signature)) {
    return jsonResponse(400, { error: "invalid_attestation_envelope" });
  }

  const failures = payload.failures;
  const issuedAt = payload.issued_at;
  if (payload.version !== 1 || typeof payload.run_id !== "string" || !UUID_RE.test(payload.run_id)
      || typeof payload.scenario !== "string" || typeof payload.sim_session_id !== "string"
      || !Number.isSafeInteger(issuedAt) || !Array.isArray(failures) || failures.length < 1 || failures.length > 100) {
    return jsonResponse(400, { error: "invalid_attestation_payload" });
  }
  const ageSeconds = Math.floor(Date.now() / 1000) - Number(issuedAt);
  if (ageSeconds < -60 || ageSeconds > 900) return jsonResponse(422, { error: "attestation_expired" });
  for (const failure of failures) {
    if (!failure || typeof failure !== "object"
        || !FAILURE_CODES.has((failure as Record<string, unknown>).code as string)
        || ((failure as Record<string, unknown>).component !== null
            && typeof (failure as Record<string, unknown>).component !== "string")) {
      return jsonResponse(400, { error: "invalid_failure_candidate" });
    }
  }

  const canonical = canonicalJson(payload);
  const expected = await hmacHex(attestationSecret, canonical);
  if (!constantTimeEqual(signature.toLowerCase(), expected)) {
    return jsonResponse(401, { error: "invalid_simulator_signature" });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: session, error: sessionError } = await admin
    .from("sessions")
    .select("id, student_id, lab_id")
    .eq("id", sessionId)
    .eq("student_id", userData.user.id)
    .maybeSingle();
  if (sessionError) return jsonResponse(500, { error: "session_lookup_failed" });
  if (!session) return jsonResponse(403, { error: "session_not_owned_by_user" });

  const { data: lab, error: labError } = await admin
    .from("labs")
    .select("scenario")
    .eq("id", session.lab_id)
    .maybeSingle();
  if (labError) return jsonResponse(500, { error: "lab_lookup_failed" });
  if (!lab || lab.scenario !== payload.scenario) {
    return jsonResponse(422, { error: "scenario_does_not_match_session" });
  }

  const digest = await sha256Hex(canonical);
  const { data, error } = await admin.rpc("record_verified_simulation", {
    p_run_id: payload.run_id,
    p_session_id: sessionId,
    p_scenario: payload.scenario,
    p_attestation_sha256: digest,
    p_failures: failures,
  });
  if (error) {
    // Do not return SQL text or internal database details to the browser.
    console.error("record_verified_simulation failed", error.code || "unknown");
    return jsonResponse(500, { error: "verified_simulation_write_failed" });
  }

  return jsonResponse(200, { ok: true, run_id: payload.run_id, result: data });
});
