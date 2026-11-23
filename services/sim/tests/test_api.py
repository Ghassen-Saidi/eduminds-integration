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


def call(base, path, payload=None, method=None, headers=None):
    data = json.dumps(payload).encode() if payload is not None else None
    request_headers = {"content-type": "application/json", **(headers or {})}
    req = urllib.request.Request(base + path, data=data,
                                 method=method or ("POST" if data else "GET"),
                                 headers=request_headers)
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            return res.status, json.loads(res.read().decode())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode())


def netlist(**kw):
    data = json.loads((Path(__file__).resolve().parent.parent / "data" / "netlist_ex1_led.json").read_text())
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


def test_bearer_token_is_required_when_configured(base_url, monkeypatch):
    monkeypatch.setattr(api, "API_TOKEN", "test-secret")
    status, body = call(base_url, "/v1/health")
    assert status == 401 and body["error"]["code"] == "UNAUTHORIZED"
    status, body = call(base_url, "/v1/health", headers={"authorization": "Bearer test-secret"})
    assert status == 200 and body["ok"] is True


def test_per_ip_rate_limit_has_a_sliding_window(monkeypatch):
    monkeypatch.setattr(api, "RATE_LIMIT_MAX_REQUESTS", 2)
    api.RATE_LIMITS.clear()
    assert api.allow_request("unit-test-client", now=100.0) is True
    assert api.allow_request("unit-test-client", now=101.0) is True
    assert api.allow_request("unit-test-client", now=102.0) is False
    assert api.allow_request("unit-test-client", now=161.1) is True



def test_non_loopback_bind_requires_a_bearer_token():
    with pytest.raises(ValueError, match="EDUMINDS_API_TOKEN"):
        api.validate_bind("0.0.0.0", api_token="")
    api.validate_bind("127.0.0.1", api_token="")
    api.validate_bind("::1", api_token="")
    api.validate_bind("0.0.0.0", api_token="reverse-proxy-secret")


def test_protected_requests_trigger_expiry_cleanup(monkeypatch):
    purged = []
    monkeypatch.setattr(api, "API_TOKEN", None)
    monkeypatch.setattr(api, "purge", lambda: purged.append(True))
    monkeypatch.setattr(api, "allow_request", lambda _ip: True)
    handler = api.Handler.__new__(api.Handler)
    handler.headers = {"Authorization": ""}
    handler.client_address = ("198.51.100.4", 12345)
    assert handler._access_error() is False
    assert purged == [True]


def test_engine_errors_do_not_leak_internal_exception_text(base_url):
    sid = "unit-test-engine-error"
    class BrokenSession:
        def update(self, _netlist):
            raise RuntimeError("sensitive-internal-detail")
    api.SESSIONS[sid] = {
        "session": BrokenSession(), "scenario": "ex1_led_series",
        "touched": api.time.time(), "lock": threading.Lock(),
    }
    try:
        status, body = call(base_url, "/v1/simulate", {"session_id": sid, "netlist": netlist()})
        assert status == 500
        assert body["error"]["code"] == "ENGINE_ERROR"
        assert "sensitive-internal-detail" not in json.dumps(body)
    finally:
        api.SESSIONS.pop(sid, None)
