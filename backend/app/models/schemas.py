from pydantic import BaseModel, Field
from typing import Optional, List, Any, Dict, Literal
from datetime import datetime
from enum import Enum


class DatabaseType(str, Enum):
    postgresql = "postgresql"
    mssql = "mssql"


class DatabaseConnectRequest(BaseModel):
    name: str
    type: DatabaseType
    host: str
    port: int
    username: str
    password: str
    database: str


class DatabaseTestRequest(BaseModel):
    type: DatabaseType
    host: str
    port: int
    username: str
    password: str
    database: str


class DatabaseConnectionStringRequest(BaseModel):
    """Paste postgresql://... , jdbc:postgresql://... , or SQL Server key=value connection string."""
    connection_string: str = Field(..., min_length=1)
    name: str = Field(default="", description="Optional display name; defaults to database name")


class ColumnSchema(BaseModel):
    name: str
    data_type: str
    nullable: bool = True
    primary_key: bool = False
    foreign_key: Optional[str] = None
    indexed: bool = False


class TableSchema(BaseModel):
    table_name: str
    columns: List[ColumnSchema]
    row_count: Optional[int] = None


class ViewSchema(BaseModel):
    view_name: str
    columns: List[ColumnSchema]


class ProcedureSchema(BaseModel):
    name: str
    type: str = "PROCEDURE"   # PROCEDURE | FUNCTION
    return_type: Optional[str] = None
    parameters: str = ""


class FullDatabaseSchema(BaseModel):
    tables:     List[TableSchema]     = Field(default_factory=list)
    views:      List[ViewSchema]      = Field(default_factory=list)
    procedures: List[ProcedureSchema] = Field(default_factory=list)


class TableSegmentRule(BaseModel):
    """Maps a logical slice of a physical table (e.g. IrType = SR → sales return)."""
    label: str = Field(..., description="Display name, e.g. Sales return")
    column: str = Field(default="", description="Discriminator column, e.g. IrType")
    values: List[str] = Field(default_factory=list, description="Values for IN (...), e.g. SR, S")
    where_sql: Optional[str] = Field(
        default=None,
        description="Optional explicit SQL predicate instead of column+values",
    )


class TableHintDoc(BaseModel):
    description: str = Field(default="", description="When to use this table / how rows are mixed")
    segments: List[TableSegmentRule] = Field(default_factory=list)
    approx_row_count: Optional[int] = None


class TableHintsPutBody(BaseModel):
    """Replace or merge entries for the given table names (others unchanged)."""
    tables: Dict[str, TableHintDoc] = Field(default_factory=dict)


class DatabaseConnectResponse(BaseModel):
    model_config = {"populate_by_name": True}

    id: str
    name: str
    type: DatabaseType
    host: str
    port: int
    username: str
    database: str
    connected: bool
    schema_tables: List[TableSchema]     = Field(alias="schema",      default_factory=list)
    views:         List[ViewSchema]      = Field(default_factory=list)
    procedures:    List[ProcedureSchema] = Field(default_factory=list)
    created_at: str


class QueryRequest(BaseModel):
    sql: str
    limit: int = Field(default=1000, le=10000)


class QueryResponse(BaseModel):
    columns: List[str]
    rows: List[Dict[str, Any]]
    row_count: int
    execution_time_ms: float


class ChartType(str, Enum):
    bar = "bar"
    line = "line"
    pie = "pie"
    area = "area"
    scatter = "scatter"
    table = "table"
    kpi = "kpi"


class GridLayout(BaseModel):
    i: str
    x: int
    y: int
    w: int
    h: int
    min_w: int = 3
    min_h: int = 2


class ChartConfig(BaseModel):
    id: str
    title: str
    type: ChartType
    sql: str
    data: List[Dict[str, Any]]
    x_key: Optional[str] = None
    y_keys: Optional[List[str]] = None
    color: Optional[str] = None
    database_id: str
    created_at: str
    layout: GridLayout


class FilterConfig(BaseModel):
    id: str
    name: str
    type: Literal["date_range", "select", "multi_select", "text"]
    column: str
    table: str
    database_id: str
    value: Optional[Any] = None
    options: Optional[List[str]] = None


class AIIntent(str, Enum):
    create_chart = "create_chart"
    modify_chart = "modify_chart"
    delete_chart = "delete_chart"
    create_tab = "create_tab"
    add_filter = "add_filter"
    info = "info"
    unknown = "unknown"


class AIChatRequest(BaseModel):
    message: str
    tab_id: str
    database_id: Optional[str] = None
    filters: Optional[List[FilterConfig]] = None
    existing_charts: Optional[List[ChartConfig]] = None


class AIChatResponse(BaseModel):
    message: str
    intent: str
    charts: Optional[List[ChartConfig]] = None
    action: Optional[str] = None
    tab_id: Optional[str] = None
    error: Optional[str] = None


class SchemaChunk(BaseModel):
    chunk_id: str
    database_id: str
    table_name: str
    content: str
    embedding: Optional[List[float]] = None
