"""Medicine advisor — local formulary first (Generic-Medicine-Recommendation pattern)
+ optional openFDA enrichment + Cursor consult for plain-language Q&A.

Inspired by:
- https://github.com/ayushk-codes/Generic-Medicine-Recommendation (local JSON + fallback)
- https://github.com/nakibj/drug-interaction-checker (openFDA label lookup)
- https://github.com/Aniket025/Medical-Prescription-OCR (Rx field extraction)

Safety: educational only. Never tells patient to start/stop a medicine on their own.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

import httpx

from app.services.cursor_client import prompt_text
from app.services.ocr_service import extract

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).resolve().parent.parent / "rules" / "medicines_db.json"

DISCLAIMER = (
    "Educational information only — not a prescription or medical advice. "
    "Do not start, stop, or change any medicine without your doctor or pharmacist."
)


def _load_db() -> dict:
    return json.loads(DB_PATH.read_text(encoding="utf-8"))


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def lookup_medicine(query: str) -> dict | None:
    q = _norm(query)
    if not q:
        return None
    db = _load_db()
    best = None
    best_score = 0.0
    for med in db["medicines"]:
        names = [_norm(med["generic_name"])] + [_norm(b) for b in med["brand_names"]]
        for name in names:
            if not name:
                continue
            if q == name or name in q or q in name:
                score = 1.0 if q == name else 0.85
            else:
                # token overlap
                qt, nt = set(q.split()), set(name.split())
                if not qt or not nt:
                    continue
                score = len(qt & nt) / max(len(qt), len(nt))
            if score > best_score:
                best_score = score
                best = med
    if best and best_score >= 0.4:
        return {**best, "match_score": round(best_score, 2)}
    return None


def _openfda_hint(name: str) -> dict | None:
    """Best-effort openFDA label snippet (no key required for low volume)."""
    try:
        with httpx.Client(timeout=6.0) as client:
            for field in ("openfda.brand_name", "openfda.generic_name"):
                res = client.get(
                    "https://api.fda.gov/drug/label.json",
                    params={"search": f'{field}:"{name}"', "limit": 1},
                )
                if res.status_code != 200:
                    continue
                results = res.json().get("results") or []
                if not results:
                    continue
                r0 = results[0]
                openfda = r0.get("openfda") or {}
                return {
                    "source": "openFDA",
                    "brand": (openfda.get("brand_name") or [None])[0],
                    "generic": (openfda.get("generic_name") or [None])[0],
                    "purpose": (r0.get("purpose") or r0.get("indications_and_usage") or [""])[0][:400],
                }
    except Exception as exc:
        logger.info("openFDA lookup skipped: %s", exc)
    return None


def enrich_card(med: dict) -> dict:
    card = {
        "id": med["id"],
        "matched_name": med.get("brand_names", [med["generic_name"]])[0],
        "generic_name": med["generic_name"],
        "class": med["class"],
        "uses": med["uses"],
        "how_to_take": med["how_to_take"],
        "common_side_effects": med["common_side_effects"],
        "avoid_if": med["avoid_if"],
        "alternatives": med["alternatives"],
        "match_score": med.get("match_score"),
        "disclaimer": DISCLAIMER,
    }
    # Prefer local; attach openFDA only as extra context when useful.
    hint = _openfda_hint(med["generic_name"].split("+")[0].strip().split()[0])
    if hint:
        card["external_hint"] = hint
    return card


def _lines_from_ocr_fields(fields: list) -> list[str]:
    lines = []
    for f in fields:
        name = getattr(f, "name", None) or (f.get("name") if isinstance(f, dict) else "")
        value = getattr(f, "value", None) or (f.get("value") if isinstance(f, dict) else "")
        name = str(name).lower()
        value = str(value).strip()
        if not value:
            continue
        if any(k in name for k in ("medication", "medicine", "drug", "rx", "tablet", "dose")):
            lines.append(value)
        elif name in ("raw_ocr_text", "diagnosis_or_notes"):
            lines.extend(re.split(r"[\n;]+", value))
    return lines


def _extract_med_phrases(text_lines: list[str]) -> list[str]:
    phrases = []
    for line in text_lines:
        line = line.strip()
        if not line:
            continue
        # Common Indian Rx patterns: "T. Name", "Tab Name", bare brand
        m = re.search(
            r"(?:T\.?|Tab\.?|Cap\.?|Syp\.?)\s*([A-Za-z][A-Za-z0-9\- ]{2,40})",
            line,
            re.I,
        )
        if m:
            phrases.append(m.group(1).strip())
            continue
        # Fallback: whole line if short
        if 3 <= len(line) <= 48 and re.search(r"[A-Za-z]", line):
            phrases.append(re.sub(r"\d+\s*mg.*", "", line, flags=re.I).strip(" -."))
    # unique preserve order
    seen = set()
    out = []
    for p in phrases:
        k = _norm(p)
        if k and k not in seen:
            seen.add(k)
            out.append(p)
    return out[:12]


def analyze_prescription_text(text: str) -> dict:
    """Parse pasted prescription / medicine list without an image."""
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    phrases = _extract_med_phrases(lines)
    medicines: list[dict] = []
    unmatched: list[str] = []
    for p in phrases:
        hit = lookup_medicine(p)
        if hit:
            card = enrich_card(hit)
            card["from_prescription_text"] = p
            medicines.append(card)
        else:
            unmatched.append(p)
    blob = (text or "").lower()
    for med in _load_db()["medicines"]:
        if any(b in blob for b in med["brand_names"]):
            if not any(m["id"] == med["id"] for m in medicines):
                card = enrich_card(med)
                card["from_prescription_text"] = med["brand_names"][0]
                medicines.append(card)
    return {
        "disclaimer": DISCLAIMER,
        "ocr_status": "text",
        "medicines": medicines,
        "unmatched_phrases": unmatched,
        "summary": (
            f"Found {len(medicines)} medicine(s) we can explain."
            if medicines
            else "No medicines matched — try brand names like Oprox-CV or Pantoprazole."
        ),
    }


def analyze_prescription_image(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    ocr = extract(image_bytes, mime_type, "prescription")
    fields = ocr.fields
    lines = _lines_from_ocr_fields(fields)
    if ocr.raw_text:
        lines.extend(re.split(r"[\n;]+", ocr.raw_text))
    phrases = _extract_med_phrases(lines)
    medicines = []
    unmatched = []
    for p in phrases:
        hit = lookup_medicine(p)
        if hit:
            card = enrich_card(hit)
            card["from_prescription_text"] = p
            medicines.append(card)
        else:
            unmatched.append(p)

    # Always try known brands from raw blob if OCR missed structured meds
    blob = " ".join(lines).lower()
    for med in _load_db()["medicines"]:
        if any(b in blob for b in med["brand_names"]):
            if not any(m["id"] == med["id"] for m in medicines):
                card = enrich_card(med)
                card["from_prescription_text"] = med["brand_names"][0]
                medicines.append(card)

    patient_bits = {}
    for f in fields:
        name = f.name if hasattr(f, "name") else f.get("name")
        value = f.value if hasattr(f, "value") else f.get("value")
        if name in ("patient_name", "age", "gender", "date", "doctor_name", "clinic_name", "diagnosis_or_notes", "vitals"):
            patient_bits[name] = value

    return {
        "disclaimer": DISCLAIMER,
        "ocr_status": ocr.status,
        "ocr_fields": [
            {"name": f.name, "value": f.value, "confidence": f.confidence}
            for f in fields
        ],
        "patient_bits": patient_bits,
        "medicines": medicines,
        "unmatched_phrases": unmatched,
        "summary": (
            f"Found {len(medicines)} medicine(s) we can explain from your slip."
            if medicines
            else "Could not confidently match medicines — try a clearer photo or ask about a medicine by name."
        ),
    }


def alternatives_for(query: str) -> dict:
    hit = lookup_medicine(query)
    if not hit:
        return {
            "query": query,
            "found": False,
            "message": "Medicine not in local formulary. Ask your doctor/pharmacist before switching.",
            "disclaimer": DISCLAIMER,
        }
    return {
        "query": query,
        "found": True,
        "medicine": enrich_card(hit),
        "disclaimer": DISCLAIMER,
    }


def consult(question: str, context_medicines: list[str] | None = None) -> dict:
    """Plain-language consult. Prefers local facts; Cursor optional for wording."""
    q = (question or "").strip()
    if not q:
        return {"answer": "Ask me about a medicine name, side effects, or alternatives.", "disclaimer": DISCLAIMER}

    # Prefer any known brand mentioned in the question (Hindi "nahi khani"
    # patterns otherwise steal a wrong token after "nahi").
    name_guess = None
    q_low = q.lower()
    for med in _load_db()["medicines"]:
        for b in med["brand_names"]:
            if b and b in q_low:
                name_guess = b
                break
        if name_guess:
            break
    if not name_guess:
        alt_match = re.search(
            r"(?:don'?t want|avoid|alternative for|instead of|replace|switch)\s+(?:to\s+)?([A-Za-z0-9\- ]{2,40})",
            q,
            re.I,
        )
        if alt_match:
            name_guess = alt_match.group(1).strip()

    local = lookup_medicine(name_guess) if name_guess else None
    facts = ""
    if local:
        card = enrich_card(local)
        facts = (
            f"Matched: {card['generic_name']} ({card['class']}). "
            f"Uses: {', '.join(card['uses'][:3])}. "
            f"Alternatives (doctor must approve): "
            + "; ".join(f"{a['name']} — {a['reason']}" for a in card["alternatives"])
        )

    ctx = ", ".join(context_medicines or [])
    prompt = (
        "You are a careful clinic medicine educator in India. "
        "Use ONLY the facts given. Do NOT invent drug names or doses. "
        "If the patient does not want a medicine, explain they must ask their doctor "
        "before changing anything, then list the provided alternatives as discussion options. "
        "Keep 4–6 short sentences, warm and clear. End with the disclaimer.\n\n"
        f"Patient question: {q}\n"
        f"Prescription context medicines: {ctx or 'none'}\n"
        f"Local formulary facts: {facts or 'none matched'}\n"
        f"Disclaimer to include: {DISCLAIMER}"
    )
    text = prompt_text(prompt, timeout_s=20.0)
    if not text:
        # Deterministic fallback
        if local:
            alts = enrich_card(local)["alternatives"]
            alt_txt = "; ".join(a["name"] for a in alts)
            text = (
                f"About {local['generic_name']}: it is used for {', '.join(local['uses'][:2])}. "
                f"If you prefer not to take this brand, do not stop it yourself — ask your doctor. "
                f"Possible options they may discuss: {alt_txt}. {DISCLAIMER}"
            )
        else:
            text = (
                "I can explain medicines from your prescription or by name. "
                "Tell me which tablet (e.g. Oprox-CV) you want to understand or replace. "
                f"{DISCLAIMER}"
            )
    return {
        "answer": text,
        "matched": enrich_card(local) if local else None,
        "disclaimer": DISCLAIMER,
    }
