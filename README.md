# AI Hospital Visit Prep

A **clinical intake compiler — not a diagnosis tool.** It converts messy patient input
(text, and uploaded prescription/lab/scan-report documents) into a structured,
doctor-readable pre-visit briefing, and orders a live waiting queue by an aging-based
priority score. Two clients, one shared backend: a patient app (Expo) and a doctor
dashboard (React/Vite).

The whole point of the project is the **deterministic safety core**: red-flag triage and
queue priority are pure Python with zero LLM calls and zero external dependencies, so the
safety-critical path keeps working even when every network dependency is down.

> This targets India (ABDM/ABHA), so the relevant privacy law is the **Digital Personal
> Data Protection Act, 2023 (DPDP)** — not HIPAA. See `ARCHITECTURE.md`.

---

## Why the design is the way it is (read this first)

- **One-way escalation.** The triage engine runs *after* any LLM step and can only raise
  severity (green → amber → red), never lower it. A hallucinating or prompt-injected LLM
  therefore cannot talk the system down from a red flag. Proven by
  `tests/test_triage_engine.py::test_downgrade_attempt_is_rejected`.
- **Narrow LLM scope.** The LLM only (a) paraphrases structured data into briefing prose,
  (b) parses free-text symptoms when the local ICD-10 table has no match, and (c) drafts a
  general, doctor-gated self-care note. It never emits a diagnosis, drug name, or dosage.
- **Redaction is a pipeline stage, not a library call.** Nothing reaches Groq/Gemini
  without passing `phi_redaction.redact()` first; only the redacted *categories* are logged.
- **Degrade paths are visible, never silent.** LLM down → fields show `pending — retry`.
  Redis down → queue shows a "live updates paused" banner over last-known order.

---

## Repo layout

```
backend/            FastAPI + SQLAlchemy + Celery. The safety core lives here.
  app/services/     triage_engine, priority_queue, icd10_lookup, decision_tree,
                    phi_redaction, llm_client, ocr_service, queue_service, audit
  app/rules/        versioned + schema-validated JSON rule files
  app/api/          intake, queue (REST+WS), documents (OCR), notes (approval)
  eval/             golden-transcript regression harness
  tests/            27 unit + integration tests
doctor-dashboard/   React (Vite) live queue + briefing + note-approval UI
patient-app/        React Native (Expo) intake + queue position + doc upload
```

## Quick start (backend, zero-config)

The backend runs with **no API keys and no Redis** — it just uses SQLite and the degrade
paths. Add keys/Redis to light up the non-degraded features.

```bash
cd backend
python -m venv .venv && .venv\Scripts\activate      # Windows
pip install -r requirements.txt
copy .env.example .env                                # optional; fill in keys
uvicorn app.main:app --reload
```

- Health: `GET http://localhost:8000/health`
- Readiness: `GET http://localhost:8000/readiness` (reports queue live/paused)
- Startup **fails fast** if `app/rules/triage_rules.json` fails schema validation.

### Run the tests and the eval harness

```bash
cd backend
pytest -q                    # 27 tests incl. the two safety tests
python -m eval.run_eval      # golden transcripts + local-table coverage report
```

### Optional infra (non-degraded path)

```bash
docker compose up -d         # Postgres+pgvector + Redis
# set DATABASE_URL / REDIS_URL in backend/.env, then:
celery -A app.worker.celery_app worker --beat --loglevel=info   # queue re-scoring
```

## Frontends

```bash
cd doctor-dashboard && npm install && npm run dev     # http://localhost:5173
cd patient-app && npm install && npx expo start
```

Both read `VITE_API_BASE` / `EXPO_PUBLIC_API_BASE` (default `http://localhost:8000`).

## Milestone 1 status

All 11 first-milestone steps are implemented and each step's stated test passes. See
`ARCHITECTURE.md` for what is **built** vs. **designed-not-yet-wired** (be honest with
judges: audit-log RBAC and full OpenTelemetry backends are designed, correlation IDs and
the two safety tests are built).
