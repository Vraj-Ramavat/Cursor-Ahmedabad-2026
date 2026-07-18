"""Voice intake: transcribe patient audio via Groq Whisper.

The transcription result is plain text that then flows through exactly the same
pipeline as typed input (redaction gate -> local lookup -> deterministic triage),
so voice adds no new safety surface. Degrades to "pending — retry" when Groq is
unavailable, keeping typed intake as the fallback.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, File, UploadFile

from app.core.config import settings
from app.schemas import VoiceTranscribeResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/voice", tags=["voice"])


@router.post("/transcribe", response_model=VoiceTranscribeResponse)
async def transcribe(file: UploadFile = File(...)):
    if not settings.groq_api_key:
        logger.info("voice degraded: no GROQ_API_KEY")
        return VoiceTranscribeResponse(text=None, status="pending — retry")

    try:
        from groq import Groq

        client = Groq(api_key=settings.groq_api_key)
        audio_bytes = await file.read()
        result = client.audio.transcriptions.create(
            file=(file.filename or "audio.m4a", audio_bytes),
            model="whisper-large-v3",
        )
        return VoiceTranscribeResponse(text=result.text, status="ok")
    except Exception as exc:
        logger.warning("voice transcription failed (degrading): %s", exc)
        return VoiceTranscribeResponse(text=None, status="pending — retry")
