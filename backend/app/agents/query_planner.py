"""Narrow candidate tables before SQL generation (rules + optional mini-LLM)."""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

from app.config import settings
from app.models.schemas import TableSchema
from app.services.fine_tuning_service import resolve_openai_model

logger = logging.getLogger(__name__)


def plan_tables_rules(
    message: str,
    candidates: list[TableSchema],
    max_tables: int = 10,
    hints_by_table: Optional[dict[str, dict[str, Any]]] = None,
) -> list[str]:
    """Pick top tables from candidate list using keyword + name match scores."""
    from app.services.schema_retrieval import keyword_score_table

    scored = [
        (
            keyword_score_table(
                message,
                t,
                hints_by_table.get(t.table_name) if hints_by_table else None,
            ),
            t.table_name,
        )
        for t in candidates
    ]
    scored.sort(key=lambda x: x[0], reverse=True)
    out: list[str] = []
    for score, name in scored:
        if name in out:
            continue
        if score > 0 or len(out) < min(3, max(1, len(candidates))):
            out.append(name)
        if len(out) >= max_tables:
            break
    if not out and candidates:
        out = [candidates[0].table_name]
    return out[:max_tables]


def _hint_catalog_line(table_name: str, hint: dict[str, Any]) -> str:
    bits = [(hint.get("description") or "").strip()[:120]]
    for seg in (hint.get("segments") or [])[:4]:
        if not isinstance(seg, dict):
            continue
        lab = (seg.get("label") or "").strip()
        if not lab:
            continue
        col = (seg.get("column") or "").strip()
        vals = seg.get("values") or []
        ws = (seg.get("where_sql") or "").strip()
        if ws:
            bits.append(f"{lab}→{ws[:80]}")
        elif col and vals:
            bits.append(f"{lab}→{col} in {list(vals)[:6]}")
        else:
            bits.append(lab)
    return f"{table_name}: " + "; ".join(b for b in bits if b)[:220]


def plan_tables_llm(
    message: str,
    candidates: list[TableSchema],
    max_tables: int = 10,
    hints_by_table: Optional[dict[str, dict[str, Any]]] = None,
    db_id: Optional[str] = None,
) -> Optional[list[str]]:
    """Ask a small model which table names are required. Returns None on failure."""
    try:
        from openai import OpenAI
        if not settings.openai_api_key:
            return None
        lines: list[str] = []
        names: list[str] = []
        for t in candidates[:60]:
            names.append(t.table_name)
            if hints_by_table and t.table_name in hints_by_table:
                lines.append(_hint_catalog_line(t.table_name, hints_by_table[t.table_name]))
            else:
                lines.append(t.table_name)
        catalog = "\n".join(lines)
        prompt = (
            f"User question: {message}\n\n"
            f"Allowed tables (pick only names from this list; lines may include business notes):\n{catalog}\n\n"
            f"Return JSON only: {{\"tables\": [\"name1\", ...]}} with at most {max_tables} table names.\n"
        )
        client = OpenAI(api_key=settings.openai_api_key)
        model = resolve_openai_model(db_id, settings.openai_model)
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=120,
        )
        raw = resp.choices[0].message.content or ""
        raw = re.sub(r"^```[a-z]*\n?", "", raw.strip())
        raw = re.sub(r"\n?```$", "", raw.strip())
        data = json.loads(raw)
        picked = [str(x) for x in data.get("tables", []) if str(x) in names]
        if not picked:
            return None
        return picked[:max_tables]
    except Exception as e:
        logger.warning(f"[planner] LLM planner failed: {e}")
        return None


def plan_relevant_tables(
    message: str,
    candidates: list[TableSchema],
    max_tables: int = 10,
    use_llm: bool = True,
    hints_by_table: Optional[dict[str, dict[str, Any]]] = None,
    db_id: Optional[str] = None,
) -> tuple[list[str], str]:
    """
    Returns (table_names, planner_source).
    """
    if use_llm:
        llm = plan_tables_llm(
            message,
            candidates,
            max_tables=max_tables,
            hints_by_table=hints_by_table,
            db_id=db_id,
        )
        if llm:
            return llm, "llm"
    rules = plan_tables_rules(
        message, candidates, max_tables=max_tables, hints_by_table=hints_by_table,
    )
    return rules, "rules"
