#!/usr/bin/env python3
"""HTTP face of the Team 3 engine, standard library only.

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

The session keeps the last good result, so a bad frame from vision produces a
stale result instead of wiping the screen. No dependency beyond the engine.
"""
import argparse
import json
import mimetypes
import ssl
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from eduminds import Session, evaluate, simulate                      # noqa: E402
from eduminds.scenarios import load_scenarios                          # noqa: E402

MAX_BODY = 256 * 1024
SESSION_TTL = 3600.0
SESSIONS = {}
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

    def _file(self, target):
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("content-type", MIME.get(target.suffix, "application/octet-stream"))
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = strip_api_prefix(urlparse(self.path).path)
        if path == "/v1/health":
            self._send(200, {"ok": True, "engine": "eduminds", "scenarios": sorted(load_scenarios().keys()),
                             "sessions": len(SESSIONS), "demo": SERVE_DEMO})
            return
        target = static_file(path)
        if target is not None:
            return self._file(target)
        self._error(404, "NOT_FOUND", "no such route")

    def do_POST(self):
        purge()
        path = strip_api_prefix(urlparse(self.path).path)
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
        path = strip_api_prefix(urlparse(self.path).path)
        if path.startswith("/v1/session/"):
            sid = path.rsplit("/", 1)[-1]
            with LOCK:
                existed = SESSIONS.pop(sid, None) is not None
            return self._send(200, {"deleted": existed})
        return self._error(404, "NOT_FOUND", "no such route")


def make_server(host="127.0.0.1", port=8000):
    return ThreadingHTTPServer((host, port), Handler)


def main():
    global SERVE_DEMO
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--demo", action="store_true", help="serve the phone demo page on / and its files")
    ap.add_argument("--tls", action="store_true", help="wrap the socket in TLS (camera needs a secure context)")
    ap.add_argument("--cert", default="certs/dev-cert.pem", help="TLS certificate (PEM)")
    ap.add_argument("--key", default="certs/dev-key.pem", help="TLS private key (PEM)")
    args = ap.parse_args()
    SERVE_DEMO = args.demo
    httpd = make_server(args.host, args.port)
    scheme = "http"
    if args.tls:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(args.cert, args.key)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
        scheme = "https"
    print("EduMinds sim service on %s://%s:%d  (scenarios: %s)%s"
          % (scheme, args.host, args.port, ", ".join(sorted(load_scenarios())),
             "  demo on /" if SERVE_DEMO else ""), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
