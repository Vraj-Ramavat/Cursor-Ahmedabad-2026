"""Test configuration: run against an isolated, fresh SQLite database.

Setting DATABASE_URL before any app import means test runs never collide with
the dev server's database (or its schema version).
"""

import os
from pathlib import Path

_TEST_DB = Path(__file__).resolve().parent / "test_hospital_prep.db"
if _TEST_DB.exists():
    _TEST_DB.unlink()

os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB.as_posix()}"
