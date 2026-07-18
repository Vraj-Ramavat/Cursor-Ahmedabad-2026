"""Tests for the deterministic triage engine.

Covers >=5 scenarios, including the critical downgrade-attempt test that MUST
fail (i.e. the engine must refuse to downgrade).
"""

import pytest

from app.services.triage_engine import (
    RuleValidationError,
    TriageEngine,
    load_rules,
)


@pytest.fixture(scope="module")
def engine() -> TriageEngine:
    return TriageEngine()


def test_rule_file_loads_and_validates():
    rules = load_rules()
    assert rules["version"]
    assert len(rules["rules"]) >= 5


def test_cardiac_chest_pain_escalates_to_red(engine: TriageEngine):
    result = engine.evaluate(["chest pain radiating to arm", "cold sweat"])
    assert result.severity == "red"
    assert any(r["id"] == "chest_pain_cardiac_red" for r in result.triggered_rules)


def test_high_fever_escalates_to_amber(engine: TriageEngine):
    result = engine.evaluate(["I have had a high fever since morning"])
    assert result.severity == "amber"


def test_benign_symptom_stays_green(engine: TriageEngine):
    result = engine.evaluate(["mild runny nose"])
    assert result.severity == "green"


def test_amber_never_downgraded_by_green_rule(engine: TriageEngine):
    # Starting at amber, a green-only set of phrases must not lower severity.
    result = engine.evaluate(["mild runny nose"], current_severity="amber")
    assert result.severity == "amber"


def test_stroke_symptoms_escalate_to_red(engine: TriageEngine):
    result = engine.evaluate(["sudden weakness on one side", "slurred speech"])
    assert result.severity == "red"


def test_downgrade_attempt_is_rejected(engine: TriageEngine):
    """CRITICAL SAFETY TEST.

    Simulate an LLM (or any upstream) trying to downgrade an already-red
    patient to green. The engine must reject it and keep the patient red.
    """
    deterministic = engine.evaluate(
        ["chest pain radiating to jaw", "shortness of breath"]
    )
    assert deterministic.severity == "red"

    # Malicious/erroneous LLM says "actually this is fine, green".
    merged = engine.merge_with_llm_severity(deterministic.severity, "green")
    assert merged == "red", "Engine must never downgrade a red flag"


def test_broken_rule_file_raises(tmp_path):
    bad = tmp_path / "bad_rules.json"
    bad.write_text('{"version": "not-semver", "rules": []}', encoding="utf-8")
    with pytest.raises(RuleValidationError):
        load_rules(bad)
