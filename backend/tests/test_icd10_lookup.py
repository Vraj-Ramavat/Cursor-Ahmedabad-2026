"""Tests for the local ICD-10 lookup and its fallback-logging hook."""

from app.services.icd10_lookup import SYMPTOM_TABLE, lookup


def test_seeded_table_has_at_least_30_entries():
    assert len(SYMPTOM_TABLE) >= 30


def test_direct_match_is_local():
    result = lookup("chest pain")
    assert result.source == "local_table"
    assert result.icd10_code == "R07.9"


def test_synonym_maps_to_canonical():
    result = lookup("throwing up")
    assert result.source == "local_table"
    assert result.canonical_term == "Vomiting"


def test_unmatched_phrase_falls_back_and_logs():
    logged = []
    result = lookup(
        "my left elbow tingles when it rains",
        fallback_logger=lambda phrase, sim: logged.append((phrase, sim)),
    )
    assert result.source == "llm_inferred"
    assert result.icd10_code is None
    assert len(logged) == 1
    assert logged[0][0] == "my left elbow tingles when it rains"
