"""PHI-access audit logging (constraint 9).

Every PHI read is recorded: who, which field, when, via which endpoint. This is a
demo-able artifact and the foundation for the RBAC model described in
ARCHITECTURE.md.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.logging import correlation_id_var
from app.models import AuditLogEntry, RedactionLog, ICD10FallbackLog


def log_phi_access(
    db: Session,
    actor_id: str | None,
    actor_role: str,
    patient_id: str | None,
    field_accessed: str,
    endpoint: str,
) -> None:
    entry = AuditLogEntry(
        actor_id=actor_id,
        actor_role=actor_role,
        patient_id=patient_id,
        field_accessed=field_accessed,
        endpoint=endpoint,
        correlation_id=correlation_id_var.get(),
    )
    db.add(entry)
    db.commit()


def log_redaction(
    db: Session, provider: str, categories: list[str], injection_flagged: bool
) -> None:
    db.add(
        RedactionLog(
            provider=provider,
            redacted_categories=categories,
            injection_flagged=injection_flagged,
            correlation_id=correlation_id_var.get(),
        )
    )
    db.commit()


def log_icd10_fallback(db: Session, phrase: str, similarity: float) -> None:
    db.add(
        ICD10FallbackLog(
            unmatched_phrase=phrase,
            best_similarity=similarity,
            correlation_id=correlation_id_var.get(),
        )
    )
    db.commit()
