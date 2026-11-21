#!/usr/bin/env python3
"""HTTP face of the Team 3 engine, standard library only.

    python3 api.py --port 8000

Routes
    GET    /v1/health                      engine + scenario list
    POST   /v1/session   {scenario}        -> {session_id}
    POST   /v1/simulate  {session_id, netlist}
    DELETE /v1/session/<id>

The session keeps the last good result, so a bad frame from vision produces a
stale result instead of wiping the screen. No dependency beyond the engine.
"""
import argparse
import json
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from eduminds import Session, evaluate, simulate                      # noqa: E402
from eduminds.scenarios import load_scenarios                          # noqa: E402

MAX_BODY = 256 * 1024
SESSION_TTL = 3600.0
SESSIONS = {}
LOCK = threading.Lock()


def purge(now=None):
    now = now or time.time()
    with LOCK:
        for sid in [k for k, v in SESSIONS.items() if now - v["touched"] > SESSION_TTL]:
            SESSIONS.pop(sid, None)


class Handler(BaseHTTPRequestHandler):
    server_version = "EduMindsSim/1.0"

    def log_message(self, fmt, *args):   # keep the terminal readable
        if self.path.startswith("/v1/health"):
            return
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def _send(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("access-control-allow-headers", "content-type")
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status, code, message):
        self._send(status, {"error": {"code": code, "message": message}})

    def _body(self):
        length = int(self.headers.get("content-length") or 0)
        if length <= 0:
            return None, "empty body"
        if length > MAX_BODY:
            return None, "body too large"
        try:
            return json.loads(self.rfile.read(length).decode("utf-8")), None
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            return None, "body is not JSON: %s" % exc

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        if urlparse(self.path).path == "/v1/health":
            self._send(200, {"ok": True, "engine": "eduminds", "scenarios": sorted(load_scenarios().keys()),
                             "sessions": len(SESSIONS)})
        else:
            self._error(404, "NOT_FOUND", "no such route")

    def do_POST(self):
        purge()
        path = urlparse(self.path).path
        body, err = self._body()
        if err:
            return self._error(400, "BAD_BODY", err)

        if path == "/v1/session":
            scenario = body.get("scenario") if isinstance(body, dict) else None
            if scenario not in load_scenarios():
                return self._error(422, "UNKNOWN_SCENARIO", "unknown scenario %r" % (scenario,))
            sid = uuid.uuid4().hex
            with LOCK:
                SESSIONS[sid] = {"session": Session(scenario), "scenario": scenario, "touched": time.time()}
            return self._send(200, {"session_id": sid, "scenario": scenario})

        if path == "/v1/simulate":
            if not isinstance(body, dict) or not isinstance(body.get("netlist"), dict):
                return self._error(400, "BAD_BODY", "expected {session_id, netlist}")
            netlist = body["netlist"]
            sid = body.get("session_id")
            with LOCK:
                entry = SESSIONS.get(sid) if sid else None
                if entry:
                    entry["touched"] = time.time()
                    session = entry["session"]
            try:
                if entry:
                    result = session.update(netlist)
                else:
                    result = simulate(netlist)
                if not entry:
                    result = dict(result, session_missing=True)
            except Exception as exc:                                  # never a 500 loop
                return self._error(500, "ENGINE_ERROR", repr(exc))
            return self._send(200, result)

        return self._error(404, "NOT_FOUND", "no such route")

    def do_DELETE(self):
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
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()
    httpd = make_server(args.host, args.port)
    print("EduMinds sim service on http://%s:%d  (scenarios: %s)"
          % (args.host, args.port, ", ".join(sorted(load_scenarios()))), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
