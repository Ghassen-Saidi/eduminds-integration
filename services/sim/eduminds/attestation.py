"""HMAC attestations for trusted circuit-simulator results.

Only compact identifiers and failure-code strings are signed. Floating-point
simulation output is deliberately excluded so Python and JavaScript can
canonicalize the exact same payload without number-formatting ambiguity.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import uuid
from typing import Any


FINANCIAL_FAILURE_CODES = {
    "LED_OVERCURRENT",
    "SHORT_CIRCUIT",
    "SHORT_CIRCUIT_CURRENT",
    "SENSOR_OVERVOLTAGE",
}


def canonical_json(payload: dict[str, Any]) -> bytes:
    """Stable JSON encoding shared with the Supabase Edge Function."""
    return json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


def create_attestation(
    *,
    scenario: str,
    sim_session_id: str,
    result: dict[str, Any],
    secret: str | None = None,
    issued_at: int | None = None,
    run_id: str | None = None,
) -> dict[str, Any] | None:
    """Sign the failure candidates derived from a fresh engine result.

    Returns None unless a server-side EDUMINDS_ATTESTATION_SECRET is configured
    and the result contains at least one recognized financial failure.
    """
    key = secret if secret is not None else os.environ.get("EDUMINDS_ATTESTATION_SECRET", "")
    if not key or result.get("stale") or result.get("offline"):
        return None

    messages = result.get("messages")
    if not isinstance(messages, list):
        return None

    failures: dict[tuple[str, str | None], dict[str, str | None]] = {}
    for message in messages:
        if not isinstance(message, dict):
            continue
        code = message.get("code")
        if code not in FINANCIAL_FAILURE_CODES:
            continue
        component = message.get("component")
        if component is not None and not isinstance(component, str):
            continue
        key_tuple = (code, component)
        failures[key_tuple] = {"code": code, "component": component}

    if not failures:
        return None

    payload = {
        "version": 1,
        "run_id": str(run_id or uuid.uuid4()),
        "scenario": str(scenario),
        "sim_session_id": str(sim_session_id),
        "issued_at": int(time.time() if issued_at is None else issued_at),
        "failures": [failures[key] for key in sorted(failures, key=lambda item: (item[0], item[1] or ""))],
    }
    signature = hmac.new(key.encode("utf-8"), canonical_json(payload), hashlib.sha256).hexdigest()
    return {"payload": payload, "signature": signature}


def verify_attestation(attestation: dict[str, Any], secret: str) -> bool:
    """Test/helper verification; production verification occurs in the Edge Function."""
    if not isinstance(attestation, dict) or not isinstance(attestation.get("payload"), dict):
        return False
    signature = attestation.get("signature")
    if not isinstance(signature, str) or len(signature) != 64:
        return False
    expected = hmac.new(
        secret.encode("utf-8"),
        canonical_json(attestation["payload"]),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(signature, expected)
