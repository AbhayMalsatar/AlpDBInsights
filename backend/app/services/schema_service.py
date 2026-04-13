"""Extracts full database schema: tables, views, stored procedures."""
import logging
from typing import List, Optional
from sqlalchemy import create_engine, inspect, text
from app.models.schemas import (
    TableSchema, ColumnSchema, DatabaseType,
    ViewSchema, ProcedureSchema, FullDatabaseSchema,
)

logger = logging.getLogger(__name__)


def build_connection_string(db_type: DatabaseType, host: str, port: int,
                             username: str, password: str, database: str) -> str:
    if db_type == DatabaseType.postgresql:
        return f"postgresql+psycopg2://{username}:{password}@{host}:{port}/{database}"
    elif db_type == DatabaseType.mssql:
        return (
            f"mssql+pyodbc://{username}:{password}@{host}:{port}/{database}"
            "?driver=ODBC+Driver+18+for+SQL+Server&TrustServerCertificate=yes"
        )
    raise ValueError(f"Unsupported database type: {db_type}")


def test_connection(db_type: DatabaseType, host: str, port: int,
                    username: str, password: str, database: str) -> tuple[bool, str]:
    try:
        conn_str = build_connection_string(db_type, host, port, username, password, database)
        engine = create_engine(conn_str, connect_args={"connect_timeout": 5})
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True, "Connection successful"
    except Exception as e:
        logger.error(f"Connection test failed: {e}")
        return False, str(e)


# ── Tables ────────────────────────────────────────────────────────────────────

def extract_tables(engine, db_type: DatabaseType) -> List[TableSchema]:
    inspector = inspect(engine)
    tables: List[TableSchema] = []

    for table_name in inspector.get_table_names():
        try:
            columns_info   = inspector.get_columns(table_name)
            pk_constraint  = inspector.get_pk_constraint(table_name)
            fk_constraints = inspector.get_foreign_keys(table_name)
            indexes        = inspector.get_indexes(table_name)

            pk_cols = set(pk_constraint.get("constrained_columns", []))
            fk_map: dict[str, str] = {}
            for fk in fk_constraints:
                for local_col, ref_col in zip(
                    fk["constrained_columns"], fk["referred_columns"]
                ):
                    fk_map[local_col] = f"{fk['referred_table']}.{ref_col}"

            indexed_cols = {col for idx in indexes for col in idx.get("column_names", [])}

            columns = [
                ColumnSchema(
                    name        = col["name"],
                    data_type   = str(col["type"]),
                    nullable    = col.get("nullable", True),
                    primary_key = col["name"] in pk_cols,
                    foreign_key = fk_map.get(col["name"]),
                    indexed     = col["name"] in indexed_cols,
                )
                for col in columns_info
            ]

            row_count: Optional[int] = None
            try:
                with engine.connect() as conn:
                    result = conn.execute(
                        text(f'SELECT COUNT(*) FROM "{table_name}"')
                        if db_type == DatabaseType.postgresql
                        else text(f"SELECT COUNT(*) FROM [{table_name}]")
                    )
                    row_count = result.scalar()
            except Exception:
                pass

            tables.append(TableSchema(
                table_name = table_name,
                columns    = columns,
                row_count  = row_count,
            ))
        except Exception as e:
            logger.warning(f"Could not inspect table {table_name}: {e}")

    return tables


# ── Views ─────────────────────────────────────────────────────────────────────

def extract_views(engine, db_type: DatabaseType) -> List[ViewSchema]:
    inspector = inspect(engine)
    views: List[ViewSchema] = []

    for view_name in inspector.get_view_names():
        try:
            columns_info = inspector.get_columns(view_name)
            columns = [
                ColumnSchema(
                    name      = col["name"],
                    data_type = str(col["type"]),
                    nullable  = col.get("nullable", True),
                )
                for col in columns_info
            ]
            views.append(ViewSchema(view_name=view_name, columns=columns))
        except Exception as e:
            logger.warning(f"Could not inspect view {view_name}: {e}")

    return views


# ── Stored Procedures / Functions ────────────────────────────────────────────

def extract_procedures(engine, db_type: DatabaseType) -> List[ProcedureSchema]:
    procedures: List[ProcedureSchema] = []

    try:
        with engine.connect() as conn:
            if db_type == DatabaseType.postgresql:
                sql = text("""
                    SELECT
                        r.routine_name,
                        r.routine_type,
                        r.data_type        AS return_type,
                        string_agg(
                            p.parameter_name || ' ' || p.data_type,
                            ', ' ORDER BY p.ordinal_position
                        ) AS parameters
                    FROM information_schema.routines r
                    LEFT JOIN information_schema.parameters p
                        ON  p.specific_name   = r.specific_name
                        AND p.specific_schema = r.routine_schema
                        AND p.parameter_mode IN ('IN','INOUT')
                    WHERE r.routine_schema NOT IN ('pg_catalog','information_schema')
                    GROUP BY r.routine_name, r.routine_type, r.data_type
                    ORDER BY r.routine_name
                """)
            else:  # MSSQL
                sql = text("""
                    SELECT
                        p.name         AS routine_name,
                        p.type_desc    AS routine_type,
                        NULL           AS return_type,
                        STRING_AGG(
                            pm.name + ' ' + TYPE_NAME(pm.user_type_id),
                            ', '
                        ) WITHIN GROUP (ORDER BY pm.parameter_id) AS parameters
                    FROM sys.procedures p
                    LEFT JOIN sys.parameters pm ON pm.object_id = p.object_id
                        AND pm.parameter_id > 0
                    GROUP BY p.name, p.type_desc
                    ORDER BY p.name
                """)

            rows = conn.execute(sql).fetchall()
            for row in rows:
                procedures.append(ProcedureSchema(
                    name        = row[0],
                    type        = (row[1] or "FUNCTION").upper(),
                    return_type = row[2],
                    parameters  = row[3] or "",
                ))
    except Exception as e:
        logger.warning(f"Could not extract procedures: {e}")

    return procedures


# ── Full schema extraction ────────────────────────────────────────────────────

def extract_schema(db_type: DatabaseType, host: str, port: int,
                   username: str, password: str, database: str) -> List[TableSchema]:
    """Backwards-compatible: returns just tables."""
    return extract_full_schema(db_type, host, port, username, password, database).tables


def extract_full_schema(db_type: DatabaseType, host: str, port: int,
                         username: str, password: str, database: str) -> FullDatabaseSchema:
    """Extracts tables, views, and stored procedures."""
    conn_str = build_connection_string(db_type, host, port, username, password, database)
    engine   = create_engine(conn_str)

    tables     = extract_tables(engine, db_type)
    views      = extract_views(engine, db_type)
    procedures = extract_procedures(engine, db_type)

    logger.info(
        f"Extracted schema: {len(tables)} tables, "
        f"{len(views)} views, {len(procedures)} procedures"
    )
    return FullDatabaseSchema(tables=tables, views=views, procedures=procedures)


# ── Text helpers for LLM context ─────────────────────────────────────────────

def schema_to_text(table: TableSchema) -> str:
    lines = [f"Table: {table.table_name}"]
    lines.append("Columns:")
    for col in table.columns:
        flags = []
        if col.primary_key: flags.append("PRIMARY KEY")
        if col.foreign_key: flags.append(f"FK -> {col.foreign_key}")
        if col.indexed:     flags.append("INDEXED")
        if not col.nullable: flags.append("NOT NULL")
        flag_str = f" [{', '.join(flags)}]" if flags else ""
        lines.append(f"  - {col.name} ({col.data_type}){flag_str}")
    if table.row_count is not None:
        lines.append(f"Approximate rows: {table.row_count:,}")
    return "\n".join(lines)
