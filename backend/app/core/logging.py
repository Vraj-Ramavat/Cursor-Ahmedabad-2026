"""Structured JSON logging with correlation_id support."""

import logging
from contextvars import ContextVar
from typing import Any

try:
    from pythonjsonlogger.json import JsonFormatter
except ImportError:  # older python-json-logger
    from pythonjsonlogger.jsonlogger import JsonFormatter

correlation_id_var: ContextVar[str | None] = ContextVar("correlation_id", default=None)


class CorrelationFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.correlation_id = correlation_id_var.get() or "none"
        return True


def setup_logging(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler()
    formatter = JsonFormatter(
        "%(asctime)s %(name)s %(levelname)s %(correlation_id)s %(message)s"
    )
    handler.setFormatter(formatter)
    handler.addFilter(CorrelationFilter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)


def log_event(logger: logging.Logger, event: str, **kwargs: Any) -> None:
    extra = {"event": event, **kwargs}
    logger.info(event, extra=extra)
