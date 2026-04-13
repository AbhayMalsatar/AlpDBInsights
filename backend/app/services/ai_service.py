"""Main AI service orchestrating the agent pipeline."""
import uuid
import json
import logging
import re
from pathlib import Path
from datetime import datetime
from typing import Optional

from app.models.schemas import AIChatRequest, AIChatResponse, ChartConfig, GridLayout, ChartType
from app.agents.intent_agent import detect_intent, extract_chart_hints, AIIntent
from app.agents.schema_agent import find_relevant_schema
from app.agents.sql_agent import generate_sql_with_llm
from app.agents.chart_agent import determine_chart_type, determine_chart_title, determine_layout, select_keys

logger = logging.getLogger(__name__)

# ── Persistent database registry ─────────────────────────────────────────────
# Stored as JSON next to this file so it survives backend restarts.
_REGISTRY_FILE = Path(__file__).parent.parent.parent / "db_registry.json"
_database_registry: dict = {}


def _load_registry():
    global _database_registry
    try:
        if _REGISTRY_FILE.exists():
            _database_registry = json.loads(_REGISTRY_FILE.read_text())
            logger.info(f"Loaded {len(_database_registry)} database(s) from registry.")
    except Exception as e:
        logger.warning(f"Could not load registry: {e}")


def _save_registry():
    try:
        _REGISTRY_FILE.write_text(json.dumps(_database_registry, indent=2))
    except Exception as e:
        logger.warning(f"Could not save registry: {e}")


# Load on import
_load_registry()


def register_database(db_id: str, db_config: dict):
    """Register a database connection and persist to disk."""
    _database_registry[db_id] = db_config
    _save_registry()


def unregister_database(db_id: str):
    _database_registry.pop(db_id, None)
    _save_registry()


def get_database_config(db_id: str) -> Optional[dict]:
    return _database_registry.get(db_id)


def _load_tables_for_chat(db_id: str, db_config: dict):
    """
    Prefer on-disk snapshot (fast); else extract from DB, snapshot, persist fingerprint.
    Returns (tables_or_none, schema_fingerprint).
    """
    from app.models.schemas import DatabaseType
    from app.services.schema_snapshot import (
        load_schema_snapshot,
        save_schema_snapshot,
        schema_fingerprint,
    )
    from app.services.schema_service import extract_schema

    tables = load_schema_snapshot(db_id)
    if tables:
        fp = db_config.get("schema_fingerprint") or schema_fingerprint(tables)
        if not db_config.get("schema_fingerprint"):
            _database_registry[db_id] = {**db_config, "schema_fingerprint": fp}
            _save_registry()
        return tables, fp
    try:
        tables = extract_schema(
            DatabaseType(db_config["type"]),
            db_config["host"],
            db_config["port"],
            db_config["username"],
            db_config["password"],
            db_config["database"],
        )
        save_schema_snapshot(db_id, tables)
        fp = schema_fingerprint(tables)
        _database_registry[db_id] = {**db_config, "schema_fingerprint": fp}
        _save_registry()
        return tables, fp
    except Exception as e:
        logger.error(f"[chat_v2] Schema load/extract failed: {e}")
        return None, ""


def _extract_sql_table_refs(sql: str) -> set[str]:
    """Loose FROM/JOIN table names for post-generation validation."""
    if not sql:
        return set()
    s = re.sub(r"/\*.*?\*/", "", sql, flags=re.S)
    s = re.sub(r"'[^']*'", "", s)
    refs: set[str] = set()
    skip = {
        "SELECT", "WHERE", "GROUP", "ORDER", "LATERAL", "UNNEST", "VALUES",
        "ON", "AS", "AND", "OR", "NOT", "NULL", "CASE", "WHEN", "THEN", "ELSE",
    }
    for m in re.finditer(r"\b(?:FROM|JOIN)\s+(?:(?:\w+)\.)?(\w+)", s, re.I):
        t = m.group(1)
        if t.upper() not in skip:
            refs.add(t)
    return refs


def _validate_sql_tables(sql: str, allowed: set[str]) -> tuple[bool, set[str]]:
    """True if every referenced base table is in allowed (or no refs detected)."""
    refs = _extract_sql_table_refs(sql)
    if not refs:
        return True, refs
    unknown = {r for r in refs if r not in allowed}
    return len(unknown) == 0, unknown


def _get_full_schema_context(db_config: dict) -> str:
    """
    Directly extract schema from the DB when vector search returns nothing.
    Returns a compact text representation of all tables and columns.
    Only schema metadata — never actual row data.
    """
    try:
        from app.services.schema_service import extract_schema, schema_to_text
        from app.models.schemas import DatabaseType
        tables = extract_schema(
            DatabaseType(db_config["type"]),
            db_config["host"], db_config["port"],
            db_config["username"], db_config["password"],
            db_config["database"],
        )
        return "\n\n".join(schema_to_text(t) for t in tables)
    except Exception as e:
        logger.error(f"Direct schema extraction failed: {e}")
        return ""


def _estimate_tokens(text: str) -> int:
    """Rough token estimate without external tokenizer."""
    if not text:
        return 0
    return max(1, len(text) // 4)


def _extract_schema_blocks(schema_context: str) -> list[str]:
    """
    Split schema text into table-sized blocks.
    Expected format uses separators like: \\n\\n---\\n\\n
    """
    if not schema_context.strip():
        return []
    parts = [p.strip() for p in schema_context.split("\n\n---\n\n") if p.strip()]
    if parts:
        return parts
    # Fallback if separator missing: split by 'Table:'
    raw = re.split(r"(?=Table:\s+\w+)", schema_context)
    return [p.strip() for p in raw if p.strip()]


def _compress_schema_context(
    query: str,
    schema_context: str,
    max_schema_tokens: int = 700,
    max_blocks: int = 12,
) -> tuple[str, dict]:
    """
    Compress schema context to stay inside token budget.
    Keeps only top relevant table blocks.
    """
    blocks = _extract_schema_blocks(schema_context)
    if not blocks:
        return "", {
            "schema_blocks_total": 0,
            "schema_blocks_used": 0,
            "schema_tokens_before": 0,
            "schema_tokens_after": 0,
        }

    query_words = {w for w in re.findall(r"[a-zA-Z_]{3,}", query.lower())}

    def score_block(block: str) -> int:
        lower = block.lower()
        table_match = re.search(r"table:\s*(\w+)", lower)
        table_name = table_match.group(1) if table_match else ""
        score = 0
        if table_name and table_name in query_words:
            score += 10
        # word overlap signal
        score += sum(1 for w in query_words if w in lower)
        # prioritize concise blocks
        score -= max(0, _estimate_tokens(block) // 150)
        return score

    ranked = sorted(blocks, key=score_block, reverse=True)
    selected: list[str] = []
    used_tokens = 0

    for block in ranked:
        if len(selected) >= max_blocks:
            break
        block_tokens = _estimate_tokens(block)
        # +2 buffer for separators
        if used_tokens + block_tokens + 2 > max_schema_tokens:
            continue
        selected.append(block)
        used_tokens += block_tokens + 2

    # Ensure at least one block if everything got filtered
    if not selected:
        first = ranked[0]
        selected = [first]
        used_tokens = _estimate_tokens(first)

    compressed = "\n\n---\n\n".join(selected)
    return compressed, {
        "schema_blocks_total": len(blocks),
        "schema_blocks_used": len(selected),
        "schema_tokens_before": _estimate_tokens(schema_context),
        "schema_tokens_after": _estimate_tokens(compressed),
    }


async def process_chat(request: AIChatRequest) -> AIChatResponse:
    """
    Full AI pipeline:
    User Input → Intent → Schema Search → SQL Generation → Query Execution → Chart
    """
    message = request.message.strip()
    existing_chart_count = len(request.existing_charts or [])

    # Step 1: Intent detection
    intent, confidence = detect_intent(message)
    chart_hints = extract_chart_hints(message)

    logger.info(f"Intent: {intent} (confidence={confidence:.2f}), hints={chart_hints}")

    if intent == AIIntent.info:
        return AIChatResponse(
            message=_generate_info_response(message),
            intent=intent.value,
            action="info",
        )

    if intent == AIIntent.create_chart:
        return await _handle_create_chart(request, message, chart_hints, existing_chart_count)

    if intent == AIIntent.modify_chart:
        return AIChatResponse(
            message="I can modify charts! Please tell me which chart you'd like to change and how.",
            intent=intent.value,
            action="modify_chart",
        )

    if intent == AIIntent.delete_chart:
        return AIChatResponse(
            message="To delete a chart, click the ⋮ menu on the chart and select 'Remove Chart'.",
            intent=intent.value,
            action="delete_chart",
        )

    if intent == AIIntent.add_filter:
        return AIChatResponse(
            message="Filter creation via AI is coming soon! For now, filters can be configured in the sidebar.",
            intent=intent.value,
            action="add_filter",
        )

    # Fallback: try as chart creation
    return await _handle_create_chart(request, message, chart_hints, existing_chart_count)


async def _handle_create_chart(
    request: AIChatRequest,
    message: str,
    hints: dict,
    existing_count: int,
) -> AIChatResponse:
    """Handle chart creation with full agent pipeline."""

    db_id = request.database_id
    db_config = get_database_config(db_id) if db_id else None

    # Step 2: Schema search
    schema_context = ""
    if db_id and db_config:
        schema_context = find_relevant_schema(message, db_id, top_k=4)

    # Step 3: SQL generation
    sql = None
    query_data = []
    columns = []

    if db_config and schema_context:
        sql = generate_sql_with_llm(
            query=message,
            schema_context=schema_context,
            db_type=db_config.get("type", "postgresql"),
        )

        if sql:
            try:
                from app.services.query_service import execute_query
                from app.models.schemas import DatabaseType
                result = execute_query(
                    db_type=DatabaseType(db_config["type"]),
                    host=db_config["host"],
                    port=db_config["port"],
                    username=db_config["username"],
                    password=db_config["password"],
                    database=db_config["database"],
                    sql=sql,
                )
                query_data = result.rows
                columns = result.columns
            except Exception as e:
                logger.error(f"Query execution failed: {e}")
                # Fall through to mock data

    # Use demo data if no real DB
    if not query_data:
        sql = sql or _get_example_sql(message)
        query_data, columns = _generate_demo_data(message, hints)

    # Step 4: Chart agent - determine type and layout
    chart_type_str = hints.get("chart_type") or determine_chart_type(message, columns, len(query_data))
    chart_title = determine_chart_title(message)
    layout_dict = determine_layout(existing_count, chart_type_str)
    x_key, y_keys = select_keys(columns, chart_type_str)

    chart_id = str(uuid.uuid4())[:9]
    layout = GridLayout(
        i=chart_id,
        x=layout_dict["x"],
        y=layout_dict["y"],
        w=layout_dict["w"],
        h=layout_dict["h"],
        min_w=layout_dict["min_w"],
        min_h=layout_dict["min_h"],
    )

    chart = ChartConfig(
        id=chart_id,
        title=chart_title,
        type=ChartType(chart_type_str),
        sql=sql or "",
        data=query_data,
        x_key=x_key,
        y_keys=y_keys,
        database_id=db_id or "demo",
        created_at=datetime.utcnow().isoformat(),
        layout=layout,
    )

    response_message = _build_success_message(chart_title, chart_type_str, len(query_data), bool(db_config))

    return AIChatResponse(
        message=response_message,
        intent=AIIntent.create_chart.value,
        charts=[chart],
        action="create_chart",
        tab_id=request.tab_id,
    )


def _generate_demo_data(message: str, hints: dict) -> tuple[list, list]:
    """Generate realistic demo data when no database is connected."""
    import random
    random.seed(42)

    lower = message.lower()
    chart_type = hints.get("chart_type", "bar")

    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    items = ["Laptop", "Phone", "Tablet", "Monitor", "Keyboard", "Mouse", "Headset", "Camera"]
    categories = ["Electronics", "Furniture", "Stationery", "Software", "Hardware"]
    regions = ["North", "South", "East", "West", "Central"]

    if chart_type in ["line", "area"]:
        data = [{"month": m, "revenue": random.randint(80000, 350000), "target": random.randint(100000, 300000)} for m in months]
        return data, ["month", "revenue", "target"]

    if chart_type == "pie":
        if "region" in lower:
            data = [{"region": r, "sales": random.randint(50000, 300000)} for r in regions]
            return data, ["region", "sales"]
        data = [{"category": c, "value": random.randint(20000, 150000)} for c in categories]
        return data, ["category", "value"]

    if chart_type == "table":
        data = [{"rank": i+1, "product": items[i % len(items)], "quantity": random.randint(100, 2000),
                 "revenue": random.randint(10000, 150000), "growth": f"{random.randint(-20,50)}%"}
                for i in range(10)]
        return data, ["rank", "product", "quantity", "revenue", "growth"]

    if chart_type == "kpi":
        label = determine_chart_title(message)
        data = [{"label": label, "value": random.randint(100000, 5000000),
                 "change": round(random.uniform(-15, 35), 1), "changeLabel": "vs last month", "prefix": "$"}]
        return data, ["label", "value", "change"]

    # Bar chart
    if "purchase" in lower:
        data = [{"item": it, "quantity": random.randint(50, 800), "cost": random.randint(5000, 80000)} for it in items[:7]]
        return data, ["item", "quantity", "cost"]
    if "stock" in lower:
        data = [{"category": c, "in_stock": random.randint(200, 2000), "low_stock": random.randint(0, 100)} for c in categories]
        return data, ["category", "in_stock", "low_stock"]
    # Default sales
    data = [{"item": it, "sales": random.randint(100, 1500), "revenue": random.randint(10000, 150000)} for it in items]
    return data, ["item", "sales", "revenue"]


def _get_example_sql(message: str) -> str:
    lower = message.lower()
    if "sales" in lower and "item" in lower:
        return "SELECT items.name, SUM(sales.quantity) as qty, SUM(sales.price*sales.quantity) as revenue FROM sales JOIN items ON sales.item_id=items.id GROUP BY items.name ORDER BY revenue DESC"
    if "purchase" in lower:
        return "SELECT DATE_TRUNC('month', created_at) as month, SUM(total_cost) as total FROM purchases GROUP BY month ORDER BY month"
    if "stock" in lower:
        return "SELECT category, SUM(stock) as total_stock FROM items GROUP BY category ORDER BY total_stock DESC"
    return "SELECT * FROM sales LIMIT 100"


def _build_success_message(title: str, chart_type: str, row_count: int, has_db: bool) -> str:
    db_note = "" if has_db else " (using demo data — connect a database for real data)"
    return (
        f"I've created a **{chart_type} chart** for **{title}**. "
        f"The visualization shows {row_count} data points{db_note}. "
        f"You can drag to reposition or resize the chart on the dashboard."
    )


async def process_chat_v2(request) -> dict:
    """
    Chat pipeline with conversational intelligence:
      0. Greetings / thanks / help / ambiguity detection
      1. Detect chart intent
      2. Schema context — use frontend-provided text first (most reliable),
         then vector search, then direct DB extraction
      3. Generate SQL via LLM
      4. Inject tab filters
      5. Execute against real DB
      6. Build chart metadata
      7. Demo data fallback if DB unavailable
    """
    from app.agents.intent_agent import detect_intent, extract_chart_hints, AIIntent
    from app.agents.schema_agent import find_relevant_schema
    from app.agents.sql_agent import generate_sql_with_llm
    from app.agents.chart_agent import determine_chart_type, determine_chart_title, select_keys
    from app.agents.conversation_agent import (
        is_greeting, is_thanks, is_help_request, is_ambiguous,
        greeting_response, thanks_response, help_response,
        clarification_response, llm_clarification,
    )

    message = request.message.strip()
    db_id   = request.db_id
    filters = request.filters or {}
    # Keep compatibility: frontend may still send schema, but backend now compresses it.
    frontend_schema: str = getattr(request, "schema_context", None) or ""
    db_name = (get_database_config(db_id) or {}).get("database", "your database") if db_id else "your database"

    logger.info(f"[chat_v2] '{message[:80]}' db_id={db_id} schema_len={len(frontend_schema)}")
    token_budget = 1000
    query_tokens = _estimate_tokens(message)

    # ── 0. Conversational shortcuts ──────────────────────────────
    if is_greeting(message):
        resp = greeting_response(frontend_schema, db_name)
        resp["token_usage"] = {
            "query_tokens": query_tokens,
            "schema_tokens": 0,
            "prompt_tokens": query_tokens,
            "sql_tokens": 0,
            "total_estimated_tokens": query_tokens,
            "budget_tokens": token_budget,
        }
        return resp

    if is_thanks(message):
        resp = thanks_response()
        resp["token_usage"] = {
            "query_tokens": query_tokens,
            "schema_tokens": 0,
            "prompt_tokens": query_tokens,
            "sql_tokens": 0,
            "total_estimated_tokens": query_tokens,
            "budget_tokens": token_budget,
        }
        return resp

    if is_help_request(message):
        resp = help_response(frontend_schema)
        resp["token_usage"] = {
            "query_tokens": query_tokens,
            "schema_tokens": 0,
            "prompt_tokens": query_tokens,
            "sql_tokens": 0,
            "total_estimated_tokens": query_tokens,
            "budget_tokens": token_budget,
        }
        return resp

    if is_ambiguous(message, frontend_schema):
        # Try LLM clarification first (richer), fallback to rule-based
        llm_reply = llm_clarification(message, frontend_schema) if frontend_schema else ""
        if llm_reply:
            # Parse suggestions from lines starting with "- "
            lines = llm_reply.splitlines()
            suggestions = [l.lstrip("- ").strip() for l in lines if l.strip().startswith("- ")]
            question = next((l for l in lines if not l.strip().startswith("- ") and l.strip()), llm_reply)
            return {
                "type":        "clarification",
                "message":     question.strip(),
                "suggestions": suggestions,
                "intent":      "clarification",
                "token_usage": {
                    "query_tokens": query_tokens,
                    "schema_tokens": 0,
                    "prompt_tokens": query_tokens,
                    "sql_tokens": 0,
                    "total_estimated_tokens": query_tokens,
                    "budget_tokens": token_budget,
                },
            }
        resp = clarification_response(message, frontend_schema)
        resp["token_usage"] = {
            "query_tokens": query_tokens,
            "schema_tokens": 0,
            "prompt_tokens": query_tokens,
            "sql_tokens": 0,
            "total_estimated_tokens": query_tokens,
            "budget_tokens": token_budget,
        }
        return resp

    intent, _ = detect_intent(message)
    hints     = extract_chart_hints(message)

    # ── 1. DB config ────────────────────────────────────────────
    db_config = get_database_config(db_id) if db_id else None
    if db_id and not db_config and not frontend_schema:
        return {
            "type":    "error",
            "message": (
                "It looks like your database session expired (the server may have restarted). "
                "Head to the **Databases** page and reconnect, then come back here."
            ),
            "suggestions": ["Go to Databases page to reconnect"],
            "intent": intent.value,
            "token_usage": {
                "query_tokens": query_tokens,
                "schema_tokens": 0,
                "prompt_tokens": query_tokens,
                "sql_tokens": 0,
                "total_estimated_tokens": query_tokens,
                "budget_tokens": token_budget,
            },
        }

    # ── 2. Schema context — frontend text OR hybrid retrieval + compression ─
    schema_context = ""
    schema_source = "none"
    compressed_meta = {
        "schema_blocks_total": 0,
        "schema_blocks_used": 0,
        "schema_tokens_before": 0,
        "schema_tokens_after": 0,
    }
    planner_source = ""
    retrieval_table_names: list[str] = []
    all_tables_for_validation: Optional[list] = None
    schema_fp = ""
    cache_schema_token = "none:none"

    if frontend_schema:
        schema_context = frontend_schema
        schema_source = "frontend"
        logger.info(f"[chat_v2] Using frontend schema ({len(schema_context)} chars)")
        schema_context, compressed_meta = _compress_schema_context(
            query=message,
            schema_context=schema_context,
            max_schema_tokens=700,
            max_blocks=12,
        )
    elif db_config and db_id:
        from app.services.schema_retrieval import hybrid_rank_tables, expand_fk_neighbors
        from app.services.schema_compressor import compress_tables_for_prompt
        from app.agents.query_planner import plan_relevant_tables
        from app.services.table_hints_service import load_hints_by_table, hints_fingerprint

        tbls, schema_fp = _load_tables_for_chat(db_id, db_config)
        hints_by_table = load_hints_by_table(db_id)
        hints_fp = hints_fingerprint(hints_by_table)
        cache_schema_token = f"{schema_fp or 'none'}:{hints_fp}"
        if not tbls:
            schema_context = find_relevant_schema(message, db_id, top_k=5)
            schema_source = "vector_fallback"
            if not schema_context:
                schema_context = _get_full_schema_context(db_config)
                schema_source = "direct_fallback"
            if schema_context:
                schema_context, compressed_meta = _compress_schema_context(
                    query=message,
                    schema_context=schema_context,
                    max_schema_tokens=700,
                    max_blocks=12,
                )
        else:
            all_tables_for_validation = tbls
            candidates = hybrid_rank_tables(
                message, tbls, db_id, vector_top_k=10, keyword_pool=40, hints_by_table=hints_by_table,
            )
            planned, planner_source = plan_relevant_tables(
                message, candidates, max_tables=12, use_llm=True, hints_by_table=hints_by_table,
            )
            names_set = expand_fk_neighbors(set(planned), tbls)
            selected = [t for t in tbls if t.table_name in names_set]
            if not selected:
                selected = tbls[: min(8, len(tbls))]
            retrieval_table_names = [t.table_name for t in selected]
            schema_context, sig_meta = compress_tables_for_prompt(
                message,
                selected,
                max_lines=14,
                max_estimated_tokens=700,
                estimate_tokens=_estimate_tokens,
                hints_by_table=hints_by_table,
            )
            schema_source = f"hybrid_{planner_source}"
            tok_b = sig_meta.get("estimated_tokens", 0)
            compressed_meta = {
                "schema_blocks_total": len(tbls),
                "schema_blocks_used": sig_meta.get("lines", 0),
                "schema_tokens_before": _estimate_tokens(
                    "\n".join(f"{t.table_name}" for t in tbls[:200])
                ),
                "schema_tokens_after": tok_b,
            }
            logger.info(
                "[chat_v2] retrieval planner=%s tables=%s tokens~=%s (of %s total tables)",
                planner_source,
                retrieval_table_names,
                tok_b,
                len(tbls),
            )

    if frontend_schema and schema_context:
        logger.info(
            "[chat_v2] schema source=%s blocks=%s/%s tokens=%s->%s",
            schema_source,
            compressed_meta["schema_blocks_used"],
            compressed_meta["schema_blocks_total"],
            compressed_meta["schema_tokens_before"],
            compressed_meta["schema_tokens_after"],
        )

    if not schema_context:
        if db_id:
            return {
                "type":    "error",
                "message": (
                    "I couldn't load your database schema. "
                    "Try reconnecting the database from the **Databases** page."
                ),
                "suggestions": [],
                "intent": intent.value,
                "token_usage": {
                    "query_tokens": query_tokens,
                    "schema_tokens": 0,
                    "prompt_tokens": query_tokens,
                    "sql_tokens": 0,
                    "total_estimated_tokens": query_tokens,
                    "budget_tokens": token_budget,
                },
            }
        # No DB — pure demo
        data, columns = _generate_demo_data(message, hints)
        chart_type  = hints.get("chart_type") or determine_chart_type(message, columns, len(data))
        chart_title = determine_chart_title(message)
        x_key, y_keys = select_keys(columns, chart_type)
        return {
            "type":    "chart",
            "message": f"Here's a **{chart_title}** chart with sample data. Connect a database to use real data!",
            "suggestions": [],
            "intent":  intent.value,
            "sql":     None,
            "data":    data,
            "columns": columns,
            "chart":   {"title": chart_title, "type": chart_type,
                        "x_key": x_key, "y_key": y_keys[0] if y_keys else None},
            "token_usage": {
                "query_tokens": query_tokens,
                "schema_tokens": 0,
                "prompt_tokens": query_tokens,
                "sql_tokens": 0,
                "total_estimated_tokens": query_tokens,
                "budget_tokens": token_budget,
            },
        }

    # ── 3. SQL generation (cache → LLM + optional validation retry) ─
    from app.services.sql_cache import get_cached_sql, set_cached_sql

    db_type = db_config.get("type", "postgresql") if db_config else "postgresql"
    sql: str | None = None
    cache_hit = False
    allowed_table_names: Optional[set[str]] = None
    if all_tables_for_validation:
        allowed_table_names = {t.table_name for t in all_tables_for_validation}

    prompt_tokens = query_tokens + _estimate_tokens(schema_context) + 220

    if db_id and db_config and not frontend_schema:
        cached_sql = get_cached_sql(db_id, message, cache_schema_token, filters or None)
        if cached_sql:
            sql = _inject_filters(cached_sql, filters, db_type)
            cache_hit = True
            prompt_tokens = query_tokens + _estimate_tokens(schema_context) + 40
            logger.info("[chat_v2] SQL cache hit")

    if not cache_hit:
        try:
            ctx = schema_context
            raw_sql: str | None = None
            for attempt in range(2):
                prompt_tokens = query_tokens + _estimate_tokens(ctx) + 220
                raw_sql = generate_sql_with_llm(
                    query=message,
                    schema_context=ctx,
                    db_type=db_type,
                )
                logger.info(f"[chat_v2] LLM SQL (attempt {attempt + 1}): {raw_sql}")
                if not raw_sql:
                    break
                if allowed_table_names:
                    ok, bad = _validate_sql_tables(raw_sql, allowed_table_names)
                    if ok:
                        break
                    logger.warning(f"[chat_v2] SQL referenced unknown tables {bad}, retrying")
                    hint_tables = (
                        ", ".join(sorted(retrieval_table_names)[:24])
                        if retrieval_table_names
                        else ", ".join(sorted(allowed_table_names)[:32])
                    )
                    ctx = (
                        schema_context
                        + f"\n\nUse ONLY tables that exist in this database. "
                        f"Prefer: {hint_tables}. Do not use: {', '.join(sorted(bad))}."
                    )
                else:
                    break
            if raw_sql:
                sql = _inject_filters(raw_sql, filters, db_type)
        except Exception as e:
            logger.error(f"[chat_v2] SQL generation error: {e}")
            return {
                "type":    "error",
                "message": (
                    f"I had trouble building the SQL query. {e}\n\n"
                    "Try rephrasing — for example:\n"
                    "• 'Show top 10 products by quantity'\n"
                    "• 'Monthly revenue trend'\n"
                    "• 'Sales by category'"
                ),
                "suggestions": [
                    "Show top 10 products by quantity",
                    "Monthly revenue trend",
                    "Sales by category",
                ],
                "intent": intent.value,
                "token_usage": {
                    "query_tokens": query_tokens,
                    "schema_tokens": _estimate_tokens(schema_context),
                    "prompt_tokens": prompt_tokens,
                    "sql_tokens": 0,
                    "total_estimated_tokens": prompt_tokens,
                    "budget_tokens": token_budget,
                    "schema_source": schema_source,
                    "planner_source": planner_source or None,
                    "cache_hit": False,
                    "retrieval_tables": retrieval_table_names or None,
                },
            }

    if not sql:
        # SQL generation returned nothing — ask for clarification
        clari = clarification_response(message, schema_context)
        clari["message"] = (
            "I understood your request but couldn't build a precise query. "
            + clari["message"]
        )
        clari["token_usage"] = {
            "query_tokens": query_tokens,
            "schema_tokens": _estimate_tokens(schema_context),
            "prompt_tokens": query_tokens + _estimate_tokens(schema_context) + 220,
            "sql_tokens": 0,
            "total_estimated_tokens": query_tokens + _estimate_tokens(schema_context) + 220,
            "budget_tokens": token_budget,
            "schema_source": schema_source,
            "planner_source": planner_source or None,
            "cache_hit": cache_hit,
            "retrieval_tables": retrieval_table_names or None,
        }
        return clari

    _tu_extra = {
        "schema_source": schema_source,
        "planner_source": planner_source or None,
        "cache_hit": cache_hit,
        "retrieval_tables": retrieval_table_names or None,
    }

    # ── 4. Execute ───────────────────────────────────────────────
    data:    list = []
    columns: list = []
    used_real_db  = False

    if db_config:
        try:
            from app.services.query_service import execute_query
            from app.models.schemas import DatabaseType
            result = execute_query(
                db_type   = DatabaseType(db_config["type"]),
                host      = db_config["host"],
                port      = db_config["port"],
                username  = db_config["username"],
                password  = db_config["password"],
                database  = db_config["database"],
                sql       = sql,
            )
            data         = result.rows
            columns      = result.columns
            used_real_db = True
            logger.info(f"[chat_v2] Query returned {len(data)} rows, columns={columns}")
            if not cache_hit and schema_fp and db_id and not frontend_schema:
                try:
                    set_cached_sql(db_id, message, cache_schema_token, sql, filters or None)
                except Exception as ce:
                    logger.debug(f"[chat_v2] cache save skipped: {ce}")
        except Exception as e:
            logger.error(f"[chat_v2] Query execution error: {e}")
            err_str = str(e)
            # Give user a helpful message based on error type
            if "column" in err_str.lower() or "relation" in err_str.lower() or "does not exist" in err_str.lower():
                friendly = (
                    f"The query referenced a column or table that doesn't exist.\n\n"
                    f"**Error:** `{err_str}`\n\n"
                    f"Try rephrasing — for example instead of 'product id', say 'product name'."
                )
            elif "syntax" in err_str.lower():
                friendly = (
                    f"There was a SQL syntax error.\n\n**Error:** `{err_str}`\n\n"
                    "Try a simpler request first."
                )
            else:
                friendly = f"Query failed: {err_str}"
            return {
                "type":    "error",
                "message": friendly,
                "suggestions": [
                    "Show top 10 products by name",
                    "Monthly order count",
                    "Revenue by category",
                ],
                "intent": intent.value,
                "sql":    sql,
                "token_usage": {
                    "query_tokens": query_tokens,
                    "schema_tokens": _estimate_tokens(schema_context),
                    "prompt_tokens": prompt_tokens,
                    "sql_tokens": _estimate_tokens(sql),
                    "total_estimated_tokens": prompt_tokens + _estimate_tokens(sql),
                    "budget_tokens": token_budget,
                    **_tu_extra,
                },
            }
    else:
        data, columns = _generate_demo_data(message, hints)

    if not data:
        return {
            "type":    "info",
            "message": (
                "The query ran successfully but returned **no results**. "
                "This usually means:\n"
                "• The table is empty\n"
                "• The filters are too restrictive\n"
                "• The date range has no data\n\n"
                f"```sql\n{sql}\n```"
            ),
            "suggestions": ["Try without filters", "Show all orders", "Show all products"],
            "intent": intent.value,
            "sql":    sql,
            "data":   [],
            "columns": columns,
            "token_usage": {
                "query_tokens": query_tokens,
                "schema_tokens": _estimate_tokens(schema_context),
                "prompt_tokens": prompt_tokens,
                "sql_tokens": _estimate_tokens(sql),
                "total_estimated_tokens": prompt_tokens + _estimate_tokens(sql),
                "budget_tokens": token_budget,
                **_tu_extra,
            },
        }

    # ── 5. Chart metadata ────────────────────────────────────────
    chart_type  = hints.get("chart_type") or determine_chart_type(message, columns, len(data))
    chart_title = determine_chart_title(message)
    x_key, y_keys = select_keys(columns, chart_type)

    suffix = "" if used_real_db else " (demo data)"
    return {
        "type":    "chart",
        "message": (
            f"Here is your **{chart_title}** chart "
            f"({chart_type}, **{len(data):,} rows**{suffix}). "
            "You can drag it to reposition or change the chart type using the controls."
        ),
        "suggestions": [],
        "intent":  intent.value,
        "sql":     sql,
        "data":    data,
        "columns": columns,
        "chart": {
            "title": chart_title,
            "type":  chart_type,
            "x_key": x_key,
            "y_key": y_keys[0] if y_keys else None,
        },
        "token_usage": {
            "query_tokens": query_tokens,
            "schema_tokens": _estimate_tokens(schema_context),
            "prompt_tokens": prompt_tokens,
            "sql_tokens": _estimate_tokens(sql),
            "total_estimated_tokens": prompt_tokens + _estimate_tokens(sql),
            "budget_tokens": token_budget,
            **_tu_extra,
        },
    }


def _inject_filters(sql: str, filters: dict, db_type: str) -> str:
    """Append simple date/branch/item filters to an existing SQL query."""
    if not filters:
        return sql

    clauses = []
    date_from = filters.get("date_from")
    date_to   = filters.get("date_to")
    branch    = filters.get("branch")
    item      = filters.get("item")

    if date_from:
        clauses.append(f"created_at >= '{date_from}'")
    if date_to:
        clauses.append(f"created_at <= '{date_to} 23:59:59'")
    if branch:
        clauses.append(f"branch = '{branch}'")
    if item:
        clauses.append(f"item_name ILIKE '%{item}%'")

    if not clauses:
        return sql

    upper = sql.strip().rstrip(";").upper()
    if "WHERE" in upper:
        return sql.strip().rstrip(";") + " AND " + " AND ".join(clauses)
    if "GROUP BY" in upper:
        idx = upper.index("GROUP BY")
        return sql[:idx] + " WHERE " + " AND ".join(clauses) + " " + sql[idx:]
    if "ORDER BY" in upper:
        idx = upper.index("ORDER BY")
        return sql[:idx] + " WHERE " + " AND ".join(clauses) + " " + sql[idx:]
    return sql.strip().rstrip(";") + " WHERE " + " AND ".join(clauses)


def _generate_info_response(message: str) -> str:
    return (
        "I'm InsightDash AI. I can help you create charts, analyze your business data, and build dashboards. "
        "Try commands like:\n"
        "• 'Create item wise sales chart'\n"
        "• 'Show top 10 products by revenue'\n"
        "• 'Create monthly purchase trend'\n"
        "• 'Show stock levels by category'"
    )
