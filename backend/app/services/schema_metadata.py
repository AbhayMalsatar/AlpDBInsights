"""Rich table metadata for RAG: description, tags, relations, embedding text."""
from __future__ import annotations

import re
from typing import Any, Optional

from app.models.schemas import TableSchema, ColumnSchema

_DOMAIN_TAGS = {
    "sales": ("order", "sale", "invoice", "payment", "revenue", "cart", "quote"),
    "customer": ("customer", "client", "contact", "account", "member", "user"),
    "inventory": ("product", "item", "sku", "stock", "warehouse", "category", "supplier"),
    "hr": ("employee", "staff", "payroll", "department", "hire"),
    "finance": ("ledger", "account", "budget", "journal", "tax", "cost"),
    "logistics": ("ship", "shipment", "delivery", "carrier", "freight", "tracking"),
}


def infer_description(table_name: str, columns: list[ColumnSchema]) -> str:
    """Heuristic one-line description when DB comments are unavailable."""
    t = table_name.replace("_", " ").lower()
    cols = " ".join(c.name.lower() for c in columns[:8])
    if "order" in t and "detail" in t:
        return "Line items / order detail rows linked to orders and products"
    if "order" in t:
        return "Order / transaction header records"
    if "customer" in t or "client" in t:
        return "Customer master / party records"
    if "product" in t or "item" in t:
        return "Product or item catalog"
    if "payment" in t or "invoice" in t:
        return "Billing / payment records"
    if "employee" in t or "staff" in t:
        return "Employee / workforce records"
    if "category" in t:
        return "Product or classification categories"
    return f"Table {table_name} containing {cols or 'business data'}"


def infer_tags(table_name: str, columns: list[ColumnSchema]) -> list[str]:
    """Business tags from table/column names."""
    blob = table_name.lower() + " " + " ".join(c.name.lower() for c in columns)
    tags: list[str] = []
    for domain, keywords in _DOMAIN_TAGS.items():
        if any(k in blob for k in keywords):
            tags.append(domain)
    if not tags:
        tags.append("general")
    return sorted(set(tags))


def relations_from_table(table: TableSchema) -> list[str]:
    """col -> ref_table.ref_col strings."""
    out: list[str] = []
    for c in table.columns:
        if c.foreign_key:
            out.append(f"{c.name} -> {c.foreign_key}")
    return out


def table_to_metadata_dict(table: TableSchema) -> dict[str, Any]:
    desc = infer_description(table.table_name, table.columns)
    tags = infer_tags(table.table_name, table.columns)
    rels = relations_from_table(table)
    return {
        "table": table.table_name,
        "description": desc,
        "columns": [c.name for c in table.columns],
        "relations": rels,
        "tags": tags,
    }


def _append_user_hint_parts(parts: list[str], hint: dict[str, Any]) -> None:
    """Enrich RAG text with curated business rules (multi-tenant / type columns)."""
    desc = (hint.get("description") or "").strip()
    if desc:
        parts.append(f"Curator notes: {desc}")
    segments = hint.get("segments") or []
    if not isinstance(segments, list):
        return
    for seg in segments[:16]:
        if not isinstance(seg, dict):
            continue
        label = (seg.get("label") or "").strip()
        where_sql = (seg.get("where_sql") or "").strip()
        col = (seg.get("column") or "").strip()
        values = seg.get("values") or []
        if not label:
            continue
        if where_sql:
            parts.append(f"  Segment «{label}»: SQL filter {where_sql}")
        elif col and values:
            vals = ", ".join(repr(str(v)) for v in values[:24])
            parts.append(f"  Segment «{label}»: column {col} IN ({vals})")
        else:
            parts.append(f"  Segment «{label}»")
    rc = hint.get("approx_row_count")
    if rc is not None:
        try:
            parts.append(f"Approx row count (hint): {int(rc):,}")
        except (TypeError, ValueError):
            pass


def table_to_rag_document(table: TableSchema, hint: Optional[dict[str, Any]] = None) -> str:
    """
    Single embedding-friendly document per table (for vector store).
    Optional hint = per-table dict from table_hints JSON (description, segments, …).
    """
    meta = table_to_metadata_dict(table)
    col_sample = ", ".join(meta["columns"][:40])
    if len(meta["columns"]) > 40:
        col_sample += f", ... (+{len(meta['columns']) - 40} more)"
    rel = "; ".join(meta["relations"][:12])
    tags = ", ".join(meta["tags"])
    parts = [
        f"Table {meta['table']}: {meta['description']}",
        f"Tags: {tags}",
        f"Columns: {col_sample}",
    ]
    if rel:
        parts.append(f"Foreign keys: {rel}")
    if hint:
        _append_user_hint_parts(parts, hint)
    return "\n".join(parts)
