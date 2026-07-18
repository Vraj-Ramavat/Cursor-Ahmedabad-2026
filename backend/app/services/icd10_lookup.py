"""Local ICD-10 / SNOMED-CT symptom-to-code lookup.

WHY A LOCAL TABLE FIRST
-----------------------
Mapping a patient phrase to a code is done deterministically against a seeded
local dictionary BEFORE any LLM is considered. The LLM is a fallback used only
when local similarity falls below a threshold. This keeps the common path
LLM-free (fast, private, offline-capable) and means every mapped field can be
tagged `source="local_table"` vs `source="llm_inferred"` for auditability.

Every fallback (a phrase the local table could not confidently map) is logged
via `fallback_logger` so the unmatched phrases accumulate into a coverage-gap
signal: "our local table handles X% of real patient phrasing without the LLM."
"""

from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Callable

# canonical phrase -> (icd10, snomed, canonical term)
SYMPTOM_TABLE: dict[str, tuple[str, str, str]] = {
    "chest pain": ("R07.9", "29857009", "Chest pain"),
    "chest tightness": ("R07.89", "23924001", "Chest tightness"),
    "shortness of breath": ("R06.02", "267036007", "Dyspnea"),
    "difficulty breathing": ("R06.00", "267036007", "Dyspnea"),
    "palpitations": ("R00.2", "80313002", "Palpitations"),
    "headache": ("R51.9", "25064002", "Headache"),
    "severe headache": ("R51.9", "25064002", "Severe headache"),
    "dizziness": ("R42", "404640003", "Dizziness"),
    "fainting": ("R55", "271594007", "Syncope"),
    "fever": ("R50.9", "386661006", "Fever"),
    "high fever": ("R50.9", "386661006", "High fever"),
    "chills": ("R68.83", "43724002", "Chills"),
    "cough": ("R05.9", "49727002", "Cough"),
    "sore throat": ("J02.9", "162397003", "Sore throat"),
    "runny nose": ("J00", "64531003", "Rhinorrhea"),
    "nausea": ("R11.0", "422587007", "Nausea"),
    "vomiting": ("R11.10", "422400008", "Vomiting"),
    "diarrhea": ("R19.7", "62315008", "Diarrhea"),
    "abdominal pain": ("R10.9", "21522001", "Abdominal pain"),
    "stomach pain": ("R10.9", "21522001", "Abdominal pain"),
    "lower abdominal pain": ("R10.30", "54586004", "Lower abdominal pain"),
    "back pain": ("M54.9", "161891005", "Back pain"),
    "joint pain": ("M25.50", "57676002", "Arthralgia"),
    "fatigue": ("R53.83", "84229001", "Fatigue"),
    "weakness": ("R53.1", "13791008", "Asthenia"),
    "rash": ("R21", "271807003", "Rash"),
    "swelling": ("R60.9", "65124004", "Swelling"),
    "blurred vision": ("H53.8", "246636008", "Blurred vision"),
    "ear pain": ("H92.09", "16001004", "Earache"),
    "burning urination": ("R30.0", "49650001", "Dysuria"),
    "loss of appetite": ("R63.0", "79890006", "Anorexia"),
}

# Common patient phrasings mapped to a canonical key above.
SYNONYMS: dict[str, str] = {
    "pain in chest": "chest pain",
    "chest hurts": "chest pain",
    "tight chest": "chest tightness",
    "cant breathe": "difficulty breathing",
    "can't catch my breath": "shortness of breath",
    "out of breath": "shortness of breath",
    "heart racing": "palpitations",
    "head hurts": "headache",
    "pounding head": "headache",
    "feeling dizzy": "dizziness",
    "light headed": "dizziness",
    "passed out": "fainting",
    "running a temperature": "fever",
    "hot and shivering": "chills",
    "throwing up": "vomiting",
    "loose motions": "diarrhea",
    "belly pain": "abdominal pain",
    "tummy ache": "abdominal pain",
    "tired all the time": "fatigue",
    "no energy": "fatigue",
    "skin rash": "rash",
    "cannot see clearly": "blurred vision",
    "burning when i pee": "burning urination",
    "not hungry": "loss of appetite",
}


@dataclass
class LookupResult:
    raw_phrase: str
    icd10_code: str | None
    snomed_code: str | None
    canonical_term: str | None
    source: str  # "local_table" | "llm_inferred"
    similarity: float


def _normalize(phrase: str) -> str:
    return " ".join(phrase.lower().strip().split())


def _best_local_match(phrase: str) -> tuple[str | None, float]:
    """Return (canonical_key, similarity) for the best local match."""
    norm = _normalize(phrase)
    if norm in SYMPTOM_TABLE:
        return norm, 1.0
    if norm in SYNONYMS:
        return SYNONYMS[norm], 1.0

    best_key, best_sim = None, 0.0
    candidates = list(SYMPTOM_TABLE) + list(SYNONYMS)
    for cand in candidates:
        # substring containment is a strong signal for symptom phrases
        if cand in norm or norm in cand:
            sim = 0.9
        else:
            sim = SequenceMatcher(None, norm, cand).ratio()
        if sim > best_sim:
            best_key, best_sim = cand, sim
    if best_key in SYNONYMS:
        best_key = SYNONYMS[best_key]
    return best_key, best_sim


def lookup(
    phrase: str,
    threshold: float = 0.75,
    fallback_logger: Callable[[str, float], None] | None = None,
    correlation_id: str | None = None,
) -> LookupResult:
    """Map a patient phrase to a code via the local table, or flag for LLM fallback.

    When the best local similarity is below `threshold`, the phrase is logged as a
    coverage gap and the result is marked `source="llm_inferred"` (the caller is
    then responsible for the actual LLM call, subject to the redaction gate).
    """
    key, sim = _best_local_match(phrase)
    if key is not None and sim >= threshold:
        icd10, snomed, term = SYMPTOM_TABLE[key]
        return LookupResult(phrase, icd10, snomed, term, "local_table", sim)

    if fallback_logger is not None:
        fallback_logger(phrase, sim)
    return LookupResult(phrase, None, None, None, "llm_inferred", sim)
