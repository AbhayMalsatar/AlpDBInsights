"""Chart generation agent - determines chart type and configuration."""
import re
from typing import Optional


def determine_chart_title(query: str) -> str:
    """Generate a clean chart title from the user query."""
    lower = query.lower()
    prefixes = ['create', 'make', 'build', 'generate', 'add', 'show me', 'give me', 'plot', 'draw', 'display', 'show']
    suffixes = ['chart', 'graph', 'plot', 'visualization', 'visual']

    title = lower
    for p in prefixes:
        title = re.sub(rf'^\s*{p}\s+', '', title)
    for s in suffixes:
        title = re.sub(rf'\s+{s}\s*$', '', title)

    # Capitalize properly
    title = title.strip()
    if title:
        title = title[0].upper() + title[1:]

    return title or "Chart"


def determine_layout(existing_chart_count: int, chart_type: str) -> dict:
    """Calculate auto-layout position for new chart."""
    is_wide = chart_type in ["line", "area", "table"]
    is_small = chart_type == "kpi"

    if is_small:
        w, h = 3, 2
    elif is_wide:
        w, h = 12, 4
    else:
        w, h = 6, 4

    # Position: stack vertically, 2 per row for normal, 1 per row for wide
    if is_wide or is_small:
        per_row = 1 if is_wide else 4
        col = (existing_chart_count % per_row) * (12 // per_row)
        row = existing_chart_count // per_row
    else:
        col = (existing_chart_count % 2) * 6
        row = existing_chart_count // 2

    return {"x": col, "y": row * h, "w": w, "h": h, "min_w": 3, "min_h": 2}


def select_keys(columns: list[str], chart_type: str) -> tuple[Optional[str], list[str]]:
    """
    Choose x_key (label axis) and y_keys (value axis) from result columns.
    - ID columns (_id suffix / exact 'id') are NEVER used as x_key.
    - Name/label columns are strongly preferred for x_key.
    - Numeric/aggregate columns are used as y_keys.
    """
    if not columns:
        return None, []

    lower = [c.lower() for c in columns]

    # Columns to EXCLUDE from x_key (raw IDs)
    id_cols = {
        columns[i] for i, c in enumerate(lower)
        if c == 'id' or c.endswith('_id') or c.endswith('id')
    }

    # Non-ID columns only
    non_id = [c for c in columns if c not in id_cols]

    date_cols = [c for c in non_id if any(d in c.lower() for d in
                 ['date', 'month', 'week', 'year', 'period', 'day', 'time', 'created'])]

    category_cols = [c for c in non_id if any(cat in c.lower() for cat in
                     ['name', 'category', 'item', 'product', 'region', 'customer',
                      'country', 'city', 'type', 'title', 'description',
                      'supplier', 'employee', 'shipper', 'company', 'contact'])]

    numeric_cols = [c for c in non_id if any(n in c.lower() for n in
                    ['count', 'total', 'sum', 'revenue', 'quantity', 'amount',
                     'value', 'sales', 'cost', 'price', 'profit', 'stock',
                     'freight', 'discount', 'unit', 'extended', 'subtotal',
                     'tax', 'salary', 'budget', 'orders'])]

    agg_cols = [c for c in non_id if
                c.startswith(('total_', 'sum_', 'avg_', 'count_', 'max_', 'min_'))
                or c in ('total', 'count', 'sum', 'avg', 'revenue', 'quantity', 'amount')]

    all_numeric = list(dict.fromkeys(numeric_cols + agg_cols))

    # ── Pick x_key (label axis) ──────────────────────────────
    if chart_type in ("line", "area"):
        x_key = (date_cols[0]     if date_cols     else
                 category_cols[0] if category_cols else
                 non_id[0]        if non_id        else columns[0])
    elif chart_type in ("bar", "pie"):
        x_key = (category_cols[0] if category_cols else
                 date_cols[0]     if date_cols     else
                 non_id[0]        if non_id        else columns[0])
    else:
        x_key = non_id[0] if non_id else columns[0]

    # ── Pick y_keys (value axis) — must not be x or an ID ────
    y_keys = [c for c in all_numeric if c != x_key]
    if not y_keys:
        y_keys = [c for c in non_id if c != x_key][:2]
    if not y_keys:
        y_keys = [c for c in columns if c != x_key][:1]

    return x_key, y_keys


def determine_chart_type(query: str, columns: list[str], row_count: int) -> str:
    """Intelligently determine the best chart type."""
    lower = query.lower()

    # Explicit keywords
    if any(w in lower for w in ["pie", "donut", "portion", "share", "percent", "distribution", "breakdown"]):
        return "pie"
    if "area" in lower:
        return "area"
    if any(w in lower for w in ["line", "trend", "over time", "timeline", "monthly", "daily", "weekly", "yearly"]):
        return "line"
    if any(w in lower for w in ["table", "list", "all", "show all", "details", "records"]):
        return "table"
    if any(w in lower for w in ["kpi", "card", "metric", "single", "total revenue", "total sales"]):
        return "kpi"

    # Heuristics from columns
    col_lower = [c.lower() for c in columns]
    has_date = any(any(d in c for d in ['date', 'month', 'week', 'year', 'period', 'day']) for c in col_lower)

    if has_date and row_count > 5:
        return "line"
    if row_count <= 8 and not has_date:
        return "pie"
    return "bar"
