from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from app.config import settings
from app.services.schema_snapshot import load_schema_snapshot
from app.services.table_hints_service import load_hints_by_table

logger = logging.getLogger(__name__)

_FINE_TUNE_DIR = Path(__file__).parent.parent.parent / "fine_tuning_data"
_RUNNING_STATUSES = {"validating_files", "queued", "running"}
_AUDIT_COLUMNS = {"addby", "editby", "adddate", "editdate"}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _ensure_dir() -> None:
    _FINE_TUNE_DIR.mkdir(parents=True, exist_ok=True)


def _registry_refs() -> tuple[dict[str, Any], Any]:
    from app.services.ai_service import _database_registry, _save_registry

    return _database_registry, _save_registry


def _quote_ident(name: str) -> str:
    return re.sub(r"[^\w]", "", name or "")


def _is_audit_column(name: str) -> bool:
    return (name or "").strip().lower() in _AUDIT_COLUMNS


def _sql_limit(limit: int, db_type: str) -> tuple[str, str]:
    if db_type == "mssql":
        return f"TOP {limit} ", ""
    return "", f" LIMIT {limit}"


def _fmt_schema_block(table: Any, hint: Optional[dict[str, Any]]) -> str:
    lines = [f"Table: {table.table_name}", "Columns:"]
    for col in table.columns[:80]:
        if _is_audit_column(col.name):
            continue
        flags: list[str] = []
        if getattr(col, "primary_key", False):
            flags.append("PRIMARY KEY")
        if getattr(col, "foreign_key", None):
            flags.append(f"FK -> {col.foreign_key}")
        if not getattr(col, "nullable", True):
            flags.append("NOT NULL")
        flag_txt = f" [{' | '.join(flags)}]" if flags else ""
        lines.append(f"- {col.name} ({col.data_type}){flag_txt}")
    if getattr(table, "row_count", None) is not None:
        lines.append(f"Snapshot row count: {table.row_count}")
    if hint:
        desc = (hint.get("description") or "").strip()
        if desc:
            lines.append(f"Table hint: {desc}")
        segments = hint.get("segments") or []
        if segments:
            lines.append("Segments:")
            for seg in segments[:12]:
                label = (seg.get("label") or "").strip()
                if not label:
                    continue
                where_sql = (seg.get("where_sql") or "").strip()
                column = (seg.get("column") or "").strip()
                values = [str(v).strip() for v in (seg.get("values") or []) if str(v).strip()]
                if where_sql:
                    lines.append(f"- {label}: {where_sql}")
                elif column and values:
                    lines.append(f"- {label}: {column} IN ({', '.join(values)})")
                else:
                    lines.append(f"- {label}")
    return "\n".join(lines)


def _first_matching_column(table: Any, patterns: tuple[str, ...], kinds: tuple[str, ...]) -> Optional[str]:
    for col in table.columns:
        name = col.name.lower()
        dtype = (col.data_type or "").lower()
        if any(p in name for p in patterns):
            return col.name
        if any(k in dtype for k in kinds):
            return col.name
    return None


def _first_dimension_column(table: Any) -> Optional[str]:
    for col in table.columns:
        if _is_audit_column(col.name):
            continue
        dtype = (col.data_type or "").lower()
        name = col.name.lower()
        if getattr(col, "primary_key", False):
            continue
        if any(token in dtype for token in ("char", "text", "name", "varchar", "nchar", "nvarchar")):
            return col.name
        if any(token in name for token in ("name", "type", "category", "status", "group", "code")):
            return col.name
    return None


def _first_metric_column(table: Any) -> Optional[str]:
    for col in table.columns:
        if _is_audit_column(col.name):
            continue
        dtype = (col.data_type or "").lower()
        name = col.name.lower()
        if getattr(col, "primary_key", False):
            continue
        if any(token in dtype for token in ("int", "numeric", "decimal", "float", "double", "real", "money")):
            if any(skip in name for skip in ("id", "_id")):
                continue
            return col.name
    return None


def _first_date_column(table: Any) -> Optional[str]:
    for col in table.columns:
        if _is_audit_column(col.name):
            continue
        dtype = (col.data_type or "").lower()
        name = col.name.lower()
        if any(token in dtype for token in ("date", "time")):
            return col.name
        if any(token in name for token in ("date", "time", "_at", "created", "updated")):
            return col.name
    return None


def _segment_where(seg: dict[str, Any]) -> Optional[str]:
    where_sql = (seg.get("where_sql") or "").strip()
    if where_sql:
        return where_sql
    column = _quote_ident((seg.get("column") or "").strip())
    values = [str(v).replace("'", "''").strip() for v in (seg.get("values") or []) if str(v).strip()]
    if not column or not values:
        return None
    joined = ", ".join(f"'{v}'" for v in values)
    return f"{column} IN ({joined})"


def _training_example(schema_block: str, task: str, sql: str) -> dict[str, Any]:
    return {
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are an expert SQL analyst. Return only one safe SQL SELECT query. "
                    "Use only the provided schema and table hints. Never use markdown or commentary."
                ),
            },
            {
                "role": "user",
                "content": f"{schema_block}\n\nTask: {task}",
            },
            {
                "role": "assistant",
                "content": sql,
            },
        ]
    }


def build_training_examples(db_id: str, table_names: Optional[list[str]] = None) -> tuple[list[dict[str, Any]], list[str]]:
    tables = load_schema_snapshot(db_id) or []
    hints_by_table = load_hints_by_table(db_id)
    registry, _ = _registry_refs()
    db_config = registry.get(db_id) or {}
    selected_tables = db_config.get("selected_tables")
    if table_names is None:
        wanted = set(selected_tables or [])
    else:
        wanted = set(table_names)
    db_type = db_config.get("type", "postgresql")
    if table_names is None and selected_tables == []:
        selected = []
    else:
        selected = [t for t in tables if not wanted or t.table_name in wanted]

    examples: list[dict[str, Any]] = []
    used_tables: list[str] = []

    for table in selected:
        table_name = _quote_ident(table.table_name)
        if not table_name:
            continue
        used_tables.append(table.table_name)
        hint = hints_by_table.get(table.table_name) or {}
        schema_block = _fmt_schema_block(table, hint)
        top_10, limit_10 = _sql_limit(10, db_type)
        top_20, limit_20 = _sql_limit(20, db_type)
        dim_col = _first_dimension_column(table)
        metric_col = _first_metric_column(table)
        date_col = _first_date_column(table)

        examples.append(
            _training_example(
                schema_block,
                f"Show me 10 sample rows from {table.table_name}.",
                f"SELECT {top_10}* FROM {table_name}{limit_10}",
            )
        )
        examples.append(
            _training_example(
                schema_block,
                f"Count total rows in {table.table_name}.",
                f"SELECT COUNT(*) AS total_rows FROM {table_name}",
            )
        )

        if dim_col:
            dim_name = _quote_ident(dim_col)
            examples.append(
                _training_example(
                    schema_block,
                    f"Summarize {table.table_name} by {dim_col}.",
                    (
                        f"SELECT {dim_name}, COUNT(*) AS total_rows "
                        f"FROM {table_name} "
                        f"GROUP BY {dim_name} "
                        f"ORDER BY total_rows DESC{limit_20}"
                    ),
                )
            )

        if metric_col:
            metric_name = _quote_ident(metric_col)
            examples.append(
                _training_example(
                    schema_block,
                    f"Show the highest {metric_col} values from {table.table_name}.",
                    (
                        f"SELECT {top_20}* FROM {table_name} "
                        f"ORDER BY {metric_name} DESC{limit_20}"
                    ),
                )
            )

        if date_col and metric_col:
            date_name = _quote_ident(date_col)
            metric_name = _quote_ident(metric_col)
            if db_type == "mssql":
                trend_sql = (
                    f"SELECT TOP 24 DATEFROMPARTS(YEAR({date_name}), MONTH({date_name}), 1) AS month, "
                    f"SUM({metric_name}) AS total_value "
                    f"FROM {table_name} "
                    f"GROUP BY DATEFROMPARTS(YEAR({date_name}), MONTH({date_name}), 1) "
                    f"ORDER BY month ASC"
                )
            else:
                trend_sql = (
                    f"SELECT DATE_TRUNC('month', {date_name})::date AS month, "
                    f"SUM({metric_name}) AS total_value "
                    f"FROM {table_name} "
                    f"GROUP BY 1 "
                    f"ORDER BY 1 ASC "
                    f"LIMIT 24"
                )
            examples.append(
                _training_example(
                    schema_block,
                    f"Build a monthly trend for {metric_col} from {table.table_name}.",
                    trend_sql,
                )
            )
        elif date_col:
            date_name = _quote_ident(date_col)
            examples.append(
                _training_example(
                    schema_block,
                    f"Show the newest rows from {table.table_name}.",
                    (
                        f"SELECT {top_20}* FROM {table_name} "
                        f"ORDER BY {date_name} DESC{limit_20}"
                    ),
                )
            )

        desc = (hint.get("description") or "").strip()
        if desc:
            examples.append(
                _training_example(
                    schema_block,
                    f"Use the business hint to query the most relevant rows from {table.table_name}.",
                    f"SELECT {top_20}* FROM {table_name}{limit_20}",
                )
            )

        for seg in (hint.get("segments") or [])[:10]:
            label = (seg.get("label") or "").strip()
            where_clause = _segment_where(seg)
            if not label or not where_clause:
                continue
            examples.append(
                _training_example(
                    schema_block,
                    f"Show rows for the '{label}' segment from {table.table_name}.",
                    f"SELECT {top_20}* FROM {table_name} WHERE {where_clause}{limit_20}",
                )
            )
            examples.append(
                _training_example(
                    schema_block,
                    f"Count rows for the '{label}' segment from {table.table_name}.",
                    f"SELECT COUNT(*) AS total_rows FROM {table_name} WHERE {where_clause}",
                )
            )

    if examples and len(examples) < 10:
        first = examples[0]
        while len(examples) < 10:
            examples.append(first)

    return examples, used_tables


def _write_training_file(db_id: str, examples: list[dict[str, Any]]) -> Path:
    _ensure_dir()
    path = _FINE_TUNE_DIR / f"{db_id}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}.jsonl"
    with path.open("w", encoding="utf-8") as fh:
        for row in examples:
            fh.write(json.dumps(row, ensure_ascii=False))
            fh.write("\n")
    return path


def _default_state() -> dict[str, Any]:
    base_model = settings.openai_fine_tune_base_model or settings.openai_model
    return {
        "status": "idle",
        "provider": "openai",
        "active_model": None,
        "fine_tuned_model": None,
        "base_model": base_model,
        "job_id": None,
        "training_file_id": None,
        "training_examples": 0,
        "dataset_tables": [],
        "mode": None,
        "last_started_at": None,
        "last_completed_at": None,
        "last_checked_at": None,
        "last_error": None,
        "enabled": bool(settings.openai_api_key and settings.ai_provider.lower() == "openai"),
    }


def get_fine_tune_state(db_id: str) -> dict[str, Any]:
    registry, _ = _registry_refs()
    cfg = registry.get(db_id) or {}
    state = _default_state()
    state.update(cfg.get("fine_tune") or {})
    state["enabled"] = bool(settings.openai_api_key and settings.ai_provider.lower() == "openai")
    if not state.get("active_model"):
        state["active_model"] = state.get("fine_tuned_model") or settings.openai_model
    return state


def _save_state(db_id: str, state: dict[str, Any]) -> dict[str, Any]:
    registry, save_registry = _registry_refs()
    cfg = dict(registry.get(db_id) or {})
    cfg["fine_tune"] = state
    registry[db_id] = cfg
    save_registry()
    return state


def _extract_error_text(job: Any) -> Optional[str]:
    err = getattr(job, "error", None)
    if err is None:
        return None
    if isinstance(err, str):
        return err
    message = getattr(err, "message", None)
    if message:
        return str(message)
    try:
        data = dict(err)
        return str(data.get("message") or data)
    except Exception:
        return str(err)


def refresh_fine_tune_state(db_id: str, force: bool = False) -> dict[str, Any]:
    state = get_fine_tune_state(db_id)
    if not state["enabled"]:
        state["status"] = "disabled"
        return _save_state(db_id, state)
    job_id = state.get("job_id")
    if not job_id:
        return state

    if not force and state.get("last_checked_at"):
        try:
            last_checked = datetime.fromisoformat(str(state["last_checked_at"]).replace("Z", "+00:00"))
            age = (datetime.now(timezone.utc) - last_checked).total_seconds()
            if age < 15 and state.get("status") in _RUNNING_STATUSES:
                return state
        except Exception:
            pass

    try:
        from openai import OpenAI

        client = OpenAI(api_key=settings.openai_api_key)
        job = client.fine_tuning.jobs.retrieve(job_id)
        state["status"] = getattr(job, "status", state.get("status"))
        state["last_checked_at"] = utc_now_iso()
        state["last_error"] = _extract_error_text(job)
        fine_tuned_model = getattr(job, "fine_tuned_model", None)
        if fine_tuned_model:
            state["fine_tuned_model"] = fine_tuned_model
            state["active_model"] = fine_tuned_model
        if state["status"] == "succeeded":
            state["last_completed_at"] = utc_now_iso()
        if state["status"] in {"failed", "cancelled"}:
            state["last_completed_at"] = utc_now_iso()
    except Exception as exc:
        logger.warning("[fine_tune] status refresh failed for %s: %s", db_id, exc)
        state["last_error"] = str(exc)
    return _save_state(db_id, state)


def start_fine_tune(db_id: str, table_names: Optional[list[str]] = None, auto: bool = False) -> dict[str, Any]:
    registry, _ = _registry_refs()
    if db_id not in registry:
        raise ValueError("Database not found.")
    if settings.ai_provider.lower() != "openai":
        raise ValueError("Fine-tuning requires ai_provider=openai.")
    if not settings.openai_api_key:
        raise ValueError("OpenAI API key is missing.")

    state = refresh_fine_tune_state(db_id, force=True)
    if state.get("status") in _RUNNING_STATUSES:
        state["message"] = "A fine-tuning job is already running for this database."
        return state

    db_config = registry.get(db_id) or {}
    selected_tables = db_config.get("selected_tables")
    if table_names is None and selected_tables == []:
        raise ValueError("Select tables first. Fine-tuning only runs on the tables you selected on the Databases page.")

    examples, used_tables = build_training_examples(db_id, table_names=table_names)
    if len(examples) < 10:
        raise ValueError("At least 10 training examples are required. Add more tables or hints first.")

    dataset_path = _write_training_file(db_id, examples)

    try:
        from openai import OpenAI

        client = OpenAI(api_key=settings.openai_api_key)
        with dataset_path.open("rb") as fh:
            uploaded = client.files.create(file=fh, purpose="fine-tune")
        base_model = (
            state.get("fine_tuned_model")
            or settings.openai_fine_tune_base_model
            or settings.openai_model
        )
        job = client.fine_tuning.jobs.create(
            training_file=uploaded.id,
            model=base_model,
            suffix=f"db-{db_id[:8]}",
        )
        state.update(
            {
                "status": getattr(job, "status", "queued"),
                "provider": "openai",
                "job_id": getattr(job, "id", None),
                "training_file_id": getattr(uploaded, "id", None),
                "training_examples": len(examples),
                "dataset_tables": used_tables,
                "mode": "auto" if auto else "manual",
                "base_model": base_model,
                "last_started_at": utc_now_iso(),
                "last_checked_at": utc_now_iso(),
                "last_error": None,
                "enabled": True,
                "message": "Fine-tuning job started.",
            }
        )
        return _save_state(db_id, state)
    except Exception as exc:
        state["status"] = "failed"
        state["last_error"] = str(exc)
        state["message"] = "Fine-tuning job failed to start."
        _save_state(db_id, state)
        raise


def resolve_openai_model(db_id: Optional[str], fallback_model: str) -> str:
    if not db_id:
        return fallback_model
    try:
        state = refresh_fine_tune_state(db_id, force=False)
        return state.get("active_model") or state.get("fine_tuned_model") or fallback_model
    except Exception:
        return fallback_model
