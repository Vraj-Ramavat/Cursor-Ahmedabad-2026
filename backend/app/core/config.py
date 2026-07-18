"""Application configuration."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "AI Hospital Visit Prep"
    debug: bool = False
    database_url: str = "sqlite:///./hospital_prep.db"
    redis_url: str = "redis://localhost:6379/0"
    groq_api_key: str = ""
    gemini_api_key: str = ""
    celery_beat_interval_seconds: int = 45
    queue_aging_rate: float = 1.0
    queue_auto_escalate_minutes: int = 45
    self_care_approval_window_hours: int = 24
    icd10_similarity_threshold: float = 0.75


settings = Settings()
