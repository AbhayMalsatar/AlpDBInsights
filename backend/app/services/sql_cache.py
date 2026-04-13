"""Cache (user message + db + schema fingerprint) -> generated SQL."""
from __future__ import annotations

import hashlib
import json
import logging
import re
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_CACHE_FILE = Path(__file__).parent.parent.parent / "sql_query_cache.json"
_memory: dict[str, str] = {}


def normalize_message(message: str) -> str:
    m = message.lower().strip()
    m = re.sub(r"\s+", " ", m)
    return m[:500]


def cache_key(
    db_id: str,
    message: str,
    schema_fingerprint: str,
    filters: Optional[dict] = None,
) -> str:
    fpart = ""
    if filters:
        fpart = "|" + json.dumps(filters, sort_keys=True, default=str)
    base = f"{db_id}|{schema_fingerprint}|{normalize_message(message)}{fpart}"
    return hashlib.sha256(base.encode()).hexdigest()


def _load_disk() -> None:
    global _memory
    try:
        if _CACHE_FILE.exists():
            data = json.loads(_CACHE_FILE.read_text())
            if isinstance(data, dict):
                _memory.update(data)
    except Exception as e:
        logger.warning(f"[sql_cache] load failed: {e}")


def _save_disk() -> None:
    try:
        _CACHE_FILE.write_text(json.dumps(_memory, indent=0))
    except Exception as e:
        logger.warning(f"[sql_cache] save failed: {e}")


_load_disk()


def get_cached_sql(
    db_id: str,
    message: str,
    schema_fingerprint: str,
    filters: Optional[dict] = None,
) -> Optional[str]:
    key = cache_key(db_id, message, schema_fingerprint or "none", filters)
    return _memory.get(key)


def set_cached_sql(
    db_id: str,
    message: str,
    schema_fingerprint: str,
    sql: str,
    filters: Optional[dict] = None,
) -> None:
    key = cache_key(db_id, message, schema_fingerprint or "none", filters)
    _memory[key] = sql
    if len(_memory) > 2000:
        # Trim oldest half (simple)
        for k in list(_memory.keys())[:1000]:
            _memory.pop(k, None)
    _save_disk()
