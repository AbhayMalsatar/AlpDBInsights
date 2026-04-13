"""Hybrid retrieval: keyword scoring + vector search table names."""
from __future__ import annotations

import re
import logging
from typing import Optional

from app.models.schemas import TableSchema

logger = logging.getLogger(__name__)


def _query_tokens(message: str) -> set[str]:
    return {w for w in re.findall(r"[a-zA-Z_]{3,}", message.lower())}


def _hint_match_bonus(message: str, hint: dict) -> int:
    """Boost retrieval when user words match segment labels / description."""
    words = _query_tokens(message)
    if not words:
        return 0
    bonus = 0
    desc = (hint.get("description") or "").lower()
    for w in words:
        if len(w) > 2 and w in desc:
            bonus += 6
    for seg in hint.get("segments") or []:
        if not isinstance(seg, dict):
            continue
        lab = (seg.get("label") or "").lower()
        for w in words:
            if len(w) > 2 and w in lab:
                bonus += 16
        col = (seg.get("column") or "").lower()
        for w in words:
            if col and (w == col or w in col.replace("_", "")):
                bonus += 4
        for v in seg.get("values") or []:
            vs = str(v).lower()
            for w in words:
                if vs == w or w in vs:
                    bonus += 10
    return bonus


def keyword_score_table(message: str, table: TableSchema, hint: Optional[dict] = None) -> int:
    words = _query_tokens(message)
    if not words:
        return 0
    score = 0
    tl = table.table_name.lower()
    # table name: substring and token overlap
    for w in words:
        if w in tl or tl.replace("_", "").find(w.replace("_", "")) >= 0:
            score += 18
    parts = tl.split("_")
    for w in words:
        if w in parts:
            score += 12
    for col in table.columns:
        cl = col.name.lower()
        for w in words:
            if w in cl:
                score += 4
        if col.foreign_key:
            fk = col.foreign_key.lower()
            for w in words:
                if w in fk:
                    score += 3
    if hint:
        score += _hint_match_bonus(message, hint)
    return score


def hybrid_rank_tables(
    message: str,
    tables: list[TableSchema],
    db_id: str,
    vector_top_k: int = 10,
    keyword_pool: int = 40,
    hints_by_table: Optional[dict[str, dict]] = None,
) -> list[TableSchema]:
    """
    Merge vector-hit table names with keyword-ranked tables.
    Returns ordered list (best first), deduped.
    """
    scores: dict[str, float] = {t.table_name: 0.0 for t in tables}
    by_name = {t.table_name: t for t in tables}

    for t in tables:
        h = hints_by_table.get(t.table_name) if hints_by_table else None
        scores[t.table_name] += keyword_score_table(message, t, h)

    try:
        from app.agents.schema_agent import get_relevant_tables
        vec_hits = get_relevant_tables(message, db_id, top_k=vector_top_k)
        for name in vec_hits:
            if name in scores:
                scores[name] += 12.0
    except Exception as e:
        logger.debug(f"[hybrid] vector leg skipped: {e}")

    ranked = sorted(tables, key=lambda tt: scores.get(tt.table_name, 0.0), reverse=True)
    # Take top keyword_pool as candidate universe for planner
    return ranked[: max(keyword_pool, 20)]


def expand_fk_neighbors(names: set[str], all_tables: list[TableSchema]) -> set[str]:
    """One-hop FK expansion: if orders selected, pull customers etc."""
    by_name = {t.table_name: t for t in all_tables}
    out = set(names)
    for name in list(names):
        t = by_name.get(name)
        if not t:
            continue
        for c in t.columns:
            if not c.foreign_key:
                continue
            ref = c.foreign_key.split(".")[0].strip()
            if ref in by_name:
                out.add(ref)
    return out
