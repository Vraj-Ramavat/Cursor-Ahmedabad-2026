"""DB-backed queue operations and the Redis liveness probe.

The pure ordering math lives in `priority_queue`; this module persists results and
decides whether the queue is "live". If Redis is unreachable, `queue_is_live()`
returns False and the API surfaces a "live updates paused" banner while still
serving the last-known order (never silently stale — the degrade is visible).
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import QueueEntry, Severity
from app.services.priority_queue import QueueItem, rescore_queue

logger = logging.getLogger(__name__)


def queue_is_live() -> bool:
    """True if Redis is reachable (live re-scoring possible)."""
    try:
        import redis

        client = redis.Redis.from_url(settings.redis_url, socket_connect_timeout=0.5)
        return bool(client.ping())
    except Exception:
        return False


def rescore_and_persist(db: Session) -> list[QueueEntry]:
    """Re-score all unserved entries and persist their new scores/severity."""
    entries = list(db.scalars(select(QueueEntry).where(QueueEntry.served.is_(False))))
    items = [
        QueueItem(
            session_id=e.session_id,
            severity=e.severity.value,
            enqueued_at=e.enqueued_at,
            auto_escalated=e.auto_escalated,
        )
        for e in entries
    ]
    ordered = rescore_queue(
        items,
        aging_rate=settings.queue_aging_rate,
        auto_escalate_minutes=settings.queue_auto_escalate_minutes,
    )
    by_session = {i.session_id: i for i in ordered}
    for e in entries:
        scored = by_session[e.session_id]
        e.severity = Severity(scored.severity)
        e.priority_score = scored.priority_score
        e.auto_escalated = scored.auto_escalated
    db.commit()
    return sorted(entries, key=lambda e: e.priority_score, reverse=True)
