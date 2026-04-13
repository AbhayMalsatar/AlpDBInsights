"""Ultra-compact schema lines for SQL LLM (token saver)."""
from __future__ import annotations

import re

from typing import Any, Optional

from app.models.schemas import TableSchema, ColumnSchema

_DATE_HINTS = frozenset({"date", "time", "at", "created", "updated", "month", "year"})
_METRIC_HINTS = frozenset(
    {"amount", "total", "qty", "quantity", "count", "sum", "price", "cost", "revenue", "value", "sales"}
)


def _column_priority(col: ColumnSchema, query_lower: str) -> int:
    name = col.name.lower()
    q = query_lower
    score = 0
    for w in re.findall(r"[a-zA-Z_]{3,}", q):
        if w in name:
            score += 6
    if col.foreign_key:
        score += 2
    if col.primary_key:
        score += 1
    if any(h in name for h in _DATE_HINTS):
        score += 4
    if any(h in name for h in _METRIC_HINTS):
        score += 3
    if name.endswith("_id") or name == "id":
        score -= 2
    return score


def prioritize_columns(table: TableSchema, query: str, max_cols: int = 14) -> list[str]:
    q = query.lower()
    ranked = sorted(
        table.columns,
        key=lambda c: (_column_priority(c, q), -len(c.name)),
        reverse=True,
    )
    picked: list[str] = []
    for c in ranked:
        if len(picked) >= max_cols:
            break
        picked.append(c.name)
    # Stable-ish: put primary keys first if missing
    pk = [c.name for c in table.columns if c.primary_key]
    for p in reversed(pk):
        if p in picked:
            picked.remove(p)
            picked.insert(0, p)
    return picked


def _hint_business_suffix(hint: dict[str, Any]) -> str:
    if not hint:
        return ""
    parts: list[str] = []
    d = (hint.get("description") or "").strip()
    if d:
        parts.append(d[:180])
    for seg in (hint.get("segments") or [])[:6]:
        if not isinstance(seg, dict):
            continue
        lab = (seg.get("label") or "").strip()
        if not lab:
            continue
        ws = (seg.get("where_sql") or "").strip()
        col = (seg.get("column") or "").strip()
        vals = seg.get("values") or []
        if ws:
            parts.append(f"{lab}: ({ws})")
        elif col and vals:
            vstr = ", ".join(repr(str(v)) for v in vals[:8])
            parts.append(f"{lab}: {col} IN ({vstr})")
        else:
            parts.append(lab)
    if not parts:
        return ""
    return " | Biz: " + " | ".join(parts)[:420]


def table_to_signature_line(
    table: TableSchema,
    query: str,
    max_cols: int = 14,
    hint: Optional[dict[str, Any]] = None,
) -> str:
    cols = prioritize_columns(table, query, max_cols=max_cols)
    col_part = ", ".join(cols)
    fks = [f"{c.name}->{c.foreign_key}" for c in table.columns if c.foreign_key][:6]
    fk_part = ""
    if fks:
        fk_part = " | FK: " + ", ".join(fks)
    return f"{table.table_name}({col_part}){fk_part}{_hint_business_suffix(hint or {})}"


def compress_tables_for_prompt(
    query: str,
    tables: list[TableSchema],
    max_lines: int = 14,
    max_estimated_tokens: int = 700,
    estimate_tokens=None,
    hints_by_table: Optional[dict[str, dict[str, Any]]] = None,
) -> tuple[str, dict]:
    """
    Build minimal multi-line context:
    tables as one line each.
    """
    if estimate_tokens is None:
        def estimate_tokens(t: str) -> int:
            return max(1, len(t) // 4)

    lines: list[str] = []
    meta: dict = {"lines": 0, "tables_included": []}
    header = "Schema (use only listed tables/columns; use FK for joins):"
    used = estimate_tokens(header) + 2

    for t in tables[: max_lines * 2]:
        if len(lines) >= max_lines:
            break
        h = hints_by_table.get(t.table_name) if hints_by_table else None
        line = table_to_signature_line(t, query, hint=h)
        cost = estimate_tokens(line) + 1
        if used + cost > max_estimated_tokens and lines:
            continue
        lines.append(line)
        used += cost
        meta["tables_included"].append(t.table_name)

    body = "\n".join(lines)
    text = header + "\n" + body if lines else ""
    meta["lines"] = len(lines)
    meta["estimated_tokens"] = estimate_tokens(text)
    return text, meta
