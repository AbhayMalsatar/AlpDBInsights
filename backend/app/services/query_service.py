"""Safe query execution service - SELECT only."""
import time
import logging
import re
from typing import Any, Dict, List
from sqlalchemy import create_engine, text
from app.models.schemas import DatabaseType, QueryResponse
from app.services.schema_service import build_connection_string

logger = logging.getLogger(__name__)

# SQL keywords that could be destructive
BLOCKED_KEYWORDS = re.compile(
    r'\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT|ALTER|CREATE|EXEC|EXECUTE|'
    r'GRANT|REVOKE|MERGE|REPLACE|CALL|LOAD|IMPORT|EXPORT|COPY)\b',
    re.IGNORECASE
)


def validate_query(sql: str) -> tuple[bool, str]:
    """Ensure only SELECT queries are allowed."""
    sql_clean = sql.strip()

    # Must start with SELECT
    if not re.match(r'^\s*SELECT\b', sql_clean, re.IGNORECASE):
        return False, "Only SELECT queries are allowed."

    # Block dangerous keywords
    match = BLOCKED_KEYWORDS.search(sql_clean)
    if match:
        return False, f"Query contains blocked keyword: {match.group()}"

    # Block multiple statements
    if sql_clean.rstrip(';').count(';') > 0:
        return False, "Multiple statements are not allowed."

    return True, "Query is valid."


def execute_query(
    db_type: DatabaseType,
    host: str,
    port: int,
    username: str,
    password: str,
    database: str,
    sql: str,
    limit: int = 1000,
) -> QueryResponse:
    is_valid, reason = validate_query(sql)
    if not is_valid:
        raise ValueError(reason)

    # Enforce row limit with DB-specific syntax.
    safe_sql = _apply_db_row_limit(sql, db_type, limit)

    conn_str = build_connection_string(db_type, host, port, username, password, database)
    engine = create_engine(conn_str)

    start = time.time()
    with engine.connect() as conn:
        result = conn.execute(text(safe_sql))
        columns = list(result.keys())
        rows: List[Dict[str, Any]] = [
            {col: _serialize(val) for col, val in zip(columns, row)}
            for row in result.fetchall()
        ]
    elapsed_ms = (time.time() - start) * 1000

    return QueryResponse(
        columns=columns,
        rows=rows,
        row_count=len(rows),
        execution_time_ms=round(elapsed_ms, 2),
    )


def _serialize(value: Any) -> Any:
    """Make query result values JSON-serializable."""
    if value is None:
        return None
    if hasattr(value, 'isoformat'):
        return value.isoformat()
    if isinstance(value, (int, float, str, bool)):
        return value
    return str(value)


def _apply_db_row_limit(sql: str, db_type: DatabaseType, default_limit: int) -> str:
    """
    Apply/normalize row limiting syntax by database type.
    - PostgreSQL: ensure trailing LIMIT when no row cap exists.
    - SQL Server: convert trailing LIMIT to TOP and inject TOP when absent.
    """
    base_sql = sql.strip().rstrip(';')
    sql_no_limit, explicit_limit = _strip_trailing_limit(base_sql)
    row_cap = explicit_limit or default_limit

    if db_type == DatabaseType.mssql:
        if _has_mssql_row_cap(sql_no_limit):
            return sql_no_limit
        return _inject_top_clause(sql_no_limit, row_cap)

    if _has_postgres_row_cap(base_sql):
        return base_sql
    return f"{base_sql} LIMIT {default_limit}"


def _strip_trailing_limit(sql: str) -> tuple[str, int | None]:
    match = re.search(r"\s+LIMIT\s+(\d+)\s*$", sql, re.IGNORECASE)
    if not match:
        return sql, None
    return sql[:match.start()].rstrip(), int(match.group(1))


def _inject_top_clause(sql: str, limit: int) -> str:
    """
    Insert TOP N right after SELECT (or SELECT DISTINCT).
    Falls back to original SQL when it cannot safely inject.
    """
    match = re.match(r"^\s*SELECT\s+(DISTINCT\s+)?", sql, re.IGNORECASE)
    if not match:
        return sql
    return f"{sql[:match.end()]}TOP {limit} {sql[match.end():]}"


def _has_postgres_row_cap(sql: str) -> bool:
    return bool(
        re.search(r"\bLIMIT\s+\d+\b", sql, re.IGNORECASE)
        or re.search(r"\bFETCH\s+FIRST\s+\d+\s+ROWS\s+ONLY\b", sql, re.IGNORECASE)
    )


def _has_mssql_row_cap(sql: str) -> bool:
    return bool(
        re.search(r"^\s*SELECT\s+TOP\s+\d+\b", sql, re.IGNORECASE)
        or re.search(r"^\s*SELECT\s+DISTINCT\s+TOP\s+\d+\b", sql, re.IGNORECASE)
        or re.search(r"\bOFFSET\s+\d+\s+ROWS\s+FETCH\s+NEXT\s+\d+\s+ROWS\s+ONLY\b", sql, re.IGNORECASE)
    )
