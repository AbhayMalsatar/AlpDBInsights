"""
Per-database table hints: human descriptions + segment rules (e.g. IrType=SR → sales return).

Stored as JSON under backend/table_hints/{db_id}.json so snapshots stay pure schema dumps.
"""
from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.schemas import TableSchema

logger = logging.getLogger(__name__)

_HINTS_DIR = Path(__file__).parent.parent.parent / "table_hints"


def _ensure_dir() -> None:
    _HINTS_DIR.mkdir(parents=True, exist_ok=True)


def hints_path(db_id: str) -> Path:
    return _HINTS_DIR / f"{db_id}.json"


def load_raw(db_id: str) -> dict[str, Any]:
    p = hints_path(db_id)
    if not p.exists():
        return {"version": 1, "tables": {}}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"version": 1, "tables": {}}
        if "tables" not in data or not isinstance(data["tables"], dict):
            data["tables"] = {}
        return data
    except Exception as e:
        logger.warning(f"[table_hints] load failed {db_id}: {e}")
        return {"version": 1, "tables": {}}


def save_raw(db_id: str, data: dict[str, Any]) -> None:
    _ensure_dir()
    if "tables" not in data:
        data["tables"] = {}
    data.setdefault("version", 1)
    hints_path(db_id).write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def load_hints_by_table(db_id: str) -> dict[str, dict[str, Any]]:
    """table_name -> {description, segments, approx_row_count}."""
    return dict(load_raw(db_id).get("tables") or {})


def hints_fingerprint(tables_hints: dict[str, Any]) -> str:
    """Stable short token for SQL cache / versioning when hints change."""
    payload = json.dumps(tables_hints, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def _normalize_segment(seg: Any) -> dict[str, Any]:
    """Ensure JSON round-trip keeps discriminator fields (column, values, where_sql)."""
    if not isinstance(seg, dict):
        return {}
    vals = seg.get("values") or []
    if isinstance(vals, str):
        vals = [v.strip() for v in vals.replace(";", ",").split(",") if v.strip()]
    elif not isinstance(vals, list):
        vals = []
    else:
        vals = [str(v).strip() for v in vals if str(v).strip()]
    ws = seg.get("where_sql")
    if ws is not None and not isinstance(ws, str):
        ws = str(ws)
    if isinstance(ws, str) and not ws.strip():
        ws = None
    return {
        "label": (seg.get("label") or "").strip(),
        "column": (seg.get("column") or "").strip(),
        "values": vals,
        "where_sql": ws.strip() if isinstance(ws, str) else None,
    }


def delete_hints(db_id: str) -> None:
    p = hints_path(db_id)
    if p.exists():
        try:
            p.unlink()
        except OSError as e:
            logger.warning(f"[table_hints] delete failed {db_id}: {e}")


def merge_tables_into_doc(existing: dict[str, Any], incoming: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Shallow-merge incoming table entries into existing document."""
    out = dict(existing)
    tables = dict(out.get("tables") or {})
    for name, entry in incoming.items():
        if not name or not isinstance(entry, dict):
            continue
        raw_segs = entry.get("segments") or []
        segs = [_normalize_segment(s) for s in raw_segs if isinstance(s, dict)]
        segs = [s for s in segs if s.get("label")]
        row = {
            "description": (entry.get("description") or "").strip(),
            "segments": segs,
            "approx_row_count": entry.get("approx_row_count"),
        }
        empty = (
            not row["description"]
            and not segs
            and row.get("approx_row_count") is None
        )
        if empty:
            tables.pop(name, None)
        else:
            tables[name] = row
    out["tables"] = tables
    out["version"] = 1
    return out


def build_schema_chunks_with_hints(db_id: str, tables: list["TableSchema"]) -> list[dict[str, str]]:
    """Vector upsert payloads: one chunk per table, merging curator hints when present."""
    from app.services.schema_metadata import table_to_rag_document

    hints = load_hints_by_table(db_id)
    return [
        {
            "table_name": t.table_name,
            "content": table_to_rag_document(t, hints.get(t.table_name)),
        }
        for t in tables
    ]
