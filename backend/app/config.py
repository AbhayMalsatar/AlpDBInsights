from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    app_name: str = "InsightDash AI"
    app_version: str = "1.0.0"
    debug: bool = True

    ai_provider: str = "mock"
    openai_api_key: str = ""
    anthropic_api_key: str = ""

    qdrant_host: str = "localhost"
    qdrant_port: int = 6333
    qdrant_collection: str = "insightdash_schemas"

    encryption_key: str = ""
    allowed_origins: str = "http://localhost:5173,http://localhost:3000"

    @property
    def cors_origins(self) -> List[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
