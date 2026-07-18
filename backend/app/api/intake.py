"""Intake -> triage -> briefing endpoints.

Every call runs under a correlation_id (set by middleware) that threads through
logs, the triage step, and later queue re-scoring, so a single intake session is
traceable end-to-end.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_triage_engine
from app.core.database import get_db
from app.core.logging import correlation_id_var
from app.models import (
    Briefing,
    ConsentRecord,
    EscalationLog,
    IntakeSession,
    Patient,
    QueueEntry,
    SelfCareNote,
    Severity,
    Symptom,
)
from app.schemas import (
    BriefingOut,
    IntakeAnswerRequest,
    IntakeAnswerResponse,
    IntakeStartRequest,
    IntakeStartResponse,
)
from app.services import audit
from app.services.decision_tree import DecisionTree
from app.services.icd10_lookup import lookup
from app.services.llm_client import draft_self_care_note, paraphrase_briefing
from app.services.triage_engine import TriageEngine

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/intake", tags=["intake"])


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


@router.post("/start", response_model=IntakeStartResponse)
def start_intake(
    req: IntakeStartRequest,
    db: Session = Depends(get_db),
    engine: TriageEngine = Depends(get_triage_engine),
):
    patient = Patient(
        name=req.patient_name,
        age=req.age,
        gender=req.gender,
        phone=req.phone,
        abha_id=req.abha_id,
    )
    db.add(patient)
    db.flush()

    session = IntakeSession(
        patient_id=patient.id,
        chief_complaint=req.chief_complaint,
        correlation_id=correlation_id_var.get() or "none",
    )
    db.add(session)
    db.flush()

    # Consent artifact for any downstream PHI-touching LLM call (mocked in sandbox).
    db.add(
        ConsentRecord(
            patient_id=patient.id,
            abha_id=req.abha_id,
            scope="symptom_keywords_to_llm",
            purpose="pre_visit_briefing",
        )
    )

    # Seed the queue entry at green; triage escalates as answers arrive.
    db.add(QueueEntry(session_id=session.id, patient_id=patient.id, severity=Severity.green))

    tree = DecisionTree(req.chief_complaint)
    nq = tree.first_question()
    session.decision_tree_state = {}

    first_name = req.patient_name.split()[0] if req.patient_name.strip() else "there"
    greeting = (
        f"Hi {first_name}, you're registered. I'll ask a few quick questions so the "
        f"doctor has everything ready before you go in \u2014 this is not a diagnosis, "
        f"just preparation."
    )

    # Record the conversation exactly as the patient experiences it.
    transcript = [
        {"role": "patient", "text": req.chief_complaint, "at": _now_iso()},
        {"role": "assistant", "text": greeting, "at": _now_iso()},
    ]
    if nq.question:
        transcript.append({"role": "assistant", "text": nq.question, "at": _now_iso()})
    session.transcript = transcript

    # Flush so the just-added QueueEntry is queryable by _apply_severity (the
    # session uses autoflush=False).
    db.flush()

    # Always run deterministic triage on the chief complaint up front so severity
    # is meaningful immediately. If there is no decision tree for this complaint,
    # the intake is complete now, so finalize the briefing here too.
    triage = engine.evaluate([req.chief_complaint])
    _apply_severity(db, session, triage, "green")
    if nq.complete:
        session.completed = True
        _finalize_briefing(db, session, triage)

    db.commit()

    logger.info(
        "intake_started",
        extra={"event": "intake_started", "session_id": session.id,
               "correlation_id": session.correlation_id},
    )
    return IntakeStartResponse(
        session_id=session.id,
        patient_id=patient.id,
        correlation_id=session.correlation_id,
        greeting=greeting,
        question=nq.question,
        node_id=nq.node_id,
        complete=nq.complete,
        severity=triage.severity,
    )


@router.post("/answer", response_model=IntakeAnswerResponse)
def answer_intake(
    req: IntakeAnswerRequest,
    db: Session = Depends(get_db),
    engine: TriageEngine = Depends(get_triage_engine),
):
    session = db.get(IntakeSession, req.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    correlation_id_var.set(session.correlation_id)

    tree = DecisionTree(session.chief_complaint)
    state = dict(session.decision_tree_state or {})
    nq = tree.answer(req.node_id, req.answer, state)
    session.decision_tree_state = state

    # Append to the visible conversation transcript.
    transcript = list(session.transcript or [])
    transcript.append({"role": "patient", "text": req.answer, "at": _now_iso()})
    if nq.question:
        transcript.append({"role": "assistant", "text": nq.question, "at": _now_iso()})
    elif nq.complete:
        transcript.append({
            "role": "assistant",
            "text": "Thank you \u2014 that's everything I need. You're in the queue now; "
                    "you can see your live position here, and you can upload any "
                    "prescriptions or reports while you wait.",
            "at": _now_iso(),
        })
    session.transcript = transcript

    # Map the raw answer to a code via local table first; log LLM fallbacks.
    result = lookup(
        req.answer,
        fallback_logger=lambda phrase, sim: audit.log_icd10_fallback(db, phrase, sim),
    )
    db.add(
        Symptom(
            session_id=session.id,
            raw_phrase=req.answer,
            icd10_code=result.icd10_code,
            snomed_code=result.snomed_code,
            canonical_term=result.canonical_term,
            source=result.source,
        )
    )

    # Deterministic triage: chief complaint + all answers + decision-tree hints.
    phrases = [session.chief_complaint or ""] + list(state.values()) + nq.red_flag_hints
    prior = _current_severity(db, session.id)
    triage = engine.evaluate(phrases, current_severity=prior)
    _apply_severity(db, session, triage, prior)

    if nq.complete:
        session.completed = True
        _finalize_briefing(db, session, triage)

    db.commit()
    return IntakeAnswerResponse(
        session_id=session.id,
        question=nq.question,
        node_id=nq.node_id,
        complete=nq.complete,
        severity=triage.severity,
    )


@router.get("/{session_id}/briefing", response_model=BriefingOut)
def get_briefing(session_id: str, db: Session = Depends(get_db)):
    session = db.get(IntakeSession, session_id)
    if session is None or session.briefing is None:
        raise HTTPException(status_code=404, detail="briefing not found")
    audit.log_phi_access(
        db, actor_id=None, actor_role="doctor", patient_id=session.patient_id,
        field_accessed="briefing", endpoint=f"/api/intake/{session_id}/briefing",
    )
    b = session.briefing
    return BriefingOut(
        session_id=session_id,
        severity=b.severity.value,
        structured_summary=b.structured_summary,
        paraphrased_prose=b.paraphrased_prose,
        paraphrase_status=b.paraphrase_status,
    )


def _current_severity(db: Session, session_id: str) -> str:
    entry = db.query(QueueEntry).filter(QueueEntry.session_id == session_id).first()
    return entry.severity.value if entry else "green"


def _apply_severity(db: Session, session: IntakeSession, triage, prior: str) -> None:
    entry = db.query(QueueEntry).filter(QueueEntry.session_id == session.id).first()
    if entry and triage.severity != prior:
        db.add(
            EscalationLog(
                session_id=session.id,
                from_severity=Severity(prior),
                to_severity=Severity(triage.severity),
                rule_id=triage.triggered_rules[-1]["id"] if triage.triggered_rules else None,
                reason="deterministic rule escalation",
                rule_file_version=triage.rule_file_version,
            )
        )
        entry.severity = Severity(triage.severity)


def _finalize_briefing(db: Session, session: IntakeSession, triage) -> None:
    summary = {
        "chief_complaint": session.chief_complaint,
        **(session.decision_tree_state or {}),
        "severity": triage.severity,
        "triggered_rules": [r["id"] for r in triage.triggered_rules],
    }
    # LLM paraphrase; degrade to "pending — retry" if unavailable.
    outcome = paraphrase_briefing(
        summary, session.correlation_id,
        redaction_sink=lambda p, c, i: audit.log_redaction(db, p, c, i),
    )
    briefing = Briefing(
        session_id=session.id,
        severity=Severity(triage.severity),
        structured_summary=summary,
        paraphrased_prose=outcome.text,
        paraphrase_status="ready" if outcome.ok else "pending — retry",
    )
    db.add(briefing)

    # Doctor-gated self-care note draft (never reaches patient until approved).
    note_outcome = draft_self_care_note(
        summary, session.correlation_id,
        redaction_sink=lambda p, c, i: audit.log_redaction(db, p, c, i),
    )
    if note_outcome.ok and note_outcome.text:
        db.add(SelfCareNote(session_id=session.id, draft_text=note_outcome.text))
