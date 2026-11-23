"""Static demo routes and the /api prefix (one origin, no CORS)."""
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import api  # noqa: E402

REPO = Path(__file__).resolve().parents[3]


@pytest.fixture()
def demo(base_url):
    api.SERVE_DEMO = True
    yield base_url
    api.SERVE_DEMO = False


@pytest.fixture(scope="module")
def base_url():
    httpd = api.make_server(port=0)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield "http://127.0.0.1:%d" % httpd.server_address[1]
    httpd.shutdown()
    httpd.server_close()


def get(url):
    try:
        with urllib.request.urlopen(url, timeout=5) as res:
            return res.status, res.headers.get("content-type", ""), res.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.headers.get("content-type", ""), exc.read()


def test_health_is_reachable_both_with_and_without_the_api_prefix(demo):
    for path in ("/v1/health", "/api/v1/health"):
        status, _, body = get(demo + path)
        assert status == 200
        assert b"ex1_led_series" in body


def test_the_demo_page_is_served_on_slash(demo):
    status, ctype, body = get(demo + "/")
    assert status == 200
    assert ctype.startswith("text/html")
    assert b"EduMinds" in body


def test_every_asset_the_page_needs_answers(demo):
    for path in ("/demo/main.js", "/demo/vendor/aruco.js", "/src/vision.js",
                 "/src/cameraLoop.js", "/shared/labs.json", "/shared/components.csv"):
        status, ctype, body = get(demo + path)
        assert status == 200, path
        assert len(body) > 100, path


def test_static_files_are_off_without_the_demo_flag(base_url):
    api.SERVE_DEMO = False
    try:
        status, _, _ = get(base_url + "/")
        assert status == 404
        status, _, _ = get(base_url + "/demo/main.js")
        assert status == 404
    finally:
        api.SERVE_DEMO = False


def test_path_traversal_stays_inside_the_static_roots(demo):
    status, _, _ = get(demo + "/demo/../../package.json")
    assert status == 404
    status, _, _ = get(demo + "/shared/..%2f..%2fpackage.json")
    assert status == 404


def test_a_demo_simulate_round_trip_over_the_api_prefix(demo):
    import json

    def post(path, payload):
        req = urllib.request.Request(demo + path, data=json.dumps(payload).encode(),
                                     method="POST", headers={"content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as res:
            return json.loads(res.read())

    sid = post("/api/v1/session", {"scenario": "ex1_led_series"})["session_id"]
    netlist = json.loads((REPO / "services/sim/data/netlist_ex1_led.json").read_text())
    result = post("/api/v1/simulate", {"session_id": sid, "netlist": netlist})
    assert result["scenario_check"]["completed"] is True
    led = result["components"]["LED1"]
    assert led["state"] == "on"
    assert abs(led["current_a"] - 0.02115) < 0.0005
