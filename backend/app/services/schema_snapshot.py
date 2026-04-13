"""Persist full table list per DB for fast hybrid retrieval without re-extracting every chat."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

from app.models.schemas import TableSchema

logger = logging.getLogger(__name__)

_SNAPSHOT_DIR = Path(__file__).parent.parent.parent / "schema_snapshots"


def _ensure_dir() -> None:
    _SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)


def snapshot_path(db_id: str) -> Path:
    return _SNAPSHOT_DIR / f"{db_id}.json"


def save_schema_snapshot(db_id: str, tables: list[TableSchema]) -> None:
    _ensure_dir()
    data = [t.model_dump() for t in tables]
    snapshot_path(db_id).write_text(json.dumps(data, indent=2))
    logger.info(f"[snapshot] Saved {len(tables)} tables for {db_id}")


def load_schema_snapshot(db_id: str) -> Optional[list[TableSchema]]:
    p = snapshot_path(db_id)
    if not p.exists():
        return None
    try:
        raw = json.loads(p.read_text())
        return [TableSchema(**row) for row in raw]
    except Exception as e:
        logger.warning(f"[snapshot] Failed to load {db_id}: {e}")
        return None


def schema_fingerprint(tables: list[TableSchema]) -> str:
    """Short fingerprint for cache invalidation when schema changes."""
    import hashlib
    names = "|".join(sorted(t.table_name for t in tables))
    return hashlib.sha256(names.encode()).hexdigest()[:16]
