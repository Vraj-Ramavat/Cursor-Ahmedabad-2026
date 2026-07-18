"""OCR document upload endpoints (patient-facing).

Uploads a prescription/lab/imaging document, runs Gemini Vision extraction with
confidence scoring, and stores a compact summary that appears on the doctor's
briefing. Low-confidence fields are flagged for one-tap correction; corrections
are logged as a separate feedback signal.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import FieldSource, IntakeSession, UploadedDocument
from app.schemas import DocumentFieldOut, UploadedDocumentOut
from app.services import audit
from app.services.ocr_service import extract

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.post("/upload", response_model=UploadedDocumentOut)
async def upload_document(
    session_id: str = Form(...),
    doc_type: str = Form("prescription"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    session = db.get(IntakeSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")

    content = await file.read()
    result = extract(content, file.content_type or "image/jpeg", doc_type)

    fields = [
        {"name": f.name, "value": f.value, "confidence": f.confidence,
         "low_confidence": f.low_confidence}
        for f in result.fields
    ]
    doc = UploadedDocument(
        session_id=session_id,
        doc_type=doc_type,
        filename=file.filename or "upload",
        extracted_fields=fields,
        low_confidence_count=result.low_confidence_count,
        source=FieldSource.ocr_extracted,
    )
    db.add(doc)
    audit.log_phi_access(
        db, actor_id=session.patient_id, actor_role="patient",
        patient_id=session.patient_id, field_accessed=f"document:{doc_type}",
        endpoint="/api/documents/upload",
    )
    db.commit()

    return UploadedDocumentOut(
        id=doc.id,
        session_id=session_id,
        doc_type=doc_type,
        filename=doc.filename,
        fields=[DocumentFieldOut(**f) for f in fields],
        low_confidence_count=result.low_confidence_count,
        source=doc.source.value,
    )


@router.post("/{doc_id}/correct", response_model=UploadedDocumentOut)
def correct_field(
    doc_id: str, field_name: str = Form(...), corrected_value: str = Form(...),
    db: Session = Depends(get_db),
):
    doc = db.get(UploadedDocument, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="document not found")

    fields = list(doc.extracted_fields)
    corrections = list(doc.correction_log)
    for f in fields:
        if f["name"] == field_name:
            corrections.append({"field": field_name, "from": f["value"], "to": corrected_value})
            f["value"] = corrected_value
            f["low_confidence"] = False
    doc.extracted_fields = fields
    doc.correction_log = corrections
    doc.low_confidence_count = sum(1 for f in fields if f.get("low_confidence"))
    db.commit()

    return UploadedDocumentOut(
        id=doc.id, session_id=doc.session_id, doc_type=doc.doc_type,
        filename=doc.filename,
        fields=[DocumentFieldOut(**f) for f in fields],
        low_confidence_count=doc.low_confidence_count, source=doc.source.value,
    )
