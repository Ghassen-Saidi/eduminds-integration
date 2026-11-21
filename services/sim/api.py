#!/usr/bin/env python3
"""HTTP face of Team 3's engine.

Keep it on loopback for local demos. If a tunnel is used, place an authenticated
access proxy in front of it. EDUMINDS_API_TOKEN is an optional shared token for
trusted reverse-proxy injection; never put it in browser JavaScript.
"""
import argparse
import hmac
import json
import os
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from eduminds import Session, simulate  # noqa: E402
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

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        if self._access_error():
            return
        if urlparse(self.path).path == "/v1/health":
            with LOCK:
                count = len(SESSIONS)
            self._send(200, {
                "ok": True, "engine": "eduminds",
                "scenarios": sorted(load_scenarios().keys()), "sessions": count,
            })
        else:
            self._error(404, "NOT_FOUND", "no such route")

    def do_POST(self):
        if self._access_error():
            return
        purge()
        body, error, status = self._body()
        if error:
            return self._error(status, "BAD_BODY", error)
        path = urlparse(self.path).path
        if path == "/v1/session":
            scenario = body.get("scenario") if isinstance(body, dict) else None
            if scenario not in load_scenarios():
                return self._error(422, "UNKNOWN_SCENARIO", "unknown scenario %r" % (scenario,))
            sid = uuid.uuid4().hex
            with LOCK:
                SESSIONS[sid] = {
                    "session": Session(scenario), "scenario": scenario,
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
                return self._error(500, "ENGINE_ERROR", repr(exc))
            return self._send(200, result)
        return self._error(404, "NOT_FOUND", "no such route")

    def do_DELETE(self):
        if self._access_error():
            return
        path = urlparse(self.path).path
        if path.startswith("/v1/session/"):
            sid = path.rsplit("/", 1)[-1]
            with LOCK:
                existed = SESSIONS.pop(sid, None) is not None
            return self._send(200, {"deleted": existed})
        return self._error(404, "NOT_FOUND", "no such route")


def make_server(host="127.0.0.1", port=8000):
    return ThreadingHTTPServer((host, port), Handler)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    server = make_server(args.host, args.port)
    print("EduMinds sim service on http://%s:%d  (scenarios: %s)"
          % (args.host, args.port, ", ".join(sorted(load_scenarios()))), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
