"""Tests for the chest-pain decision tree traversal."""

from app.services.decision_tree import DecisionTree


def test_chest_pain_is_supported():
    tree = DecisionTree("chest pain")
    assert tree.supported
    first = tree.first_question()
    assert first.node_id == "onset"
    assert "chest pain" in first.question.lower()


def test_traversal_advances_and_completes():
    tree = DecisionTree("chest pain")
    state: dict = {}
    nq = tree.answer("onset", "started an hour ago", state)
    assert nq.node_id == "character"
    nq = tree.answer("character", "a lot of tightness", state)
    assert nq.node_id == "radiation"
    assert "chest tightness" in nq.red_flag_hints
    nq = tree.answer("radiation", "it spreads to my arm", state)
    assert "radiating to arm" in nq.red_flag_hints
    nq = tree.answer("associated", "yes some shortness of breath", state)
    nq = tree.answer("exertion", "worse when I move", state)
    assert nq.complete


def test_unknown_complaint_gets_default_tree():
    """Any complaint without a dedicated tree falls back to the generic intake
    conversation, so every patient gets real follow-up questions."""
    tree = DecisionTree("hangnail")
    assert tree.supported
    first = tree.first_question()
    assert first.node_id == "duration"
    assert not first.complete


def test_partial_complaint_matches_dedicated_tree():
    tree = DecisionTree("really bad chest pain since morning")
    assert tree.first_question().node_id == "onset"
