"""Pydantic request/response schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class IntakeStartRequest(BaseModel):
    patient_name: str
    chief_complaint: str
    age: int | None = None
    gender: str | None = None
    phone: str | None = None
    abha_id: str | None = None


class IntakeStartResponse(BaseModel):
    session_id: str
    patient_id: str
    correlation_id: str
    greeting: str
    question: str | None
    node_id: str | None
    complete: bool
    severity: str


class IntakeAnswerRequest(BaseModel):
    session_id: str
    node_id: str
    answer: str


class IntakeAnswerResponse(BaseModel):
    session_id: str
    acknowledgement: str | None = None
    question: str | None
    node_id: str | None
    complete: bool
    severity: str


class QueueEntryOut(BaseModel):
    session_id: str
    patient_id: str
    patient_name: str
    age: int | None = None
    gender: str | None = None
    chief_complaint: str | None = None
    document_count: int = 0
    severity: str
    priority_score: float
    auto_escalated: bool
    minutes_waited: float


class QueueStatusResponse(BaseModel):
    live: bool = Field(description="False when Redis/Celery is down; ordering is last-known.")
    banner: str | None = None
    entries: list[QueueEntryOut]


class BriefingOut(BaseModel):
    session_id: str
    severity: str
    structured_summary: dict
    paraphrased_prose: str | None
    paraphrase_status: str
    triggered_rules: list[str] = []


class SelfCareNoteOut(BaseModel):
    id: str
    session_id: str
    draft_text: str
    final_text: str | None
    approval_status: str
    sent_to_patient: bool


class SelfCareApproveRequest(BaseModel):
    doctor_id: str
    edited_text: str | None = None


class DocumentFieldOut(BaseModel):
    name: str
    value: str
    confidence: float
    low_confidence: bool


class UploadedDocumentOut(BaseModel):
    id: str
    session_id: str
    doc_type: str
    filename: str
    fields: list[DocumentFieldOut]
    low_confidence_count: int
    source: str


class TranscriptMessage(BaseModel):
    role: str  # "assistant" | "patient"
    text: str
    at: str | None = None


class SymptomOut(BaseModel):
    raw_phrase: str
    icd10_code: str | None
    snomed_code: str | None
    canonical_term: str | None
    source: str | None


class EscalationOut(BaseModel):
    from_severity: str | None
    to_severity: str
    rule_id: str | None
    reason: str
    at: datetime


class PatientProfileOut(BaseModel):
    id: str
    name: str
    age: int | None
    gender: str | None
    phone: str | None
    abha_id: str | None
    registered_at: datetime


class SessionDetailOut(BaseModel):
    """Everything the doctor needs about one patient visit, in one payload."""

    session_id: str
    correlation_id: str
    patient: PatientProfileOut
    chief_complaint: str | None
    severity: str
    completed: bool
    started_at: datetime
    transcript: list[TranscriptMessage]
    symptoms: list[SymptomOut]
    escalations: list[EscalationOut]
    documents: list[UploadedDocumentOut]
    briefing: BriefingOut | None
    self_care_note: SelfCareNoteOut | None


class VoiceTranscribeResponse(BaseModel):
    text: str | None
    status: str  # "ok" | "pending — retry"


class HealthResponse(BaseModel):
    status: str
    time: datetime
