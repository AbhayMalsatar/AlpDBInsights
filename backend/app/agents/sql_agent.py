"""SQL generation agent - generates safe SELECT SQL from natural language."""
import logging
import re
from typing import Optional
from app.config import settings
from app.services.fine_tuning_service import resolve_openai_model

logger = logging.getLogger(__name__)

SQL_PROMPT_TEMPLATE = """You are an expert SQL analyst. Generate a safe, optimized SQL SELECT query for a business chart.

Database Schema (use ONLY these tables and columns):
{schema}

User Request: {query}

STRICT RULES:
1. Generate ONLY a SELECT statement — never DROP, DELETE, UPDATE, INSERT, ALTER, CREATE, TRUNCATE.
2. NEVER show raw ID columns (e.g. order_id, product_id, customer_id) in the final SELECT output.
   - Instead JOIN the related table and use the human-readable name column.
   - Example: instead of "product_id", JOIN products and SELECT product_name.
   - Example: instead of "customer_id", JOIN customers and SELECT company_name or contact_name.
   - Example: instead of "order_id", JOIN orders and show order date or customer name.
3. Always use descriptive column aliases (e.g. AS total_revenue, AS product_name, AS order_month).
4. For aggregations (SUM, COUNT, AVG) always GROUP BY the name column, not the ID column.
5. For time-series queries use DATE_TRUNC('month', date_col) for PostgreSQL or CONVERT(date, ...) for SQL Server.
6. Always ORDER BY the most meaningful column (usually the metric DESC or date ASC).
7. Limit to {limit} rows maximum.
8. For charts with categories, return at most 20–25 rows so the chart is readable.

DATABASE TYPE: {db_type}

Respond with ONLY the SQL query — no explanation, no markdown code fences, no comments.
"""

SQL_REPAIR_PROMPT_TEMPLATE = """You are an expert SQL repair assistant.

Fix the SQL query using the database error and the allowed schema.

Allowed Schema (use ONLY these tables and columns):
{schema}

Original User Request: {query}

Broken SQL:
{sql}

Database Error:
{error}

STRICT RULES:
1. Return ONLY one corrected SELECT query.
2. Use only tables and columns from the allowed schema.
3. Fix invalid tables, invalid columns, wrong joins, ambiguous aliases, and SQL syntax errors.
4. Keep the query intent the same as the original user request.
5. Never return explanations, markdown, comments, or multiple statements.

DATABASE TYPE: {db_type}
"""


def generate_sql_with_llm(query: str, schema_context: str, db_type: str = "postgresql",
                           limit: int = 500, db_id: Optional[str] = None) -> Optional[str]:
    """
    Generate SQL using configured LLM provider.
    Always falls back to rule-based SQL if the LLM is unavailable or returns nothing.
    """
    prompt = SQL_PROMPT_TEMPLATE.format(
        schema=schema_context,
        query=query,
        limit=limit,
        db_type=db_type.upper(),
    )

    provider = settings.ai_provider.lower()
    sql: Optional[str] = None

    if provider == "openai" and settings.openai_api_key:
        sql = _call_openai(prompt, db_id=db_id)
        if not sql:
            logger.warning("[sql_agent] OpenAI returned nothing — falling back to rule-based SQL")
    elif provider == "anthropic" and settings.anthropic_api_key:
        sql = _call_anthropic(prompt)
        if not sql:
            logger.warning("[sql_agent] Anthropic returned nothing — falling back to rule-based SQL")

    # Always fall back to rule-based if LLM gave nothing
    if not sql:
        sql = _generate_rule_based_sql(query, schema_context, db_type, limit)

    return sql


def repair_sql_with_llm(
    query: str,
    broken_sql: str,
    error_message: str,
    schema_context: str,
    db_type: str = "postgresql",
    db_id: Optional[str] = None,
) -> Optional[str]:
    prompt = SQL_REPAIR_PROMPT_TEMPLATE.format(
        schema=schema_context,
        query=query,
        sql=broken_sql,
        error=error_message,
        db_type=db_type.upper(),
    )

    provider = settings.ai_provider.lower()
    repaired: Optional[str] = None

    if provider == "openai" and settings.openai_api_key:
        repaired = _call_openai(prompt, db_id=db_id)
    elif provider == "anthropic" and settings.anthropic_api_key:
        repaired = _call_anthropic(prompt)

    return repaired


def _call_openai(prompt: str, db_id: Optional[str] = None) -> Optional[str]:
    try:
        from openai import OpenAI
    except ImportError:
        logger.error("[sql_agent] openai package not installed. Run: pip install openai")
        return None
    try:
        client = OpenAI(api_key=settings.openai_api_key)
        model = resolve_openai_model(db_id, settings.openai_model)
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=600,
        )
        sql = response.choices[0].message.content or ""
        logger.info(f"[sql_agent] OpenAI model=%s responded: %s…", model, sql[:80])
        return _clean_sql(sql)
    except Exception as e:
        logger.error(f"[sql_agent] OpenAI API error: {type(e).__name__}: {e}")
        return None


def _call_anthropic(prompt: str) -> Optional[str]:
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        message = client.messages.create(
            model="claude-3-5-haiku-20241022",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )
        sql = message.content[0].text if message.content else ""
        return _clean_sql(sql)
    except Exception as e:
        logger.error(f"Anthropic call failed: {e}")
        return None


def _clean_sql(sql: str) -> str:
    """Remove markdown code blocks and whitespace."""
    sql = re.sub(r'```sql\s*', '', sql, flags=re.IGNORECASE)
    sql = re.sub(r'```\s*', '', sql)
    return sql.strip()


def _generate_rule_based_sql(query: str, schema_context: str, db_type: str, limit: int) -> str:
    """Fallback rule-based SQL generation when LLM is not configured."""
    lower = query.lower()
    tables = _extract_tables_from_schema(schema_context)

    if not tables:
        return f"SELECT * FROM sales LIMIT {limit}"

    primary_table = tables[0]

    # Sales item-wise
    if 'sales' in lower and ('item' in lower or 'product' in lower):
        if 'items' in tables:
            return f"""SELECT i.name as item_name, SUM(s.quantity) as total_quantity, SUM(s.price * s.quantity) as revenue
FROM sales s
JOIN items i ON s.item_id = i.id
GROUP BY i.name
ORDER BY revenue DESC
LIMIT {limit}"""

    # Monthly trend
    if any(w in lower for w in ['monthly', 'month', 'trend', 'over time']):
        date_trunc = "DATE_TRUNC('month', created_at)" if db_type == 'postgresql' else "DATEADD(month, DATEDIFF(month, 0, created_at), 0)"
        return f"""SELECT {date_trunc} as month, COUNT(*) as total_orders, SUM(quantity * price) as revenue
FROM {primary_table}
GROUP BY month
ORDER BY month
LIMIT {limit}"""

    # Top N
    top_match = re.search(r'top\s+(\d+)', lower)
    if top_match:
        n = int(top_match.group(1))
        if 'items' in tables and 'sales' in tables:
            return f"""SELECT i.name as product, SUM(s.quantity) as total_sold, SUM(s.price * s.quantity) as revenue
FROM sales s
JOIN items i ON s.item_id = i.id
GROUP BY i.name
ORDER BY revenue DESC
LIMIT {n}"""

    # Stock
    if 'stock' in lower or 'inventory' in lower:
        if 'items' in tables:
            return f"""SELECT name as item, category, stock as current_stock
FROM items
ORDER BY stock ASC
LIMIT {limit}"""

    # Purchase
    if 'purchase' in lower:
        return f"""SELECT * FROM purchases ORDER BY created_at DESC LIMIT {limit}"""

    # Generic aggregate
    return f"""SELECT * FROM {primary_table} ORDER BY 1 LIMIT {limit}"""


def _extract_tables_from_schema(schema_context: str) -> list[str]:
    tables = re.findall(r'Table:\s*(\w+)', schema_context)
    return tables
