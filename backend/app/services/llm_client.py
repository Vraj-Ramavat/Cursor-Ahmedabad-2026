"""Groq LLM client with a hard PHI-redaction gate and degrade behavior.

WHY THE SCOPE IS NARROW
-----------------------
The LLM is permitted only three jobs (constraint 1): paraphrasing structured
data into briefing prose, parsing free-text symptoms when the local table has no
match, and drafting the general self-care note. It must never emit a diagnosis,
drug name, dosage, or treatment recommendation. The prompts below are written to
enforce that, and the deterministic engines downstream mean an LLM failure can
never become clinical fact.

WHY THE REDACTION GATE IS HERE
------------------------------
`_guarded_call` runs `redact()` on every outbound prompt before it leaves the
process, records the redaction categories (never raw PHI), and only then calls
Groq. There is no code path that reaches the provider without passing this gate.

DEGRADE BEHAVIOR
----------------
If GROQ_API_KEY is unset or the call fails/rate-limits, methods return `None`
(and log it). Callers translate `None` into the visible "pending — retry" state
rather than blocking the briefing. The safety-critical path never calls this.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.core.config import settings
from app.services.phi_redaction import RedactionResult, redact

logger = logging.getLogger(__name__)

_SELF_CARE_SYSTEM = (
    "You draft GENERAL self-care guidance for a patient awaiting a doctor. "
    "You MUST NOT name any medication, dosage, diagnosis, or treatment. "
    "Only general advice: rest, hydration, and clear signs that mean they should "
    "seek care sooner. Keep it to 3-4 short sentences. This draft is reviewed by "
    "a doctor before the patient ever sees it."
)

_PARAPHRASE_SYSTEM = (
    "You convert structured intake data into a concise, neutral pre-visit briefing "
    "for a doctor. Summarize only what is given. Do NOT diagnose, do NOT suggest "
    "medications or treatments, do NOT infer severity. Plain clinical prose."
)


@dataclass
class LLMOutcome:
    text: str | None
    redaction: RedactionResult | None
    ok: bool


def _get_client():
    if not settings.groq_api_key:
        return None
    try:
        from groq import Groq

        return Groq(api_key=settings.groq_api_key)
    except Exception as exc:  # pragma: no cover - import/config guard
        logger.warning("Groq client unavailable: %s", exc)
        return None


def _guarded_call(
    system: str,
    user_content: str,
    correlation_id: str | None,
    redaction_sink=None,
    model: str = "llama-3.3-70b-versatile",
) -> LLMOutcome:
    """Run the redaction gate, then call Groq. Returns LLMOutcome(ok=False) on any failure."""
    guarded = redact(user_content)
    if redaction_sink is not None:
        redaction_sink("groq", guarded.redacted_categories, guarded.injection_flagged)
    logger.info(
        "llm_outbound",
        extra={
            "event": "llm_outbound",
            "provider": "groq",
            "correlation_id": correlation_id,
            "redacted_categories": guarded.redacted_categories,
            "injection_flagged": guarded.injection_flagged,
        },
    )

    client = _get_client()
    if client is None:
        return LLMOutcome(None, guarded, ok=False)

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": guarded.text},
            ],
            temperature=0.2,
        )
        return LLMOutcome(resp.choices[0].message.content, guarded, ok=True)
    except Exception as exc:
        logger.warning("Groq call failed (degrading): %s", exc)
        return LLMOutcome(None, guarded, ok=False)


def paraphrase_briefing(
    structured_summary: dict, correlation_id: str | None = None, redaction_sink=None
) -> LLMOutcome:
    content = "Structured intake data:\n" + "\n".join(
        f"- {k}: {v}" for k, v in structured_summary.items()
    )
    return _guarded_call(_PARAPHRASE_SYSTEM, content, correlation_id, redaction_sink)


def draft_self_care_note(
    structured_summary: dict, correlation_id: str | None = None, redaction_sink=None
) -> LLMOutcome:
    content = (
        "Patient presentation (general, non-diagnostic):\n"
        + "\n".join(f"- {k}: {v}" for k, v in structured_summary.items())
    )
    return _guarded_call(_SELF_CARE_SYSTEM, content, correlation_id, redaction_sink)
