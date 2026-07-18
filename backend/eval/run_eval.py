"""Golden-transcript regression harness.

Replays a fixed set of transcripts through the deterministic triage engine and
the local ICD-10 lookup, then reports:

  * severity regressions (expected vs. actual) — catches drift in the safety core
  * local-table coverage: how many phrases mapped locally vs. fell back to LLM

Run:  python -m eval.run_eval           (from the backend/ directory)
Exit code is non-zero if any severity expectation fails, so it can gate CI later.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from app.services.icd10_lookup import lookup
from app.services.triage_engine import TriageEngine

CASES_FILE = Path(__file__).resolve().parent / "golden_transcripts.json"


def run() -> int:
    data = json.loads(CASES_FILE.read_text(encoding="utf-8"))
    engine = TriageEngine()

    failures = 0
    local_hits = 0
    total_phrases = 0
    fallbacks: list[str] = []

    print(f"Running {len(data['cases'])} golden transcripts (rule v{engine.version})\n")
    for case in data["cases"]:
        phrases = [case["chief_complaint"], *case["answers"]]
        result = engine.evaluate(phrases)

        status = "OK" if result.severity == case["expected_severity"] else "FAIL"
        if status == "FAIL":
            failures += 1
        print(
            f"[{status}] {case['id']:<22} "
            f"expected={case['expected_severity']:<5} actual={result.severity}"
        )

        for phrase in phrases:
            total_phrases += 1
            r = lookup(phrase, fallback_logger=lambda p, s: fallbacks.append(p))
            if r.source == "local_table":
                local_hits += 1

    coverage = 100.0 * local_hits / total_phrases if total_phrases else 0.0
    print("\n--- Coverage ---")
    print(f"Local-table hits: {local_hits}/{total_phrases} ({coverage:.1f}%)")
    print(f"LLM fallbacks (coverage gaps): {len(fallbacks)}")
    if fallbacks:
        print("  gaps:", ", ".join(sorted(set(fallbacks))[:10]))

    print(f"\n{'PASSED' if failures == 0 else f'{failures} FAILURE(S)'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(run())
