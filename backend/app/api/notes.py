"""Doctor-gated self-care note approval (constraint 6).

A drafted note stays out of the patient app until a doctor approves or edits it.
If it is not approved within the configured window, it expires and is never sent
(fail-safe).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models import ApprovalStatus, SelfCareNote
from app.schemas import SelfCareApproveRequest, SelfCareNoteOut

router = APIRouter(prefix="/api/self-care", tags=["self-care"])


def _expire_if_stale(note: SelfCareNote) -> None:
    if note.approval_status == ApprovalStatus.pending:
        window = timedelta(hours=settings.self_care_approval_window_hours)
        created = note.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) - created > window:
            note.approval_status = ApprovalStatus.expired


@router.get("/pending", response_model=list[SelfCareNoteOut])
def pending_notes(db: Session = Depends(get_db)):
    notes = db.query(SelfCareNote).filter(
        SelfCareNote.approval_status == ApprovalStatus.pending
    ).all()
    for n in notes:
        _expire_if_stale(n)
    db.commit()
    return [_to_out(n) for n in notes if n.approval_status == ApprovalStatus.pending]


@router.post("/{note_id}/approve", response_model=SelfCareNoteOut)
def approve_note(note_id: str, req: SelfCareApproveRequest, db: Session = Depends(get_db)):
    note = db.get(SelfCareNote, note_id)
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")
    _expire_if_stale(note)
    if note.approval_status == ApprovalStatus.expired:
        raise HTTPException(status_code=409, detail="note expired; not sent (fail-safe)")

    if req.edited_text:
        note.final_text = req.edited_text
        note.approval_status = ApprovalStatus.edited
    else:
        note.final_text = note.draft_text
        note.approval_status = ApprovalStatus.approved
    note.approved_by = req.doctor_id
    note.sent_to_patient = True
    db.commit()
    return _to_out(note)


def _to_out(n: SelfCareNote) -> SelfCareNoteOut:
    return SelfCareNoteOut(
        id=n.id, session_id=n.session_id, draft_text=n.draft_text,
        final_text=n.final_text, approval_status=n.approval_status.value,
        sent_to_patient=n.sent_to_patient,
    )
