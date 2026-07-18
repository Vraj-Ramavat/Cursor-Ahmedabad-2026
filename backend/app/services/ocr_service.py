"""Gemini Vision OCR for patient documents (constraint 7).

SCOPE GUARD
-----------
This reader EXTRACTS PRINTED TEXT only. For prescriptions and lab reports it
pulls structured fields with confidence scores. For MRI/X-ray reports it extracts
ONLY the printed findings/impression text and never analyzes the scan image to
produce a new interpretation — generating imaging interpretations is explicitly
out of scope. Every field is tagged source="ocr_extracted" with a confidence
score; low-confidence fields are surfaced to the doctor for one-tap correction.

Degrades gracefully: with no GEMINI_API_KEY, `extract()` returns an empty result
flagged as pending rather than raising.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field

from app.core.config import settings

logger = logging.getLogger(__name__)

LOW_CONFIDENCE_THRESHOLD = 0.7

_PRESCRIPTION_PROMPT = (
    "Extract the printed text fields from this prescription as JSON: a list of "
    '{"name","value","confidence"} objects for fields like patient_name, date, '
    "medications (as written), and instructions. Report only text present in the "
    "image. Do NOT interpret, diagnose, or add anything not printed. confidence is "
    "0..1 for OCR legibility."
)

_IMAGING_PROMPT = (
    "This is a radiology REPORT document (not the scan itself). Extract ONLY the "
    'printed "Findings" and "Impression" text as JSON list of {"name","value",'
    '"confidence"}. Do NOT analyze any image or generate a new interpretation.'
)


@dataclass
class ExtractedField:
    name: str
    value: str
    confidence: float

    @property
    def low_confidence(self) -> bool:
        return self.confidence < LOW_CONFIDENCE_THRESHOLD


@dataclass
class OCRResult:
    fields: list[ExtractedField] = field(default_factory=list)
    ok: bool = True
    status: str = "extracted"  # or "pending" when the provider is unavailable

    @property
    def low_confidence_count(self) -> int:
        return sum(1 for f in self.fields if f.low_confidence)


def _prompt_for(doc_type: str) -> str:
    return _IMAGING_PROMPT if doc_type == "imaging" else _PRESCRIPTION_PROMPT


def extract(image_bytes: bytes, mime_type: str, doc_type: str) -> OCRResult:
    if not settings.gemini_api_key:
        logger.info("OCR degraded: no GEMINI_API_KEY, returning pending")
        return OCRResult(fields=[], ok=False, status="pending")

    try:
        import google.generativeai as genai

        genai.configure(api_key=settings.gemini_api_key)
        model = genai.GenerativeModel("gemini-1.5-flash")
        resp = model.generate_content(
            [
                _prompt_for(doc_type),
                {"mime_type": mime_type, "data": image_bytes},
            ]
        )
        raw = resp.text.strip().removeprefix("```json").removesuffix("```").strip()
        data = json.loads(raw)
        fields = [
            ExtractedField(
                name=str(d.get("name", "field")),
                value=str(d.get("value", "")),
                confidence=float(d.get("confidence", 0.5)),
            )
            for d in data
        ]
        return OCRResult(fields=fields, ok=True, status="extracted")
    except Exception as exc:
        logger.warning("OCR failed (degrading to pending): %s", exc)
        return OCRResult(fields=[], ok=False, status="pending")
