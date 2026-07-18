"""Deterministic follow-up decision tree traversal.

WHY DETERMINISTIC
-----------------
The follow-up questions are a fixed decision tree per chief complaint (constraint
5), not LLM-generated, so the intake flow is predictable and testable. The tone
reads as one real question at a time that acknowledges the prior answer, and a
question is skipped when an earlier answer already implies its content (see
`_implied_keys`). Any red-flag hints surfaced by answers are fed to the
deterministic triage engine, never used to make a clinical decision here.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

TREES_FILE = Path(__file__).resolve().parent.parent / "rules" / "decision_trees.json"


@dataclass
class NextQuestion:
    node_id: str | None
    question: str | None
    complete: bool = False
    red_flag_hints: list[str] = field(default_factory=list)


def _load_trees() -> dict:
    return json.loads(TREES_FILE.read_text(encoding="utf-8"))


class DecisionTree:
    def __init__(self, chief_complaint: str, trees: dict | None = None):
        trees = trees or _load_trees()
        self.complaint = chief_complaint.lower().strip()
        # Exact match first, then substring match ("bad chest pain" -> "chest pain"),
        # then the generic default tree so every patient gets a real conversation.
        tree = trees["trees"].get(self.complaint)
        if tree is None:
            for name, candidate in trees["trees"].items():
                if name != "default" and name in self.complaint:
                    tree = candidate
                    break
        self.tree = tree or trees["trees"].get("default")

    @property
    def supported(self) -> bool:
        return self.tree is not None

    def first_question(self) -> NextQuestion:
        if not self.supported:
            return NextQuestion(None, None, complete=True)
        start = self.tree["start"]
        node = self.tree["nodes"][start]
        return NextQuestion(start, node["question"])

    def answer(self, node_id: str, answer_text: str, state: dict) -> NextQuestion:
        """Record an answer, extract any red-flag hints, and return the next question.

        `state` maps answered node keys -> answer text and is mutated in place.
        Questions whose content is already implied by prior answers are skipped.
        """
        node = self.tree["nodes"][node_id]
        state[node["key"]] = answer_text
        hints = self._extract_hints(node, answer_text)

        next_id = node.get("next")
        while next_id is not None:
            next_node = self.tree["nodes"][next_id]
            if next_node["key"] in state:
                next_id = next_node.get("next")
                continue
            return NextQuestion(next_id, next_node["question"], red_flag_hints=hints)

        return NextQuestion(None, None, complete=True, red_flag_hints=hints)

    @staticmethod
    def _extract_hints(node: dict, answer_text: str) -> list[str]:
        hints: list[str] = []
        implies = node.get("implies", {})
        lowered = answer_text.lower()
        for token, meta in implies.items():
            if token in lowered and "red_flag_hint" in meta:
                hints.append(meta["red_flag_hint"])
        return hints
