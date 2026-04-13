import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.api import database, ai

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Re-index all registered databases into vector store on startup."""
    try:
        from app.services.ai_service import _database_registry
        from app.services.schema_service import extract_schema
        from app.services.vector_service import get_vector_service
        from app.models.schemas import DatabaseType
        from app.services.schema_snapshot import save_schema_snapshot, schema_fingerprint
        from app.services.table_hints_service import (
            build_schema_chunks_with_hints,
            hints_fingerprint,
            load_raw,
        )
        from app.services.ai_service import _save_registry

        if _database_registry:
            vector_service = get_vector_service()
            logger.info(f"Re-indexing {len(_database_registry)} database(s) on startup…")
            for db_id, cfg in _database_registry.items():
                try:
                    tables = extract_schema(
                        DatabaseType(cfg["type"]),
                        cfg["host"], cfg["port"],
                        cfg["username"], cfg["password"],
                        cfg["database"],
                    )
                    chunks = build_schema_chunks_with_hints(db_id, tables)
                    vector_service.store_schema_chunks(db_id, chunks)
                    save_schema_snapshot(db_id, tables)
                    cfg["schema_fingerprint"] = schema_fingerprint(tables)
                    cfg["hints_fingerprint"] = hints_fingerprint(load_raw(db_id).get("tables") or {})
                    _database_registry[db_id] = cfg
                    logger.info(f"  ✓ Re-indexed {db_id} ({len(chunks)} tables)")
                except Exception as e:
                    logger.warning(f"  ✗ Could not re-index {db_id}: {e}")
            _save_registry()
    except Exception as e:
        logger.warning(f"Startup re-index failed (non-critical): {e}")

    yield  # app runs here


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="AI-powered business dashboard platform API",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(database.router, prefix="/api")
app.include_router(ai.router, prefix="/api")


@app.get("/health")
async def health():
    from app.services.ai_service import _database_registry
    return {
        "status": "healthy",
        "version": settings.app_version,
        "ai_provider": settings.ai_provider,
        "registered_databases": list(_database_registry.keys()),
    }


@app.get("/")
async def root():
    return {"message": f"Welcome to {settings.app_name} API", "docs": "/docs"}
