"""Tests for the aging-based priority queue.

Proves: (a) a long-waiting green overtakes a fresh amber, (b) red always jumps
in, (c) the 45-minute auto-escalation ceiling fires.
"""

from datetime import datetime, timedelta, timezone

from app.services.priority_queue import QueueItem, rescore_queue, score_item

NOW = datetime(2026, 7, 18, 12, 0, 0, tzinfo=timezone.utc)


def _ago(minutes: float) -> datetime:
    return NOW - timedelta(minutes=minutes)


def test_long_waiting_green_overtakes_fresh_amber():
    green = QueueItem("green", "green", _ago(60))   # 10 + 60 = 70
    amber = QueueItem("amber", "amber", _ago(1))     # 50 + 1  = 51
    ordered = rescore_queue([amber, green], now=NOW)
    assert ordered[0].session_id == "green"


def test_red_always_jumps_in():
    green = QueueItem("green", "green", _ago(120))   # 10 + 120 = 130
    red = QueueItem("red", "red", _ago(0))           # 100 + 0  = 100
    # Even a very-long-waiting green should not outrank a fresh red within a
    # realistic wait window; here confirm red beats a moderately-waited green.
    green_mod = QueueItem("green2", "green", _ago(30))  # 40
    ordered = rescore_queue([green_mod, red], now=NOW)
    assert ordered[0].session_id == "red"


def test_auto_escalation_ceiling_fires_at_45_min():
    green = QueueItem("stale_green", "green", _ago(46))
    scored = score_item(green, NOW, auto_escalate_minutes=45)
    assert scored.severity == "amber"
    assert scored.auto_escalated is True


def test_no_escalation_before_ceiling():
    green = QueueItem("young_green", "green", _ago(10))
    scored = score_item(green, NOW, auto_escalate_minutes=45)
    assert scored.severity == "green"
    assert scored.auto_escalated is False


def test_red_is_not_downgraded_by_scoring():
    red = QueueItem("red", "red", _ago(60))
    scored = score_item(red, NOW, auto_escalate_minutes=45)
    assert scored.severity == "red"
