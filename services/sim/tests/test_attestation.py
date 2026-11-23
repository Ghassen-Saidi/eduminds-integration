import copy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from eduminds.attestation import create_attestation, verify_attestation


APP_SESSION = "00000000-0000-4000-8000-000000000123"


def test_attestation_signs_only_recognized_financial_failures():
    result = {
        "status": "warning",
        "messages": [
            {"code": "LED_OVERCURRENT", "component": "LED1"},
            {"code": "LED_OVERCURRENT", "component": "LED1"},
            {"code": "LED_REVERSED", "component": "LED1"},
        ],
    }
    attestation = create_attestation(
        scenario="ex1_led_series",
        sim_session_id="sim-123",
        application_session_id=APP_SESSION,
        result=result,
        secret="test-secret",
        issued_at=1764000000,
        run_id="00000000-0000-4000-8000-000000000124",
    )
    assert attestation is not None
    payload = attestation["payload"]
    assert payload["application_session_id"] == APP_SESSION
    assert payload["failures"] == [{"code": "LED_OVERCURRENT", "component": "LED1"}]
    assert verify_attestation(attestation, "test-secret")


def test_attestation_rejects_tampering_and_wrong_secret():
    attestation = create_attestation(
        scenario="ex1_led_series",
        sim_session_id="sim-123",
        application_session_id=APP_SESSION,
        result={"messages": [{"code": "LED_OVERCURRENT", "component": "LED1"}]},
        secret="correct-secret",
        issued_at=1764000000,
    )
    assert not verify_attestation(attestation, "wrong-secret")
    tampered = copy.deepcopy(attestation)
    tampered["payload"]["scenario"] = "ex4_divider_sensor"
    assert not verify_attestation(tampered, "correct-secret")


def test_no_attestation_for_stale_or_nonfinancial_results():
    assert create_attestation(
        scenario="ex1_led_series",
        sim_session_id="sim-123",
        application_session_id=APP_SESSION,
        result={"stale": True, "messages": [{"code": "LED_OVERCURRENT"}]},
        secret="secret",
    ) is None
    assert create_attestation(
        scenario="ex1_led_series",
        sim_session_id="sim-123",
        application_session_id=APP_SESSION,
        result={"messages": [{"code": "LED_REVERSED"}]},
        secret="secret",
    ) is None


def test_no_attestation_without_server_secret():
    assert create_attestation(
        scenario="ex1_led_series",
        sim_session_id="sim-123",
        application_session_id=APP_SESSION,
        result={"messages": [{"code": "LED_OVERCURRENT"}]},
        secret="",
    ) is None
