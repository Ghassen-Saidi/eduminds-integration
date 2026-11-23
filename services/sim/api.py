#!/usr/bin/env python3
"""HTTP face of Team 3's engine, plus the phone demo page.

    python3 api.py --port 8000                    # API only
    python3 api.py --port 8000 --demo             # + the phone demo page on /
    python3 api.py --port 8443 --demo --tls       # https (camera on a phone)

Routes
    GET    /v1/health                      engine + scenario list
    POST   /v1/session   {scenario}        -> {session_id}
    POST   /v1/simulate  {session_id, netlist}
    DELETE /v1/session/<id>
    GET    /                               the demo page (with --demo)
    GET    /demo/..., /src/..., /shared/...  its static files (with --demo)

Every route also answers under a /api prefix, so the page can use one origin and
the app's Vite proxy rewrite (`/api` -> `/`) does the same thing in production.

Keep it on loopback for local demos. If a tunnel is used, place an authenticated
access proxy in front of it. EDUMINDS_API_TOKEN is an optional shared token for
trusted reverse-proxy injection; never put it in browser JavaScript.
EDUMINDS_ALLOWED_ORIGINS (comma separated) is the CORS allowlist for a browser
on another origin; same-origin pages need nothing.

The session keeps the last good result, so a bad frame from vision produces a
stale result instead of wiping the screen.
"""
import argparse
import hmac
import ipaddress
import json
import mimetypes
import os
import ssl
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from eduminds import Session, simulate  # noqa: E402
from eduminds.attestation import create_attestation  # noqa: E402
from eduminds.scenarios import load_scenarios  # noqa: E402

MAX_BODY = 256 * 1024
SESSION_TTL = 3600.0
RATE_LIMIT_WINDOW_SECONDS = 60.0
RATE_LIMIT_MAX_REQUESTS = 120
API_TOKEN = os.environ.get("EDUMINDS_API_TOKEN")
ALLOWED_ORIGINS = {
    origin.strip() for origin in os.environ.get("EDUMINDS_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
}
SESSIONS = {}
RATE_LIMITS = {}
LOCK = threading.Lock()

REPO = Path(__file__).resolve().parents[2]
# Static roots served only when --demo is on: URL prefix -> directory.
STATIC_PREFIXES = {
    "/demo/": REPO / "demo",
    "/src/": REPO / "src",
    "/shared/": REPO / "shared",
}
SERVE_DEMO = False

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".map": "application/json; charset=utf-8",
}


def strip_api_prefix(path):
    """`/api/v1/simulate` is the same route as `/v1/simulate` (one origin, app proxy)."""
    return path[4:] if path == "/api" or path.startswith("/api/") else path


def static_file(path):
    """Resolve a URL path under one of STATIC_PREFIXES; None if it is not ours."""
    if not SERVE_DEMO:
        return None
    if path in ("/", "/index.html"):
        return REPO / "demo" / "index.html"
    for prefix, root in STATIC_PREFIXES.items():
        if not path.startswith(prefix):
            continue
        rel = Path(unquote(path[len(prefix):]))
        target = (root / rel).resolve()
        try:
            target.relative_to(root.resolve())
        except ValueError:
            return None                      # traversal attempt
        return target if target.is_file() else None
    return None


def purge(now=None):
    now = now or time.time()
    with LOCK:
        for sid in [key for key, value in SESSIONS.items() if now - value["touched"] > SESSION_TTL]:
            SESSIONS.pop(sid, None)
        cutoff = time.monotonic() - RATE_LIMIT_WINDOW_SECONDS
        for ip in list(RATE_LIMITS):
            recent = [stamp for stamp in RATE_LIMITS[ip] if stamp > cutoff]
            if recent:
                RATE_LIMITS[ip] = recent
            else:
                RATE_LIMITS.pop(ip, None)


def allow_request(client_ip, now=None):
    """Per-IP sliding-window request budget; separated for deterministic tests."""
    stamp = time.monotonic() if now is None else now
    cutoff = stamp - RATE_LIMIT_WINDOW_SECONDS
    with LOCK:
        recent = [value for value in RATE_LIMITS.get(client_ip, []) if value > cutoff]
        if len(recent) >= RATE_LIMIT_MAX_REQUESTS:
            RATE_LIMITS[client_ip] = recent
            return False
        recent.append(stamp)
        RATE_LIMITS[client_ip] = recent
        return True


class Handler(BaseHTTPRequestHandler):
    server_version = "EduMindsSim/1.1"

    def log_message(self, fmt, *args):
        if not self.path.startswith("/v1/health"):
            sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def _send(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        origin = self.headers.get("Origin")
        if origin and origin in ALLOWED_ORIGINS:
            self.send_header("access-control-allow-origin", origin)
            self.send_header("access-control-allow-methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("access-control-allow-headers", "content-type, authorization")
            self.send_header("vary", "Origin")
        self.end_headers()
        if status != 204:
            self.wfile.write(body)

    def _error(self, status, code, message):
        self._send(status, {"error": {"code": code, "message": message}})

    def _access_error(self):
        # All protected API traffic participates in expiry cleanup, not just
        # POST requests. Otherwise idle sessions and per-IP buckets can linger
        # indefinitely when a client only polls health or deletes sessions.
        purge()
        if API_TOKEN and not hmac.compare_digest(
            self.headers.get("Authorization", ""), "Bearer " + API_TOKEN
        ):
            self._error(401, "UNAUTHORIZED", "valid bearer authentication is required")
            return True
        if not allow_request(self.client_address[0]):
            self._error(429, "RATE_LIMITED", "request rate limit exceeded")
            return True
        return False

    def _body(self):
        content_type = self.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            return None, "content-type must be application/json", 415
        try:
            length = int(self.headers.get("content-length") or 0)
        except ValueError:
            return None, "invalid content-length", 400
        if length <= 0:
            return None, "empty body", 400
        if length > MAX_BODY:
            return None, "body too large", 413
        try:
            return json.loads(self.rfile.read(length).decode("utf-8")), None, 200
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            return None, "body is not JSON: %s" % exc, 400

    def _file(self, target):
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("content-type", MIME.get(target.suffix, mimetypes.guess_type(target.name)[0] or "application/octet-stream"))
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        path = strip_api_prefix(urlparse(self.path).path)
        target = static_file(path)
        if target is not None:
            return self._file(target)
        if self._access_error():
            return
        if path == "/v1/health":
            with LOCK:
                count = len(SESSIONS)
            self._send(200, {
                "ok": True, "engine": "eduminds",
                "scenarios": sorted(load_scenarios().keys()), "sessions": count,
                "demo": SERVE_DEMO,
            })
        else:
            self._error(404, "NOT_FOUND", "no such route")

    def do_POST(self):
        if self._access_error():
            return
        body, error, status = self._body()
        if error:
            return self._error(status, "BAD_BODY", error)
        path = strip_api_prefix(urlparse(self.path).path)
        if path == "/v1/session":
            scenario = body.get("scenario") if isinstance(body, dict) else None
            if scenario not in load_scenarios():
                return self._error(422, "UNKNOWN_SCENARIO", "unknown scenario %r" % (scenario,))
            application_session_id = body.get("application_session_id") if isinstance(body, dict) else None
            if application_session_id is not None:
                try:
                    application_session_id = str(uuid.UUID(str(application_session_id)))
                except (ValueError, TypeError, AttributeError):
                    return self._error(422, "INVALID_APPLICATION_SESSION", "application_session_id must be a UUID")
            sid = uuid.uuid4().hex
            with LOCK:
                SESSIONS[sid] = {
                    "session": Session(scenario), "scenario": scenario,
                    "application_session_id": application_session_id,
                    "active_failure_keys": set(),
                    "touched": time.time(), "lock": threading.Lock(),
                }
            return self._send(200, {"session_id": sid, "scenario": scenario})
        if path == "/v1/simulate":
            if not isinstance(body, dict) or not isinstance(body.get("netlist"), dict):
                return self._error(400, "BAD_BODY", "expected {session_id, netlist}")
            sid = body.get("session_id")
            with LOCK:
                entry = SESSIONS.get(sid) if sid else None
                if entry:
                    entry["touched"] = time.time()
            try:
                if entry:
                    # A shared session must never process two camera results at once.
                    with entry["lock"]:
                        result = entry["session"].update(body["netlist"])
                else:
                    result = dict(simulate(body["netlist"]), session_missing=True)
            except Exception as exc:
                # Keep diagnostics in the server log; never echo internal
                # exception text (which may include identifiers or secrets) to
                # an untrusted browser client.
                sys.stderr.write("simulator engine error: %r\n" % exc)
                return self._error(500, "ENGINE_ERROR", "simulation failed")
            if entry and entry.get("application_session_id") and not result.get("stale"):
                # Count a continuous fault once. A candidate can be signed again
                # only after it disappears from a fresh engine result and then
                # returns. This is the trusted equivalent of the UI edge trigger.
                current_failures = set()
                newly_seen_messages = []
                for message in result.get("messages", []):
                    if not isinstance(message, dict) or message.get("code") not in {
                        "LED_OVERCURRENT", "SHORT_CIRCUIT",
                        "SHORT_CIRCUIT_CURRENT", "SENSOR_OVERVOLTAGE",
                    }:
                        continue
                    component = message.get("component") or ""
                    key = (message["code"], str(component))
                    current_failures.add(key)
                    if key not in entry["active_failure_keys"]:
                        newly_seen_messages.append(message)
                if newly_seen_messages:
                    attestation = create_attestation(
                        scenario=entry["scenario"],
                        sim_session_id=sid,
                        application_session_id=entry["application_session_id"],
                        result={**result, "messages": newly_seen_messages},
                    )
                    if attestation:
                        result = dict(result)
                        result["attestation"] = attestation
                        entry["active_failure_keys"] = current_failures
                else:
                    # Age cleared failures out so a later recurrence can be
                    # signed. If this result has no new failure messages, there
                    # is nothing to retry on the next camera update.
            return self._send(200, result)
        return self._error(404, "NOT_FOUND", "no such route")

    def do_DELETE(self):
        if self._access_error():
            return
        path = strip_api_prefix(urlparse(self.path).path)
        if path.startswith("/v1/session/"):
            sid = path.rsplit("/", 1)[-1]
            with LOCK:
                existed = SESSIONS.pop(sid, None) is not None
            return self._send(200, {"deleted": existed})
        return self._error(404, "NOT_FOUND", "no such route")


def validate_bind(host, api_token=None):
    """Require a bearer-protected reverse proxy before listening off-loopback."""
    token = API_TOKEN if api_token is None else api_token
    if str(host).lower() == "localhost":
        return
    try:
        loopback = ipaddress.ip_address(host).is_loopback
    except ValueError:
        loopback = False
    if not loopback and not token:
        raise ValueError(
            "refusing non-loopback bind without EDUMINDS_API_TOKEN; "
            "use loopback or configure an authenticated reverse proxy"
        )


def make_server(host="127.0.0.1", port=8000):
    validate_bind(host, API_TOKEN)
    return ThreadingHTTPServer((host, port), Handler)


def main():
    global SERVE_DEMO
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--demo", action="store_true", help="serve the phone demo page on / and its files")
    parser.add_argument("--tls", action="store_true", help="wrap the socket in TLS (camera needs a secure context)")
    parser.add_argument("--cert", default="certs/dev-cert.pem", help="TLS certificate (PEM)")
    parser.add_argument("--key", default="certs/dev-key.pem", help="TLS private key (PEM)")
    args = parser.parse_args()
    SERVE_DEMO = args.demo
    try:
        server = make_server(args.host, args.port)
    except ValueError as exc:
        parser.error(str(exc))
    scheme = "http"
    if args.tls:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(args.cert, args.key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        scheme = "https"
    print("EduMinds sim service on %s://%s:%d  (scenarios: %s)%s"
          % (scheme, args.host, args.port, ", ".join(sorted(load_scenarios())),
             "  demo on /" if SERVE_DEMO else ""), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
