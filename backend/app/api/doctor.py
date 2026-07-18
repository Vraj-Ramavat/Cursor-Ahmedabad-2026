"""Doctor-facing session detail: everything about one visit in one payload.

This powers the dashboard's patient panel: profile, the full AI-intake
conversation transcript, mapped symptoms with code sources, escalation history,
uploaded documents with OCR fields, the briefing, and the self-care note state.
Every fetch writes a PHI-access audit entry (constraint 9).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import (
    EscalationLog,
    IntakeSession,
    Patient,
    QueueEntry,
    SelfCareNote,
    UploadedDocument,
)
from app.schemas import (
    BriefingOut,
    DocumentFieldOut,
    EscalationOut,
    PatientProfileOut,
    SelfCareNoteOut,
    SessionDetailOut,
    SymptomOut,
    TranscriptMessage,
    UploadedDocumentOut,
)
from app.services import audit

router = APIRouter(prefix="/api/sessions", tags=["doctor"])


@router.get("/{session_id}/detail", response_model=SessionDetailOut)
def session_detail(session_id: str, db: Session = Depends(get_db)):
    session = db.get(IntakeSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")

    patient = db.get(Patient, session.patient_id)
    audit.log_phi_access(
        db, actor_id=None, actor_role="doctor", patient_id=patient.id,
        field_accessed="session_detail", endpoint=f"/api/sessions/{session_id}/detail",
    )

    entry = db.query(QueueEntry).filter(QueueEntry.session_id == session_id).first()
    severity = entry.severity.value if entry else "green"

    escalations = (
        db.query(EscalationLog)
        .filter(EscalationLog.session_id == session_id)
        .order_by(EscalationLog.created_at)
        .all()
    )
    documents = (
        db.query(UploadedDocument)
        .filter(UploadedDocument.session_id == session_id)
        .order_by(UploadedDocument.created_at)
        .all()
    )
    note = (
        db.query(SelfCareNote)
        .filter(SelfCareNote.session_id == session_id)
        .order_by(SelfCareNote.created_at.desc())
        .first()
    )

    briefing_out = None
    if session.briefing is not None:
        b = session.briefing
        briefing_out = BriefingOut(
            session_id=session_id,
            severity=b.severity.value,
            structured_summary=b.structured_summary,
            paraphrased_prose=b.paraphrased_prose,
            paraphrase_status=b.paraphrase_status,
        )

    return SessionDetailOut(
        session_id=session.id,
        correlation_id=session.correlation_id,
        patient=PatientProfileOut(
            id=patient.id,
            name=patient.name,
            age=patient.age,
            gender=patient.gender,
            phone=patient.phone,
            abha_id=patient.abha_id,
            registered_at=patient.created_at,
        ),
        chief_complaint=session.chief_complaint,
        severity=severity,
        completed=session.completed,
        started_at=session.created_at,
        transcript=[TranscriptMessage(**m) for m in (session.transcript or [])],
        symptoms=[
            SymptomOut(
                raw_phrase=s.raw_phrase,
                icd10_code=s.icd10_code,
                snomed_code=s.snomed_code,
                canonical_term=s.canonical_term,
                source=s.source.value if s.source else None,
            )
            for s in session.symptoms
        ],
        escalations=[
            EscalationOut(
                from_severity=e.from_severity.value if e.from_severity else None,
                to_severity=e.to_severity.value,
                rule_id=e.rule_id,
                reason=e.reason,
                at=e.created_at,
            )
            for e in escalations
        ],
        documents=[
            UploadedDocumentOut(
                id=d.id,
                session_id=d.session_id,
                doc_type=d.doc_type,
                filename=d.filename,
                fields=[DocumentFieldOut(**f) for f in d.extracted_fields],
                low_confidence_count=d.low_confidence_count,
                source=d.source.value,
            )
            for d in documents
        ],
        briefing=briefing_out,
        self_care_note=SelfCareNoteOut(
            id=note.id,
            session_id=note.session_id,
            draft_text=note.draft_text,
            final_text=note.final_text,
            approval_status=note.approval_status.value,
            sent_to_patient=note.sent_to_patient,
        )
        if note
        else None,
    )
