"""FastAPI application entrypoint.

Serves API + built patient/doctor web UIs from one host (Render).
"""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.api import auth, doctor, documents, intake, meals, medicines, notes, queue, voice
from app.core.database import init_db
from app.core.logging import correlation_id_var, setup_logging
from app.schemas import HealthResponse
from app.services.queue_service import queue_is_live
from app.services.triage_engine import load_rules

logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).resolve().parents[1] / "static"
PATIENT_DIR = STATIC_DIR / "patient"
DOCTOR_DIR = STATIC_DIR / "doctor"


def _ui_ready(folder: Path) -> bool:
    return (folder / "index.html").is_file()


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    load_rules()
    logger.info("startup_rule_validation_ok")
    init_db()
    _init_tracing(app)
    logger.info(
        "static_dir=%s patient=%s doctor=%s",
        STATIC_DIR,
        _ui_ready(PATIENT_DIR),
        _ui_ready(DOCTOR_DIR),
    )
    yield


def _init_tracing(app: FastAPI) -> None:
    try:
        from opentelemetry import trace
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import (
            ConsoleSpanExporter,
            SimpleSpanProcessor,
        )

        provider = TracerProvider()
        provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))
        trace.set_tracer_provider(provider)
        FastAPIInstrumentor.instrument_app(app)
        logger.info("opentelemetry_enabled")
    except Exception as exc:  # pragma: no cover
        logger.info("opentelemetry_unavailable: %s", exc)


app = FastAPI(title="AI Hospital Visit Prep", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def correlation_middleware(request: Request, call_next):
    cid = request.headers.get("X-Correlation-ID") or str(uuid.uuid4())
    token = correlation_id_var.set(cid)
    try:
        response = await call_next(request)
    finally:
        correlation_id_var.reset(token)
    response.headers["X-Correlation-ID"] = cid
    return response


app.include_router(intake.router)
app.include_router(queue.router)
app.include_router(documents.router)
app.include_router(notes.router)
app.include_router(doctor.router)
app.include_router(voice.router)
app.include_router(auth.router)
app.include_router(meals.router)
app.include_router(medicines.router)


@app.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(status="ok", time=datetime.now(timezone.utc))


@app.get("/readiness", response_model=HealthResponse)
def readiness():
    status = "ready" if queue_is_live() else "ready (queue live-updates paused)"
    return HealthResponse(status=status, time=datetime.now(timezone.utc))


@app.get("/", response_class=HTMLResponse)
def home():
    patient_ok = _ui_ready(PATIENT_DIR)
    doctor_ok = _ui_ready(DOCTOR_DIR)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Sehat Sakhi</title>
  <style>
    body{{font-family:Georgia,serif;background:#F7F1E8;color:#2A2826;margin:0;padding:2.5rem}}
    h1{{font-size:2.2rem;margin:0 0 .4rem}}
    p{{color:#4A4744;line-height:1.5;max-width:32rem}}
    a.btn{{display:block;text-decoration:none;color:#2A2826;background:rgba(255,255,255,.8);
      border:1px solid rgba(232,168,184,.4);border-radius:16px;padding:1.1rem 1.25rem;
      margin:.75rem 0;max-width:22rem}}
    a.btn strong{{display:block;font-size:1.15rem;color:#4A6B50}}
    a.btn span{{font-size:.9rem;color:#4A4744}}
    .meta{{margin-top:1.5rem;font-size:.9rem}}
    .meta a{{color:#4A6B50;font-weight:600}}
    .warn{{color:#C4704B;font-size:.9rem}}
  </style>
</head>
<body>
  <h1>Sehat Sakhi</h1>
  <p>AI Hospital Visit Prep — patient app, doctor dashboard, and API.</p>
  {"<a class='btn' href='/patient/'><strong>Patient app</strong><span>Visit · Meds · Meals</span></a>" if patient_ok else "<p class='warn'>Patient UI missing on server (backend/static/patient).</p>"}
  {"<a class='btn' href='/doctor/'><strong>Doctor dashboard</strong><span>Queue · Walk-in nurse</span></a>" if doctor_ok else "<p class='warn'>Doctor UI missing on server (backend/static/doctor).</p>"}
  <p class="meta"><a href="/docs">API docs</a> · <a href="/health">Health</a></p>
</body>
</html>"""


@app.get("/patient")
def patient_redirect():
    return RedirectResponse(url="/patient/", status_code=307)


@app.get("/doctor")
def doctor_redirect():
    return RedirectResponse(url="/doctor/", status_code=307)


@app.get("/patient/", response_class=HTMLResponse)
def patient_index():
    index = PATIENT_DIR / "index.html"
    if not index.is_file():
        return HTMLResponse(
            "<h1>Patient UI not deployed</h1><p>Push backend/static/patient to GitHub.</p>",
            status_code=404,
        )
    return FileResponse(index)


@app.get("/doctor/", response_class=HTMLResponse)
def doctor_index():
    index = DOCTOR_DIR / "index.html"
    if not index.is_file():
        return HTMLResponse(
            "<h1>Doctor UI not deployed</h1><p>Push backend/static/doctor to GitHub.</p>",
            status_code=404,
        )
    return FileResponse(index)


# Asset mounts (JS/CSS). Registered after API routes.
if _ui_ready(PATIENT_DIR):
    app.mount(
        "/patient",
        StaticFiles(directory=str(PATIENT_DIR), html=True),
        name="patient_ui",
    )
if _ui_ready(DOCTOR_DIR):
    app.mount(
        "/doctor",
        StaticFiles(directory=str(DOCTOR_DIR), html=True),
        name="doctor_ui",
    )
