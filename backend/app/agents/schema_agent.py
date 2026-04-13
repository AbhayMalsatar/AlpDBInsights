"""Schema agent - finds relevant tables using vector search."""
import logging
from typing import List, Optional
from app.services.vector_service import get_vector_service

logger = logging.getLogger(__name__)


def find_relevant_schema(query: str, database_id: str, top_k: int = 4) -> str:
    """
    Use vector search to find the most relevant table schemas.
    Returns formatted schema context string for LLM prompts.
    Only table/column names are returned - never actual data.
    """
    try:
        vector_service = get_vector_service()
        results = vector_service.search_relevant_tables(query, database_id, top_k=top_k)

        if not results:
            logger.warning(f"No schema results found for query: {query}")
            return ""

        schema_parts = []
        for result in results:
            schema_parts.append(result["content"])

        return "\n\n---\n\n".join(schema_parts)
    except Exception as e:
        logger.error(f"Schema search failed: {e}")
        return ""


def get_relevant_tables(query: str, database_id: str, top_k: int = 4) -> List[str]:
    """Returns list of relevant table names."""
    try:
        vector_service = get_vector_service()
        results = vector_service.search_relevant_tables(query, database_id, top_k=top_k)
        return [r["table_name"] for r in results]
    except Exception as e:
        logger.error(f"Failed to get relevant tables: {e}")
        return []
