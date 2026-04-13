from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from app.services.ai_service import process_chat_v2, get_database_config
from app.agents.intent_agent import detect_intent
import logging

router = APIRouter(prefix="/ai", tags=["ai"])
logger = logging.getLogger(__name__)


class ChatRequest(BaseModel):
    message: str
    db_id: Optional[str] = None
    tab_id: Optional[str] = None
    filters: Optional[Dict[str, Any]] = None
    schema_context: Optional[str] = None   # schema text sent from frontend


class ChatResponse(BaseModel):
    message: str
    intent: Optional[str] = None
    sql: Optional[str] = None
    data: Optional[List[Dict[str, Any]]] = None
    columns: Optional[List[str]] = None
    chart: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    type: Optional[str] = None
    suggestions: Optional[List[str]] = None
    token_usage: Optional[Dict[str, Any]] = None


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    try:
        return await process_chat_v2(request)
    except Exception as e:
        logger.error(f"AI chat error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/detect-intent")
async def detect_intent_endpoint(body: dict):
    message = body.get("message", "")
    intent, confidence = detect_intent(message)
    return {"intent": intent.value, "confidence": confidence}


@router.post("/generate-sql")
async def generate_sql_endpoint(body: dict):
    from app.agents.sql_agent import generate_sql_with_llm
    prompt = body.get("prompt", "")
    schema = body.get("schemaContext", "")
    sql = generate_sql_with_llm(prompt, schema)
    return {"sql": sql or "SELECT 1"}


# ── Auto-Dashboard ────────────────────────────────────────────────

class AutoDashboardRequest(BaseModel):
    db_id: str
    schema_context: str


@router.post("/auto-dashboard")
async def auto_dashboard(request: AutoDashboardRequest):
    """
    Analyze the database schema and generate a complete multi-tab dashboard
    with real data from the connected database.
    """
    from app.agents.dashboard_planner import (
        plan_dashboard_with_llm, build_rule_based_plan, execute_dashboard_plan,
    )

    db_config = get_database_config(request.db_id)
    if not db_config:
        raise HTTPException(status_code=404, detail="Database not found. Please reconnect.")

    db_type = db_config.get("type", "postgresql")

    try:
        # Step 1: Plan with LLM (falls back to rule-based if no API key)
        plan = plan_dashboard_with_llm(request.schema_context, db_type)
        if not plan:
            logger.info("[auto-dashboard] Using rule-based plan")
            plan = build_rule_based_plan(request.schema_context, db_type)

        # Step 2: Execute each SQL and attach real data
        result = await execute_dashboard_plan(plan, db_config)

        return result
    except Exception as e:
        logger.error(f"Auto-dashboard error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
