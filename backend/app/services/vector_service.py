"""Vector database service for schema storage and semantic search using Qdrant."""
import logging
import uuid
import hashlib
from typing import List, Optional

logger = logging.getLogger(__name__)

try:
    from qdrant_client import QdrantClient
    from qdrant_client.models import (
        Distance, VectorParams, PointStruct, Filter,
        FieldCondition, MatchValue
    )
    QDRANT_AVAILABLE = True
except ImportError:
    QDRANT_AVAILABLE = False
    logger.warning("qdrant-client not installed. Vector search unavailable.")

try:
    from sentence_transformers import SentenceTransformer
    _embedding_model: Optional[object] = None
    ST_AVAILABLE = True
except ImportError:
    ST_AVAILABLE = False
    logger.warning("sentence-transformers not installed.")


def get_embedding_model():
    global _embedding_model
    if not ST_AVAILABLE:
        return None
    if _embedding_model is None:
        _embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
    return _embedding_model


class VectorService:
    COLLECTION = "insightdash_schemas"
    VECTOR_DIM = 384  # all-MiniLM-L6-v2 output dimension

    def __init__(self, host: str = "localhost", port: int = 6333):
        self.client = None
        if QDRANT_AVAILABLE:
            try:
                self.client = QdrantClient(host=host, port=port, timeout=5)
                self._ensure_collection()
                logger.info("Qdrant connected successfully.")
            except Exception as e:
                logger.warning(f"Qdrant unavailable: {e}. Falling back to in-memory search.")
                self.client = None

        # In-memory fallback
        self._memory_store: List[dict] = []

    def _ensure_collection(self):
        if not self.client:
            return
        existing = [c.name for c in self.client.get_collections().collections]
        if self.COLLECTION not in existing:
            self.client.create_collection(
                collection_name=self.COLLECTION,
                vectors_config=VectorParams(size=self.VECTOR_DIM, distance=Distance.COSINE),
            )

    def _embed(self, text: str) -> List[float]:
        model = get_embedding_model()
        if model is None:
            # Return dummy embedding for testing
            h = hashlib.md5(text.encode()).digest()
            return [b / 255.0 for b in h] * (self.VECTOR_DIM // 16)
        return model.encode(text).tolist()  # type: ignore

    def store_schema_chunks(self, database_id: str, chunks: List[dict]):
        """Store schema text chunks with embeddings."""
        points = []
        for chunk in chunks:
            chunk_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{database_id}:{chunk['table_name']}"))
            embedding = self._embed(chunk['content'])

            if self.client:
                points.append(PointStruct(
                    id=chunk_id,
                    vector=embedding,
                    payload={
                        "database_id": database_id,
                        "table_name": chunk['table_name'],
                        "content": chunk['content'],
                    }
                ))
            else:
                self._memory_store.append({
                    "id": chunk_id,
                    "database_id": database_id,
                    "table_name": chunk['table_name'],
                    "content": chunk['content'],
                    "embedding": embedding,
                })

        if self.client and points:
            self.client.upsert(collection_name=self.COLLECTION, points=points)

    def search_relevant_tables(self, query: str, database_id: str, top_k: int = 4) -> List[dict]:
        """Find the most relevant tables for a query."""
        query_embedding = self._embed(query)

        if self.client:
            results = self.client.search(
                collection_name=self.COLLECTION,
                query_vector=query_embedding,
                limit=top_k,
                query_filter=Filter(
                    must=[FieldCondition(key="database_id", match=MatchValue(value=database_id))]
                ),
            )
            return [
                {"table_name": r.payload["table_name"], "content": r.payload["content"], "score": r.score}
                for r in results
            ]
        else:
            # Cosine similarity in memory
            def cosine_sim(a: List[float], b: List[float]) -> float:
                dot = sum(x * y for x, y in zip(a, b))
                mag_a = sum(x * x for x in a) ** 0.5
                mag_b = sum(x * x for x in b) ** 0.5
                return dot / (mag_a * mag_b + 1e-9)

            scored = [
                {**item, "score": cosine_sim(query_embedding, item["embedding"])}
                for item in self._memory_store
                if item["database_id"] == database_id
            ]
            scored.sort(key=lambda x: x["score"], reverse=True)
            return [{"table_name": s["table_name"], "content": s["content"], "score": s["score"]}
                    for s in scored[:top_k]]

    def delete_database_chunks(self, database_id: str):
        """Remove all chunks for a database."""
        if self.client:
            self.client.delete(
                collection_name=self.COLLECTION,
                points_selector=Filter(
                    must=[FieldCondition(key="database_id", match=MatchValue(value=database_id))]
                ),
            )
        else:
            self._memory_store = [
                item for item in self._memory_store if item["database_id"] != database_id
            ]


_vector_service: Optional[VectorService] = None


def get_vector_service() -> VectorService:
    global _vector_service
    if _vector_service is None:
        _vector_service = VectorService()
    return _vector_service
