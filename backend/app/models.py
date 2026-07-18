"""SQLAlchemy models for the intake -> triage -> queue -> briefing pipeline.

Every model that touches PHI is designed so access can be traced through the
AuditLogEntry table and every ABHA-linked action through ConsentRecord.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Severity(str, enum.Enum):
    green = "green"
    amber = "amber"
    red = "red"


class ApprovalStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    edited = "edited"
    expired = "expired"


class FieldSource(str, enum.Enum):
    local_table = "local_table"
    llm_inferred = "llm_inferred"
    ocr_extracted = "ocr_extracted"


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String, nullable=False)
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gender: Mapped[str | None] = mapped_column(String, nullable=True)
    abha_id: Mapped[str | None] = mapped_column(String, nullable=True)
    phone: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    intake_sessions: Mapped[list[IntakeSession]] = relationship(
        back_populates="patient", cascade="all, delete-orphan"
    )


class Doctor(Base):
    __tablename__ = "doctors"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String, nullable=False)
    department: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class IntakeSession(Base):
    __tablename__ = "intake_sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"))
    correlation_id: Mapped[str] = mapped_column(String, default=_uuid, index=True)
    chief_complaint: Mapped[str | None] = mapped_column(String, nullable=True)
    decision_tree_state: Mapped[dict] = mapped_column(JSON, default=dict)
    # Full chat transcript [{role: "assistant"|"patient", text, at}] so the doctor
    # can read the intake exactly as the patient experienced it.
    transcript: Mapped[list] = mapped_column(JSON, default=list)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    patient: Mapped[Patient] = relationship(back_populates="intake_sessions")
    symptoms: Mapped[list[Symptom]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    briefing: Mapped[Briefing | None] = relationship(
        back_populates="session", uselist=False, cascade="all, delete-orphan"
    )


class Symptom(Base):
    __tablename__ = "symptoms"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("intake_sessions.id"))
    raw_phrase: Mapped[str] = mapped_column(String, nullable=False)
    icd10_code: Mapped[str | None] = mapped_column(String, nullable=True)
    snomed_code: Mapped[str | None] = mapped_column(String, nullable=True)
    canonical_term: Mapped[str | None] = mapped_column(String, nullable=True)
    source: Mapped[FieldSource | None] = mapped_column(Enum(FieldSource), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    session: Mapped[IntakeSession] = relationship(back_populates="symptoms")


class EscalationLog(Base):
    __tablename__ = "escalation_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("intake_sessions.id"))
    from_severity: Mapped[Severity | None] = mapped_column(Enum(Severity), nullable=True)
    to_severity: Mapped[Severity] = mapped_column(Enum(Severity), nullable=False)
    rule_id: Mapped[str | None] = mapped_column(String, nullable=True)
    reason: Mapped[str] = mapped_column(String, nullable=False)
    rule_file_version: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class QueueEntry(Base):
    __tablename__ = "queue_entries"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("intake_sessions.id"))
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"))
    severity: Mapped[Severity] = mapped_column(Enum(Severity), default=Severity.green)
    priority_score: Mapped[float] = mapped_column(Float, default=0.0)
    enqueued_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    last_scored_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    auto_escalated: Mapped[bool] = mapped_column(Boolean, default=False)
    served: Mapped[bool] = mapped_column(Boolean, default=False)


class Briefing(Base):
    __tablename__ = "briefings"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("intake_sessions.id"))
    severity: Mapped[Severity] = mapped_column(Enum(Severity), default=Severity.green)
    structured_summary: Mapped[dict] = mapped_column(JSON, default=dict)
    paraphrased_prose: Mapped[str | None] = mapped_column(Text, nullable=True)
    # "pending — retry" when the LLM was unavailable at generation time.
    paraphrase_status: Mapped[str] = mapped_column(String, default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    session: Mapped[IntakeSession] = relationship(back_populates="briefing")


class SelfCareNote(Base):
    __tablename__ = "self_care_notes"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("intake_sessions.id"))
    draft_text: Mapped[str] = mapped_column(Text, nullable=False)
    final_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    approval_status: Mapped[ApprovalStatus] = mapped_column(
        Enum(ApprovalStatus), default=ApprovalStatus.pending
    )
    approved_by: Mapped[str | None] = mapped_column(ForeignKey("doctors.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    sent_to_patient: Mapped[bool] = mapped_column(Boolean, default=False)


class UploadedDocument(Base):
    __tablename__ = "uploaded_documents"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("intake_sessions.id"))
    doc_type: Mapped[str] = mapped_column(String, nullable=False)  # prescription/lab/imaging
    filename: Mapped[str] = mapped_column(String, nullable=False)
    extracted_fields: Mapped[list] = mapped_column(JSON, default=list)
    correction_log: Mapped[list] = mapped_column(JSON, default=list)
    low_confidence_count: Mapped[int] = mapped_column(Integer, default=0)
    source: Mapped[FieldSource] = mapped_column(
        Enum(FieldSource), default=FieldSource.ocr_extracted
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class AuditLogEntry(Base):
    __tablename__ = "audit_log"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    actor_id: Mapped[str | None] = mapped_column(String, nullable=True)
    actor_role: Mapped[str] = mapped_column(String, nullable=False)
    patient_id: Mapped[str | None] = mapped_column(String, nullable=True)
    field_accessed: Mapped[str] = mapped_column(String, nullable=False)
    endpoint: Mapped[str] = mapped_column(String, nullable=False)
    correlation_id: Mapped[str | None] = mapped_column(String, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=_now)


class ConsentRecord(Base):
    __tablename__ = "consent_records"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"))
    abha_id: Mapped[str | None] = mapped_column(String, nullable=True)
    scope: Mapped[str] = mapped_column(String, nullable=False)  # e.g. "symptom_keywords_to_llm"
    purpose: Mapped[str] = mapped_column(String, nullable=False)
    granted: Mapped[bool] = mapped_column(Boolean, default=True)
    granted_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class RedactionLog(Base):
    """Audit record that the PHI-redaction gate ran. Stores categories, never raw PHI."""

    __tablename__ = "redaction_log"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    correlation_id: Mapped[str | None] = mapped_column(String, nullable=True)
    provider: Mapped[str] = mapped_column(String, nullable=False)  # groq / gemini
    redacted_categories: Mapped[list] = mapped_column(JSON, default=list)
    injection_flagged: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class ICD10FallbackLog(Base):
    """Coverage-gap signal: every phrase the local table could not map."""

    __tablename__ = "icd10_fallback_log"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    correlation_id: Mapped[str | None] = mapped_column(String, nullable=True)
    unmatched_phrase: Mapped[str] = mapped_column(String, nullable=False)
    best_similarity: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
