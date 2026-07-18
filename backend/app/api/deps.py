"""Shared FastAPI dependencies: the singleton triage engine."""

from __future__ import annotations

from app.services.triage_engine import TriageEngine

# Loaded and validated once at import; startup validation lives in main.lifespan.
_engine: TriageEngine | None = None


def get_triage_engine() -> TriageEngine:
    global _engine
    if _engine is None:
        _engine = TriageEngine()
    return _engine
