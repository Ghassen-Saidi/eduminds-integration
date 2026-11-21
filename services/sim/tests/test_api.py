"""HTTP contract tests for the local simulation service."""
import json
import threading
import urllib.request
import urllib.error
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import api  # noqa: E402


@pytest.fixture(scope="module")
def base_url():
    httpd = api.make_server(port=0)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield "http://127.0.0.1:%d" % httpd.server_address[1]
    httpd.shutdown()
    httpd.server_close()


def call(base, path, payload=None, method=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(base + path, data=data, method=method or ("POST" if data else "GET"),
                                 headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            return res.status, json.loads(res.read().decode())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode())


def netlist(**kw):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    import json as _json
    data = _json.loads((Path(__file__).resolve().parent.parent / "data" / "netlist_ex1_led.json").read_text())
    data.update(kw)
    return data


def test_health(base_url):
    status, body = call(base_url, "/v1/health")
    assert status == 200 and body["ok"] is True
    assert "ex1_led_series" in body["scenarios"]


def test_session_then_simulate(base_url):
    status, sess = call(base_url, "/v1/session", {"scenario": "ex1_led_series"})
    assert status == 200 and sess["session_id"]
    status, res = call(base_url, "/v1/simulate", {"session_id": sess["session_id"], "netlist": netlist()})
    assert status == 200
    assert res["components"]["LED1"]["state"] == "on"
    assert abs(res["components"]["LED1"]["current_a"] - 0.0211) < 0.0005
    assert res["scenario_check"]["completed"] is True
    assert "stale" not in res


def test_unknown_scenario_is_422(base_url):
    status, body = call(base_url, "/v1/session", {"scenario": "nope"})
    assert status == 422 and body["error"]["code"] == "UNKNOWN_SCENARIO"


def test_bad_body_is_400(base_url):
    status, body = call(base_url, "/v1/simulate", {"netlist": "not-a-dict"})
    assert status == 400 and body["error"]["code"] == "BAD_BODY"


def test_missing_session_runs_stateless(base_url):
    status, res = call(base_url, "/v1/simulate", {"netlist": netlist()})
    assert status == 200 and res["session_missing"] is True
    assert res["components"]["LED1"]["state"] == "on"


def test_session_keeps_last_good_result(base_url):
    _, sess = call(base_url, "/v1/session", {"scenario": "ex1_led_series"})
    sid = sess["session_id"]
    _, good = call(base_url, "/v1/simulate", {"session_id": sid, "netlist": netlist()})
    bad = {"schema_version": "0.1", "components": [], "nets": []}
    _, stale = call(base_url, "/v1/simulate", {"session_id": sid, "netlist": bad})
    assert stale.get("stale") is True
    assert stale["components"] == good["components"]
    _, fresh = call(base_url, "/v1/simulate", {"session_id": sid, "netlist": netlist()})
    assert "stale" not in fresh


def test_delete_session(base_url):
    _, sess = call(base_url, "/v1/session", {"scenario": "ex1_led_series"})
    status, body = call(base_url, "/v1/session/" + sess["session_id"], method="DELETE")
    assert status == 200 and body["deleted"] is True
    status, body = call(base_url, "/v1/session/" + sess["session_id"], method="DELETE")
    assert body["deleted"] is False


def test_sessions_are_isolated(base_url):
    ids = [call(base_url, "/v1/session", {"scenario": "ex1_led_series"})[1]["session_id"] for _ in range(5)]
    good = netlist()
    bad = {"schema_version": "0.1", "components": [], "nets": []}
    for i, sid in enumerate(ids):
        call(base_url, "/v1/simulate", {"session_id": sid, "netlist": good if i % 2 else bad})
    for i, sid in enumerate(ids):
        _, res = call(base_url, "/v1/simulate", {"session_id": sid, "netlist": good})
        assert res["components"]["LED1"]["state"] == "on"
