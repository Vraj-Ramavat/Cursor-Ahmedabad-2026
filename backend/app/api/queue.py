"""Queue status endpoints (REST + WebSocket).

The REST endpoint reports `live=false` with a visible banner when Redis is down,
serving last-known order rather than silently-stale data. The WebSocket pushes
periodic re-scored snapshots to the doctor dashboard.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.models import IntakeSession, Patient, QueueEntry, UploadedDocument
from app.schemas import QueueEntryOut, QueueStatusResponse
from app.services.queue_service import queue_is_live, rescore_and_persist

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/queue", tags=["queue"])


def _to_out(db: Session, entries: list[QueueEntry]) -> list[QueueEntryOut]:
    now = datetime.now(timezone.utc)
    out = []
    for e in entries:
        enq = e.enqueued_at
        if enq.tzinfo is None:
            enq = enq.replace(tzinfo=timezone.utc)
        patient = db.get(Patient, e.patient_id)
        session = db.get(IntakeSession, e.session_id)
        doc_count = (
            db.query(UploadedDocument)
            .filter(UploadedDocument.session_id == e.session_id)
            .count()
        )
        out.append(
            QueueEntryOut(
                session_id=e.session_id,
                patient_id=e.patient_id,
                patient_name=patient.name if patient else "Unknown",
                age=patient.age if patient else None,
                gender=patient.gender if patient else None,
                chief_complaint=session.chief_complaint if session else None,
                document_count=doc_count,
                severity=e.severity.value,
                priority_score=round(e.priority_score, 2),
                auto_escalated=e.auto_escalated,
                minutes_waited=round((now - enq).total_seconds() / 60.0, 1),
            )
        )
    return out


@router.get("/status", response_model=QueueStatusResponse)
def queue_status(db: Session = Depends(get_db)):
    # Scoring is pure, dependency-free math, so we always compute it on read.
    # Redis only drives the *automatic* background re-score cadence: when it is
    # down, the numbers are still correct on each manual fetch, but there is no
    # live push, which the banner makes explicit (never silently stale).
    entries = rescore_and_persist(db)
    live = queue_is_live()
    banner = None if live else "background auto-rescore paused — Redis/Celery offline"
    return QueueStatusResponse(live=live, banner=banner, entries=_to_out(db, entries))


@router.websocket("/ws")
async def queue_ws(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            db = SessionLocal()
            try:
                entries = rescore_and_persist(db)
                live = queue_is_live()
                banner = (
                    None if live
                    else "background auto-rescore paused — Redis/Celery offline"
                )
                payload = QueueStatusResponse(
                    live=live, banner=banner, entries=_to_out(db, entries)
                )
            finally:
                db.close()
            await websocket.send_json(payload.model_dump())
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        logger.info("queue websocket disconnected")
