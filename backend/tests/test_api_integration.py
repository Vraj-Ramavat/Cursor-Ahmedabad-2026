"""End-to-end API test over an in-memory-ish SQLite DB.

Exercises the intake -> triage -> briefing -> queue path without Redis or any
LLM key present, proving the safety-critical path works fully degraded.
"""

import pytest
from fastapi.testclient import TestClient

from app.core.database import init_db
from app.main import app


@pytest.fixture(scope="module")
def client():
    init_db()
    with TestClient(app) as c:
        yield c


def test_health_and_readiness(client):
    assert client.get("/health").json()["status"] == "ok"
    assert "ready" in client.get("/readiness").json()["status"]


def test_full_chest_pain_intake_escalates_to_red(client):
    start = client.post("/api/intake/start", json={
        "patient_name": "Test Patient",
        "chief_complaint": "chest pain",
    }).json()
    sid, node = start["session_id"], start["node_id"]

    answers = {
        "onset": "an hour ago",
        "character": "a tight pressure",
        "radiation": "spreads to my arm",
        "associated": "yes shortness of breath and cold sweat",
        "exertion": "worse when I move",
    }
    severity = "green"
    while node is not None:
        resp = client.post("/api/intake/answer", json={
            "session_id": sid, "node_id": node, "answer": answers[node],
        }).json()
        severity = resp["severity"]
        node = resp["node_id"]

    assert severity == "red"

    briefing = client.get(f"/api/intake/{sid}/briefing").json()
    assert briefing["severity"] == "red"
    # No LLM key in test env -> paraphrase degrades gracefully.
    assert briefing["paraphrase_status"] in ("pending — retry", "ready")


def test_queue_status_serves_without_redis(client):
    resp = client.get("/api/queue/status").json()
    # No Redis in test env -> not live, but still serves last-known order.
    assert resp["live"] is False
    assert "paused" in resp["banner"]
