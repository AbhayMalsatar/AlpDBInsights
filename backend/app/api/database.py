from fastapi import APIRouter, HTTPException
from app.models.schemas import (
    DatabaseConnectRequest, DatabaseTestRequest, DatabaseConnectionStringRequest,
    QueryRequest, QueryResponse, DatabaseType, FullDatabaseSchema,
    TableHintsPutBody, TableIndexRequest, FineTuneRequest,
)
from app.services.schema_service import (
    test_connection, extract_full_schema,
)
from app.services.vector_service import get_vector_service
from app.services.schema_snapshot import save_schema_snapshot, schema_fingerprint
from app.services.table_hints_service import (
    build_schema_chunks_with_hints,
    delete_hints,
    hints_fingerprint,
    load_raw,
    merge_tables_into_doc,
    save_raw,
)
from app.services.schema_metadata import table_to_rag_document
from app.services.ai_service import (
    register_database, unregister_database, _database_registry, _save_registry,
)
from app.services.fine_tuning_service import (
    get_fine_tune_state,
    refresh_fine_tune_state,
    start_fine_tune,
)
import uuid
from datetime import datetime
import logging

router = APIRouter(prefix="/database", tags=["database"])
logger = logging.getLogger(__name__)


@router.post("/test")
async def test_database_connection(request: DatabaseTestRequest):
    success, message = test_connection(
        request.type, request.host, request.port,
        request.username, request.password, request.database,
    )
    return {"success": success, "message": message}


@router.post("/connect-string")
async def connect_database_from_string(request: DatabaseConnectionStringRequest):
    """
    Connect using a pasted URI (PostgreSQL) or ADO-style key=value string (SQL Server).
    """
    from app.services.connection_string_parser import parse_connection_string

    parsed = parse_connection_string(request.connection_string)
    if not parsed:
        raise HTTPException(
            status_code=400,
            detail=(
                "Could not parse connection string. Supported: "
                "postgres:// or postgresql://user:pass@host:port/dbname , "
                "jdbc:postgresql://host:port/dbname , "
                "or SQL Server Server=host,1433;Database=...;User Id=...;Password=..."
            ),
        )
    form = DatabaseConnectRequest(
        type=parsed.type,
        host=parsed.host,
        port=parsed.port,
        username=parsed.username,
        password=parsed.password,
        database=parsed.database,
        name=(request.name or "").strip() or parsed.database,
    )
    return await connect_database(form)


@router.post("/connect")
async def connect_database(request: DatabaseConnectRequest):
    # 1. Test connectivity
    success, message = test_connection(
        request.type, request.host, request.port,
        request.username, request.password, request.database,
    )
    if not success:
        raise HTTPException(status_code=400, detail=f"Connection failed: {message}")

    # 2. Extract full schema
    try:
        full = extract_full_schema(
            request.type, request.host, request.port,
            request.username, request.password, request.database,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Schema extraction failed: {str(e)}")

    db_id = str(uuid.uuid4())[:9]

    # 3. Skip vector indexing for now. Frontend will ask user to pick tables first.

    fp = schema_fingerprint(full.tables)
    try:
        save_schema_snapshot(db_id, full.tables)
    except Exception as e:
        logger.warning(f"Schema snapshot failed (non-critical): {e}")

    # 4. Persist in registry
    register_database(db_id, {
        "type":     request.type.value,
        "host":     request.host,
        "port":     request.port,
        "username": request.username,
        "password": request.password,
        "database": request.database,
        "schema_fingerprint": fp,
        "hints_fingerprint": hints_fingerprint({}),
        "selected_tables": [],
        "fine_tune": get_fine_tune_state(db_id),
    })

    return {
        "db_id":        db_id,
        "id":           db_id,
        "name":         request.name or request.database,
        "type":         request.type.value,
        "host":         request.host,
        "port":         request.port,
        "username":     request.username,
        "database":     request.database,
        "connected":    True,
        "created_at":   datetime.utcnow().isoformat(),
        "tables_count": len(full.tables),
        "views_count":  len(full.views),
        "procedures_count": len(full.procedures),
        # Full schema objects
        "tables":     [t.model_dump() for t in full.tables],
        "views":      [v.model_dump() for v in full.views],
        "procedures": [p.model_dump() for p in full.procedures],
        "selected_tables": [],
        "fine_tune": get_fine_tune_state(db_id),
    }


@router.post("/{db_id}/index-tables")
async def index_selected_tables(db_id: str, body: TableIndexRequest):
    """Reindex only selected tables for this database."""
    if db_id not in _database_registry:
        raise HTTPException(status_code=404, detail="Database not found — please reconnect.")

    from app.services.schema_snapshot import load_schema_snapshot

    selected = [t for t in body.table_names if t and isinstance(t, str)]
    selected_set = set(selected)

    snap = load_schema_snapshot(db_id)
    if not snap:
        raise HTTPException(status_code=400, detail="Schema snapshot missing. Please refresh schema first.")

    tables_to_index = [t for t in snap if t.table_name in selected_set]

    try:
        vector_service = get_vector_service()
        vector_service.delete_database_chunks(db_id)
        if tables_to_index:
            chunks = build_schema_chunks_with_hints(db_id, tables_to_index)
            vector_service.store_schema_chunks(db_id, chunks)
        else:
            chunks = []
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Vector indexing failed: {e}")

    cfg = dict(_database_registry[db_id])
    cfg["selected_tables"] = selected
    _database_registry[db_id] = cfg
    _save_registry()

    return {
        "ok": True,
        "indexed_tables": [t.table_name for t in tables_to_index],
        "indexed_count": len(tables_to_index),
        "selected_count": len(selected),
    }


@router.get("/{db_id}/table-hints")
async def get_table_hints(db_id: str):
    """
    Curator hints (descriptions + segment rules) and a compact tables overview from snapshot
    for building UI forms without re-querying the live DB.
    """
    if db_id not in _database_registry:
        raise HTTPException(status_code=404, detail="Database not found — please reconnect.")
    from app.services.schema_snapshot import load_schema_snapshot

    snap = load_schema_snapshot(db_id)
    overview = []
    if snap:
        for t in snap:
            overview.append({
                "table_name": t.table_name,
                "column_count": len(t.columns),
                "columns": [c.name for c in t.columns[:120]],
                "row_count": getattr(t, "row_count", None),
            })
    return {
        "db_id": db_id,
        "hints": load_raw(db_id),
        "tables_overview": overview,
    }


@router.put("/{db_id}/table-hints")
async def put_table_hints(db_id: str, body: TableHintsPutBody):
    """Merge table hints and re-embed only affected tables for vector search."""
    if db_id not in _database_registry:
        raise HTTPException(status_code=404, detail="Database not found — please reconnect.")
    from app.services.schema_snapshot import load_schema_snapshot

    existing = load_raw(db_id)
    incoming = {k: v.model_dump(mode="json") for k, v in body.tables.items()}
    merged = merge_tables_into_doc(existing, incoming)
    save_raw(db_id, merged)
    hp = hints_fingerprint(merged.get("tables") or {})
    cfg = dict(_database_registry[db_id])
    cfg["hints_fingerprint"] = hp
    _database_registry[db_id] = cfg
    _save_registry()

    chunks: list[dict[str, str]] = []
    snap = load_schema_snapshot(db_id)
    touched = set(incoming.keys())
    if snap:
        by_name = {t.table_name: t for t in snap}
        hints_tbl = merged.get("tables") or {}
        for name in touched:
            if name not in by_name:
                continue
            hint = hints_tbl.get(name)
            chunks.append(
                {
                    "table_name": name,
                    "content": table_to_rag_document(by_name[name], hint),
                }
            )
    if chunks:
        try:
            get_vector_service().store_schema_chunks(db_id, chunks)
        except Exception as e:
            logger.warning(f"Vector reindex after hints failed: {e}")

    auto_fine_tune = refresh_fine_tune_state(db_id, force=False)
    try:
        if touched and auto_fine_tune.get("enabled"):
            auto_fine_tune = start_fine_tune(db_id, table_names=sorted(touched), auto=True)
        elif touched and not auto_fine_tune.get("enabled"):
            auto_fine_tune["message"] = "Auto fine-tune is unavailable until OpenAI provider and API key are configured."
    except Exception as e:
        logger.warning(f"Auto fine-tune skipped for {db_id}: {e}")
        auto_fine_tune = refresh_fine_tune_state(db_id, force=False)
        auto_fine_tune["message"] = str(e)

    return {
        "ok": True,
        "hints_fingerprint": hp,
        "reindexed_tables": [c["table_name"] for c in chunks],
        "auto_fine_tune": auto_fine_tune,
    }


@router.get("/{db_id}/fine-tune-status")
async def get_fine_tune_status(db_id: str):
    if db_id not in _database_registry:
        raise HTTPException(status_code=404, detail="Database not found — please reconnect.")
    return refresh_fine_tune_state(db_id, force=False)


@router.post("/{db_id}/fine-tune")
async def trigger_fine_tune(db_id: str, body: FineTuneRequest):
    if db_id not in _database_registry:
        raise HTTPException(status_code=404, detail="Database not found — please reconnect.")
    try:
        state = start_fine_tune(
            db_id,
            table_names=body.table_names or None,
            auto=body.auto,
        )
        return state
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fine-tuning failed to start: {e}")


@router.get("/{db_id}/schema")
async def get_schema(db_id: str):
    """Return full schema (tables, views, procedures) for a connected database."""
    db_config = _database_registry.get(db_id)
    if not db_config:
        raise HTTPException(status_code=404, detail="Database not found — please reconnect.")

    try:
        full = extract_full_schema(
            DatabaseType(db_config["type"]),
            db_config["host"], db_config["port"],
            db_config["username"], db_config["password"],
            db_config["database"],
        )
        return {
            "tables":     [t.model_dump() for t in full.tables],
            "views":      [v.model_dump() for v in full.views],
            "procedures": [p.model_dump() for p in full.procedures],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{db_id}/query", response_model=QueryResponse)
async def execute_query(db_id: str, request: QueryRequest):
    db_config = _database_registry.get(db_id)
    if not db_config:
        raise HTTPException(status_code=404, detail="Database not found")

    from app.services.query_service import execute_query as run_query
    try:
        result = run_query(
            db_type   = DatabaseType(db_config["type"]),
            host      = db_config["host"],
            port      = db_config["port"],
            username  = db_config["username"],
            password  = db_config["password"],
            database  = db_config["database"],
            sql       = request.sql,
            limit     = request.limit,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


@router.delete("/{db_id}")
async def disconnect_database(db_id: str):
    unregister_database(db_id)
    delete_hints(db_id)
    try:
        get_vector_service().delete_database_chunks(db_id)
    except Exception:
        pass
    return {"success": True}
