"""FastAPI application entrypoint.

STARTUP FAILS FAST: the triage rule file is schema-validated on load. If it is
broken, the app raises and never serves traffic on a bad rule set. A
correlation_id is assigned per request and threaded through all logs. Minimal
OpenTelemetry spans wrap the request path.
"""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api import doctor, documents, intake, notes, queue, voice
from app.core.database import init_db
from app.core.logging import correlation_id_var, setup_logging
from app.schemas import HealthResponse
from app.services.queue_service import queue_is_live
from app.services.triage_engine import load_rules

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    # FAIL FAST: validate the safety-critical rule file before serving traffic.
    load_rules()
    logger.info("startup_rule_validation_ok")
    init_db()
    _init_tracing(app)
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
    except Exception as exc:  # pragma: no cover - tracing is best-effort in demo
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


@app.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(status="ok", time=datetime.now(timezone.utc))


@app.get("/readiness", response_model=HealthResponse)
def readiness():
    # Rule file already validated at startup; report queue liveness too.
    status = "ready" if queue_is_live() else "ready (queue live-updates paused)"
    return HealthResponse(status=status, time=datetime.now(timezone.utc))
