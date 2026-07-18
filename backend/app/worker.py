"""Celery worker + Beat for periodic queue re-scoring.

Runs `rescore_and_persist` on a fixed tick (default 45s, constraint 3). This is
the ONLY job Celery owns; all ordering logic lives in the pure `priority_queue`
module, so a Celery/Redis outage cannot corrupt ordering — it only stops
re-scoring, which the API surfaces as the "live updates paused" banner.

Run:  celery -A app.worker.celery_app worker --beat --loglevel=info
"""

from __future__ import annotations

import logging

from celery import Celery

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.logging import setup_logging
from app.services.queue_service import rescore_and_persist

setup_logging()
logger = logging.getLogger(__name__)

celery_app = Celery("hospital_prep", broker=settings.redis_url, backend=settings.redis_url)


@celery_app.task
def rescore_queue_task() -> int:
    db = SessionLocal()
    try:
        entries = rescore_and_persist(db)
        logger.info("queue_rescored", extra={"event": "queue_rescored", "count": len(entries)})
        return len(entries)
    finally:
        db.close()


@celery_app.on_after_configure.connect
def setup_periodic_tasks(sender, **kwargs):
    sender.add_periodic_task(
        float(settings.celery_beat_interval_seconds),
        rescore_queue_task.s(),
        name="rescore queue on tick",
    )
