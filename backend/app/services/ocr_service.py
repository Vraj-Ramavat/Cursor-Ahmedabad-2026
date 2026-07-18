"""Document OCR via Cursor Agent vision (replaces Gemini).

Supports printed and handwritten prescriptions. Low-confidence fields are
flagged for doctor correction. Never invents drugs not visible in the image.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field

from app.services.cursor_client import cursor_keys, prompt_with_image

logger = logging.getLogger(__name__)

LOW_CONFIDENCE_THRESHOLD = 0.7

_PRESCRIPTION_PROMPT = """
You are a medical document OCR extractor for an Indian clinic.

The image may be printed or HANDWRITTEN (doctor cursive, abbreviations like T. / Tab).

Extract EVERY readable field as a JSON array ONLY:
[{"name":"...","value":"...","confidence":0.0}]

Use keys when present: patient_name, age, gender, date, doctor_name, clinic_name,
diagnosis_or_notes, medication, dosage, frequency, duration, instructions,
vitals, investigations_advised, follow_up, raw_ocr_text.

Rules:
1. Keep abbreviations (Tab, Cap, BD, TDS, SOS, HS, B/F).
2. Each medicine = separate object with name="medication" and value=brand as written
   (e.g. "Oprox-CV 200mg", "Altrose-SP", "Breezy", "Shipen-D 40mg").
3. Also include one object name="raw_ocr_text" with a short full transcription of the Rx body.
4. Unclear words: best guess with confidence <= 0.55.
5. Do NOT invent medicines. Do NOT diagnose.
6. Return ONLY a valid JSON array — no markdown, no commentary.
""".strip()

_IMAGING_PROMPT = """
Radiology REPORT only. Extract Findings/Impression as JSON array of
{"name","value","confidence"}. Do NOT interpret the scan. JSON array only.
""".strip()

_LAB_PROMPT = """
Extract lab fields as JSON array of {"name","value","confidence"}.
Include test_name, result, unit, reference_range, date when visible. JSON only.
""".strip()


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
    status: str = "extracted"
    raw_text: str | None = None

    @property
    def low_confidence_count(self) -> int:
        return sum(1 for f in self.fields if f.low_confidence)


def _prompt_for(doc_type: str) -> str:
    if doc_type == "imaging":
        return _IMAGING_PROMPT
    if doc_type == "lab_report":
        return _LAB_PROMPT
    return _PRESCRIPTION_PROMPT


def _parse_fields(raw: str) -> list[ExtractedField]:
    text = (raw or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
    text = re.sub(r"\s*```$", "", text).strip()

    data = None
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\[[\s\S]*\]", text)
        if m:
            try:
                data = json.loads(m.group(0))
            except json.JSONDecodeError:
                data = None
        if data is None:
            m2 = re.search(r"\{[\s\S]*\}", text)
            if m2:
                try:
                    data = json.loads(m2.group(0))
                except json.JSONDecodeError:
                    data = None

    if data is None:
        return []

    if isinstance(data, dict):
        if isinstance(data.get("fields"), list):
            data = data["fields"]
        else:
            data = [{"name": k, "value": str(v), "confidence": 0.6} for k, v in data.items()]

    fields: list[ExtractedField] = []
    for d in data if isinstance(data, list) else []:
        if not isinstance(d, dict):
            continue
        name = str(d.get("name") or d.get("field") or "field")
        value = str(d.get("value") or d.get("text") or "").strip()
        if not value:
            continue
        try:
            conf = float(d.get("confidence", 0.55))
        except (TypeError, ValueError):
            conf = 0.55
        fields.append(
            ExtractedField(name=name, value=value, confidence=max(0.0, min(1.0, conf)))
        )
    return fields


def extract(image_bytes: bytes, mime_type: str, doc_type: str) -> OCRResult:
    if not cursor_keys():
        logger.info("OCR degraded: no CURSOR_API_KEY")
        return OCRResult(fields=[], ok=False, status="pending")

    if not image_bytes:
        return OCRResult(fields=[], ok=False, status="pending")

    mime = (mime_type or "image/jpeg").split(";")[0].strip().lower()
    if mime in ("application/octet-stream", "binary/octet-stream", ""):
        mime = "image/jpeg"
    if mime == "image/jpg":
        mime = "image/jpeg"

    raw = prompt_with_image(_prompt_for(doc_type), image_bytes, mime, timeout_s=90.0)
    if not raw:
        return OCRResult(fields=[], ok=False, status="pending")

    fields = _parse_fields(raw)
    if fields:
        for f in fields:
            if f.confidence > 0.9:
                f.confidence = 0.75
        return OCRResult(fields=fields, ok=True, status="extracted", raw_text=raw[:2000])

    if len(raw) > 20:
        return OCRResult(
            fields=[ExtractedField("raw_ocr_text", raw[:1500], 0.45)],
            ok=True,
            status="extracted",
            raw_text=raw[:2000],
        )
    return OCRResult(fields=[], ok=False, status="pending")
