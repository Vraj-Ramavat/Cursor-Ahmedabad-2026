"""Medicine advisor — local formulary first + fuzzy OCR resolve + consult.

Clarity_Rx / MediScribe pattern: extract names → fuzzy match Indian brands →
explain from local JSON (Cursor optional for wording only).
"""

from __future__ import annotations

import json
import logging
import re
import tempfile
from difflib import SequenceMatcher
from pathlib import Path

import httpx

from app.services.cursor_client import cursor_keys, prompt_text, prompt_with_image
from app.services.ocr_service import extract

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).resolve().parent.parent / "rules" / "medicines_db.json"

DISCLAIMER = (
    "Educational information only — not a prescription or medical advice. "
    "Do not start, stop, or change any medicine without your doctor or pharmacist."
)

_RX_MEDS_PROMPT = """
You are an Indian clinic prescription reader (handwritten + printed).

Extract EVERY medicine on the slip. Return ONLY valid JSON:
{
  "patient_name": "",
  "age": "",
  "diagnosis_or_notes": "",
  "medicines": [
    {"name": "brand as written", "dose": "", "frequency": "", "quantity": "", "instructions": ""}
  ],
  "raw_text": "short transcription"
}
Do NOT invent medicines. Empty string if unknown.
""".strip()


def _load_db() -> dict:
    return json.loads(DB_PATH.read_text(encoding="utf-8"))


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def _all_aliases(med: dict) -> list[str]:
    names = list(med.get("brand_names") or [])
    names.append(med.get("generic_name") or "")
    names.extend(med.get("ocr_aliases") or [])
    return [n for n in names if n]


def lookup_medicine(query: str, *, threshold: float = 0.58) -> dict | None:
    q = _norm(query)
    if not q:
        return None
    q = re.sub(r"\b\d+\s*(mg|mcg|ml|g)\b", "", q).strip()
    q = re.sub(r"\b(tab|tablet|cap|capsule|syp|syrup|t)\b", "", q).strip()
    if not q:
        return None

    best = None
    best_score = 0.0
    for med in _load_db()["medicines"]:
        for alias in _all_aliases(med):
            name = _norm(alias)
            if not name:
                continue
            if q == name:
                score = 1.0
            elif name in q or q in name:
                score = 0.92
            else:
                score = _ratio(q, name)
                for qt in q.split():
                    if len(qt) < 3:
                        continue
                    for nt in name.split():
                        if len(nt) < 3:
                            continue
                        score = max(score, _ratio(qt, nt) * 0.95)
                        if qt in nt or nt in qt:
                            score = max(score, 0.8)
            if score > best_score:
                best_score = score
                best = med
    if best and best_score >= threshold:
        return {**best, "match_score": round(best_score, 2)}
    return None


def find_medicines_in_blob(text: str, *, threshold: float = 0.72) -> list[dict]:
    blob = _norm(text)
    if not blob:
        return []
    found: list[dict] = []
    seen = set()
    tokens = blob.split()
    windows = set(tokens)
    for i in range(len(tokens)):
        for n in (2, 3):
            if i + n <= len(tokens):
                windows.add(" ".join(tokens[i : i + n]))

    for med in _load_db()["medicines"]:
        hit_alias = None
        hit_score = 0.0
        for alias in _all_aliases(med):
            an = _norm(alias)
            if not an:
                continue
            if an in blob:
                hit_alias, hit_score = alias, 1.0
                break
            for w in windows:
                sc = _ratio(w, an)
                if sc > hit_score:
                    hit_score = sc
                    hit_alias = alias
        if hit_alias and hit_score >= threshold and med["id"] not in seen:
            seen.add(med["id"])
            found.append({**med, "match_score": round(hit_score, 2), "_hit": hit_alias})
    return found


def enrich_card(med: dict, *, external: bool = False) -> dict:
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
    if external:
        try:
            stem = med["generic_name"].split("+")[0].strip().split()[0]
            with httpx.Client(timeout=4.0) as client:
                res = client.get(
                    "https://api.fda.gov/drug/label.json",
                    params={"search": f'openfda.generic_name:"{stem}"', "limit": 1},
                )
                if res.status_code == 200:
                    results = res.json().get("results") or []
                    if results:
                        openfda = results[0].get("openfda") or {}
                        card["external_hint"] = {
                            "source": "openFDA",
                            "brand": (openfda.get("brand_name") or [None])[0],
                            "generic": (openfda.get("generic_name") or [None])[0],
                        }
        except Exception as exc:
            logger.info("openFDA skipped: %s", exc)
    return card


def _parse_rx_json(raw: str) -> dict | None:
    text = (raw or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
    text = re.sub(r"\s*```$", "", text).strip()
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        return None


def _vision_extract_medicines(image_bytes: bytes, mime_type: str) -> dict:
    out = {"medicines": [], "raw_text": "", "source": None, "patient_bits": {}}
    if not image_bytes:
        return out

    raw = prompt_with_image(_RX_MEDS_PROMPT, image_bytes, mime_type, timeout_s=90.0)
    data = _parse_rx_json(raw) if raw else None

    if not data and cursor_keys():
        suffix = ".png" if "png" in (mime_type or "") else ".jpg"
        try:
            with tempfile.TemporaryDirectory() as td:
                path = Path(td) / f"prescription{suffix}"
                path.write_bytes(image_bytes)
                file_prompt = (
                    f"{_RX_MEDS_PROMPT}\n\nImage path:\n{path}\n"
                    "Open that image file and return the JSON."
                )
                raw2 = prompt_text(file_prompt, timeout_s=100.0)
                data = _parse_rx_json(raw2) if raw2 else None
                if data:
                    raw = raw2
                    out["source"] = "cursor_file"
        except Exception as exc:
            logger.warning("file-based Rx OCR failed: %s", exc)

    if data:
        out["source"] = out["source"] or "cursor_vision"
        names = []
        for m in data.get("medicines") or []:
            if isinstance(m, dict):
                name = str(m.get("name") or m.get("medicine") or m.get("drug") or "").strip()
                if name:
                    names.append(name)
            elif isinstance(m, str) and m.strip():
                names.append(m.strip())
        out["medicines"] = names
        out["raw_text"] = str(data.get("raw_text") or raw or "")[:3000]
        for k in ("patient_name", "age", "diagnosis_or_notes"):
            if data.get(k):
                out["patient_bits"][k] = str(data[k])
        return out

    if raw:
        out["raw_text"] = raw[:3000]
        out["source"] = "cursor_raw"
    return out


def _lines_from_ocr_fields(fields: list) -> list[str]:
    lines = []
    for f in fields:
        name = str(getattr(f, "name", None) or (f.get("name") if isinstance(f, dict) else "")).lower()
        value = str(getattr(f, "value", None) or (f.get("value") if isinstance(f, dict) else "")).strip()
        if not value:
            continue
        if any(
            k in name
            for k in (
                "medication",
                "medicine",
                "drug",
                "rx",
                "tablet",
                "dose",
                "raw",
                "note",
                "diagnos",
                "instruction",
                "frequency",
            )
        ):
            lines.extend(re.split(r"[\n;]+", value))
        else:
            lines.append(value)
    return lines


def _extract_med_phrases(text_lines: list[str]) -> list[str]:
    phrases = []
    for line in text_lines:
        line = line.strip()
        if not line:
            continue
        for m in re.finditer(
            r"(?:T\.?|Tab\.?|Cap\.?|Syp\.?)\s*([A-Za-z][A-Za-z0-9\- ]{2,40})",
            line,
            re.I,
        ):
            phrases.append(m.group(1).strip())
        if 3 <= len(line) <= 60 and re.search(r"[A-Za-z]", line):
            cleaned = re.sub(r"\d+\s*mg.*", "", line, flags=re.I).strip(" -.")
            if cleaned:
                phrases.append(cleaned)
    seen = set()
    out = []
    for p in phrases:
        k = _norm(p)
        if k and k not in seen:
            seen.add(k)
            out.append(p)
    return out[:20]


def _cards_from_phrases(phrases: list[str]) -> tuple[list[dict], list[str]]:
    medicines: list[dict] = []
    unmatched: list[str] = []
    seen = set()
    for p in phrases:
        hit = lookup_medicine(p)
        if hit and hit["id"] not in seen:
            seen.add(hit["id"])
            card = enrich_card(hit, external=False)
            card["from_prescription_text"] = p
            medicines.append(card)
        elif not hit:
            unmatched.append(p)
    return medicines, unmatched


def _local_explain(med: dict, *, want_alt: bool = False) -> str:
    card = enrich_card(med)
    brand = card["matched_name"]
    uses = ", ".join(card["uses"][:3])
    sides = ", ".join(card["common_side_effects"][:3])
    alts = "; ".join(f"{a['name']} ({a['reason']})" for a in card["alternatives"])
    parts = [
        f"{brand} is {card['generic_name']} — {card['class']}.",
        f"Commonly used for: {uses}.",
        f"Usually taken: {card['how_to_take']}",
        f"Common side effects: {sides}.",
    ]
    if want_alt:
        parts.append(
            "If you prefer not to take this, do not stop on your own — ask your doctor. "
            f"Options they may discuss: {alts}."
        )
    else:
        parts.append(f"Alternatives a doctor may discuss: {alts}.")
    parts.append(DISCLAIMER)
    return " ".join(parts)


def analyze_prescription_text(text: str) -> dict:
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    # Also treat commas / "and" as separators when user pastes a single line
    if len(lines) <= 1 and text:
        blob = text.replace(",", "\n").replace(" and ", "\n")
        lines = [ln.strip() for ln in blob.splitlines() if ln.strip()]
    phrases = _extract_med_phrases(lines)
    # Single bare name paste: "Oprox-CV"
    if not phrases and text and len(text.strip()) < 48:
        phrases = [text.strip()]
    medicines, unmatched = _cards_from_phrases(phrases)
    for med in find_medicines_in_blob(text or ""):
        if not any(m["id"] == med["id"] for m in medicines):
            card = enrich_card(med, external=False)
            card["from_prescription_text"] = med.get("_hit") or med["brand_names"][0]
            medicines.append(card)
    return {
        "disclaimer": DISCLAIMER,
        "ocr_status": "text",
        "medicines": medicines,
        "unmatched_phrases": unmatched[:12],
        "summary": (
            f"Found {len(medicines)} medicine(s) we can explain."
            if medicines
            else "No medicines matched — try brand names like Oprox-CV or Pantoprazole."
        ),
    }


def analyze_prescription_image(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    phrases: list[str] = []
    patient_bits: dict = {}
    ocr_status = "pending"
    ocr_fields: list[dict] = []
    extract_source = None

    vision = _vision_extract_medicines(image_bytes, mime_type)
    phrases.extend(vision.get("medicines") or [])
    if vision.get("raw_text"):
        phrases.extend(_extract_med_phrases(re.split(r"[\n;]+", vision["raw_text"])))
    patient_bits.update(vision.get("patient_bits") or {})
    if vision.get("source"):
        extract_source = vision["source"]
        ocr_status = "extracted"

    ocr = extract(image_bytes, mime_type, "prescription")
    ocr_fields = [
        {"name": f.name, "value": f.value, "confidence": f.confidence} for f in ocr.fields
    ]
    if ocr.status == "extracted":
        ocr_status = "extracted"
    lines = _lines_from_ocr_fields(ocr.fields)
    if ocr.raw_text:
        lines.extend(re.split(r"[\n;]+", ocr.raw_text))
    phrases.extend(_extract_med_phrases(lines))
    for f in ocr.fields:
        name = f.name if hasattr(f, "name") else f.get("name")
        value = f.value if hasattr(f, "value") else f.get("value")
        if name in (
            "patient_name",
            "age",
            "gender",
            "date",
            "doctor_name",
            "clinic_name",
            "diagnosis_or_notes",
            "vitals",
        ):
            patient_bits.setdefault(name, value)

    medicines, unmatched = _cards_from_phrases(phrases)
    blob = " ".join(
        phrases
        + lines
        + [vision.get("raw_text") or ""]
        + [f.get("value", "") for f in ocr_fields]
    )
    for med in find_medicines_in_blob(blob):
        if not any(m["id"] == med["id"] for m in medicines):
            card = enrich_card(med, external=False)
            card["from_prescription_text"] = med.get("_hit") or med["brand_names"][0]
            medicines.append(card)

    if not medicines and not cursor_keys():
        summary = "OCR is offline (no Cursor API key). Paste medicine names below."
    elif not medicines:
        summary = (
            "Could not read medicines from this photo yet — try a clearer shot, "
            "or paste names (e.g. Oprox-CV, Altrose-SP, Breezy, Shipen-D)."
        )
    else:
        summary = f"Found {len(medicines)} medicine(s) we can explain from your slip."

    return {
        "disclaimer": DISCLAIMER,
        "ocr_status": ocr_status,
        "extract_source": extract_source or ocr.status,
        "ocr_fields": ocr_fields,
        "patient_bits": patient_bits,
        "medicines": medicines,
        "unmatched_phrases": unmatched[:12],
        "summary": summary,
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
    """Always answer from local formulary first — never depend on Cursor for the reply."""
    q = (question or "").strip()
    if not q:
        return {
            "answer": "Ask me about a medicine name, side effects, or alternatives.",
            "disclaimer": DISCLAIMER,
        }

    want_alt = bool(
        re.search(
            r"nahi|naa|don'?t want|avoid|alternative|replace|switch|instead",
            q,
            re.I,
        )
    )

    # 1) Match every formulary brand mentioned in the question / paste
    matched: list[dict] = []
    seen = set()
    q_low = q.lower()
    for med in _load_db()["medicines"]:
        for b in _all_aliases(med):
            if b and b.lower() in q_low and med["id"] not in seen:
                seen.add(med["id"])
                matched.append(med)
                break

    # 2) Fuzzy / analyze-text path for pasted lists
    if not matched:
        analyzed = analyze_prescription_text(q)
        for card in analyzed.get("medicines") or []:
            hit = lookup_medicine(card.get("from_prescription_text") or card.get("matched_name") or "")
            if hit and hit["id"] not in seen:
                seen.add(hit["id"])
                matched.append(hit)

    # 3) Context medicines from current Rx result
    for name in context_medicines or []:
        hit = lookup_medicine(name)
        if hit and hit["id"] not in seen and (
            want_alt or _norm(name) in _norm(q) or len(matched) == 0
        ):
            # Only pull context if question is vague or mentions it
            if len(matched) == 0 or _norm(name) in _norm(q):
                seen.add(hit["id"])
                matched.append(hit)

    if not matched:
        # Last try: lookup whole question as one name
        hit = lookup_medicine(q)
        if hit:
            matched = [hit]

    if matched:
        # Prefer local deterministic answer (reliable). Optional Cursor polish.
        local_answer = "\n\n".join(_local_explain(m, want_alt=want_alt) for m in matched[:4])
        facts = " | ".join(
            f"{m.get('brand_names', [''])[0]}: {m['generic_name']}" for m in matched[:4]
        )
        polished = prompt_text(
            "Rewrite this medicine education answer in 4–8 short warm sentences. "
            "Keep all drug facts. Do not invent medicines. Keep the disclaimer.\n\n"
            f"Question: {q}\nFacts: {facts}\nDraft:\n{local_answer}",
            timeout_s=12.0,
        )
        return {
            "answer": polished or local_answer,
            "matched": enrich_card(matched[0]),
            "medicines": [enrich_card(m) for m in matched],
            "disclaimer": DISCLAIMER,
        }

    return {
        "answer": (
            "I could not match that name in our formulary yet. "
            "Try a brand like Oprox-CV, Altrose-SP, Breezy, Shipen-D, or Pantoprazole. "
            f"{DISCLAIMER}"
        ),
        "matched": None,
        "disclaimer": DISCLAIMER,
    }
