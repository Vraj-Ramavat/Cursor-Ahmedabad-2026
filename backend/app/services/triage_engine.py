"""Deterministic red-flag triage engine.

WHY THIS EXISTS AND WHY IT IS THE WAY IT IS
-------------------------------------------
This module contains ZERO LLM calls. It is the safety-critical core of the
system and has no external dependencies, so it keeps working even when Groq,
Gemini, Redis, and the network are all down.

The single most important invariant is *one-way escalation*: given a current
severity, applying the rules can only raise it (green -> amber -> red) and can
never lower it. The engine always runs AFTER any LLM step, so even a fully
compromised or hallucinating LLM cannot talk the system down from a red flag.
See `evaluate()` and the `escalate_only` merge logic below.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import jsonschema

RULES_DIR = Path(__file__).resolve().parent.parent / "rules"
DEFAULT_RULE_FILE = RULES_DIR / "triage_rules.json"
SCHEMA_FILE = RULES_DIR / "triage_rules.schema.json"

SEVERITY_RANK = {"green": 0, "amber": 1, "red": 2}


@dataclass
class TriageResult:
    severity: str
    triggered_rules: list[dict] = field(default_factory=list)
    rule_file_version: str = ""


class RuleValidationError(Exception):
    """Raised when the rule file fails schema validation. Startup must fail fast."""


def load_rules(rule_file: Path = DEFAULT_RULE_FILE) -> dict:
    """Load and schema-validate the rule file. Raises on any problem (fail fast)."""
    schema = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))
    try:
        data = json.loads(rule_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuleValidationError(f"Could not read rule file: {exc}") from exc

    try:
        jsonschema.validate(instance=data, schema=schema)
    except jsonschema.ValidationError as exc:
        raise RuleValidationError(f"Rule file failed schema validation: {exc.message}") from exc

    return data


def _rule_matches(text: str, match: dict) -> bool:
    any_kw = match["any_keywords"]
    if not any(kw in text for kw in any_kw):
        return False
    with_kw = match.get("with_any_keywords")
    if with_kw:
        return any(kw in text for kw in with_kw)
    return True


class TriageEngine:
    def __init__(self, rules: dict | None = None):
        self._rules = rules or load_rules()

    @property
    def version(self) -> str:
        return self._rules.get("version", "unknown")

    def evaluate(self, phrases: list[str], current_severity: str = "green") -> TriageResult:
        """Evaluate phrases and return the escalated severity.

        `current_severity` is the severity so far (e.g. from an earlier step).
        The result is guaranteed to be >= current_severity in rank; the engine
        never downgrades.
        """
        text = " ".join(phrases).lower()
        severity = current_severity
        triggered: list[dict] = []

        for rule in self._rules["rules"]:
            if _rule_matches(text, rule["match"]):
                triggered.append(rule)
                severity = self._escalate_only(severity, rule["severity"])

        return TriageResult(
            severity=severity,
            triggered_rules=triggered,
            rule_file_version=self.version,
        )

    @staticmethod
    def _escalate_only(current: str, candidate: str) -> str:
        """Return the higher-ranked of the two severities. Never downgrades."""
        return current if SEVERITY_RANK[current] >= SEVERITY_RANK[candidate] else candidate

    def merge_with_llm_severity(self, deterministic: str, llm_suggested: str) -> str:
        """Reconcile an LLM-suggested severity with the deterministic result.

        Deliberately ignores any LLM attempt to LOWER severity. The LLM can only
        ever push severity up, matching the same one-way invariant. In practice
        the LLM is not trusted for severity at all, but this guard makes the
        intended direction explicit and testable.
        """
        return self._escalate_only(deterministic, llm_suggested)
