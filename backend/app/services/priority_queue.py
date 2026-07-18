"""Aging-based priority queue scoring.

WHY THIS IS A SEPARATE, DEPENDENCY-FREE MODULE
----------------------------------------------
Queue ordering is pure arithmetic over (severity, wait time). Keeping it as a
standalone, unit-testable function means the ordering logic is verifiable
without a database, Redis, or Celery running. Celery Beat only *calls* this on
a tick; it owns no logic itself, so a Redis/Celery outage cannot corrupt the
ordering rules — it can only stop them from being recomputed (see the
"live updates paused" degrade path).

SCORING
-------
    priority_score = severity_weight + minutes_waited * aging_rate

A long-waiting green patient can therefore overtake a fresh amber patient, but
a red patient's high base weight keeps them ahead in practice. A hard ceiling
force-bumps anyone waiting past `auto_escalate_minutes` to at least amber,
regardless of score, so no one can be starved indefinitely.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

SEVERITY_WEIGHT = {"green": 10.0, "amber": 50.0, "red": 100.0}
SEVERITY_RANK = {"green": 0, "amber": 1, "red": 2}


@dataclass
class QueueItem:
    session_id: str
    severity: str
    enqueued_at: datetime
    auto_escalated: bool = False
    priority_score: float = 0.0


def _minutes_waited(enqueued_at: datetime, now: datetime) -> float:
    if enqueued_at.tzinfo is None:
        enqueued_at = enqueued_at.replace(tzinfo=timezone.utc)
    return max(0.0, (now - enqueued_at).total_seconds() / 60.0)


def score_item(
    item: QueueItem,
    now: datetime,
    aging_rate: float = 1.0,
    auto_escalate_minutes: int = 45,
) -> QueueItem:
    """Return a new-scored copy of the item, applying the auto-escalation ceiling."""
    waited = _minutes_waited(item.enqueued_at, now)
    severity = item.severity
    auto_escalated = item.auto_escalated

    if waited >= auto_escalate_minutes and SEVERITY_RANK[severity] < SEVERITY_RANK["amber"]:
        severity = "amber"
        auto_escalated = True

    score = SEVERITY_WEIGHT[severity] + waited * aging_rate
    return QueueItem(
        session_id=item.session_id,
        severity=severity,
        enqueued_at=item.enqueued_at,
        auto_escalated=auto_escalated,
        priority_score=score,
    )


def rescore_queue(
    items: list[QueueItem],
    now: datetime | None = None,
    aging_rate: float = 1.0,
    auto_escalate_minutes: int = 45,
) -> list[QueueItem]:
    """Re-score and sort a queue (highest priority first). Pure function."""
    now = now or datetime.now(timezone.utc)
    scored = [score_item(i, now, aging_rate, auto_escalate_minutes) for i in items]
    scored.sort(key=lambda i: i.priority_score, reverse=True)
    return scored
