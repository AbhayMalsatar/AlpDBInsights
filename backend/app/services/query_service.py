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

    # Enforce row limit
    safe_sql = sql.rstrip().rstrip(';')
    if not re.search(r'\bLIMIT\b', safe_sql, re.IGNORECASE):
        safe_sql = f"{safe_sql} LIMIT {limit}"

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
