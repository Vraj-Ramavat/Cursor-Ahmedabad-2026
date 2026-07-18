"""Medicine advisor API — prescription explain + consult + alternatives.

Pattern adapted from open-source Generic-Medicine-Recommendation (local JSON
formulary first) with optional openFDA enrichment.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.api.auth import get_current_patient
from app.models import Patient
from app.services import medicine_advisor

router = APIRouter(prefix="/api/medicines", tags=["medicines"])


class ConsultBody(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    context_medicines: list[str] = Field(default_factory=list)


class TextAnalyzeBody(BaseModel):
    text: str = Field(..., min_length=3, max_length=8000)


@router.get("/lookup")
def lookup(q: str, patient: Patient = Depends(get_current_patient)):
    hit = medicine_advisor.lookup_medicine(q)
    if not hit:
        raise HTTPException(status_code=404, detail="medicine not found in formulary")
    return medicine_advisor.enrich_card(hit)


@router.get("/alternatives")
def alternatives(q: str, patient: Patient = Depends(get_current_patient)):
    return medicine_advisor.alternatives_for(q)


@router.post("/analyze")
async def analyze_prescription(
    file: UploadFile = File(...),
    patient: Patient = Depends(get_current_patient),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="empty file")
    return medicine_advisor.analyze_prescription_image(
        content, file.content_type or "image/jpeg"
    )


@router.post("/analyze-text")
def analyze_text(
    body: TextAnalyzeBody,
    patient: Patient = Depends(get_current_patient),
):
    return medicine_advisor.analyze_prescription_text(body.text)


@router.post("/consult")
def consult(body: ConsultBody, patient: Patient = Depends(get_current_patient)):
    return medicine_advisor.consult(body.question, body.context_medicines)
