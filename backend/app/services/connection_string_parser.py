"""
Parse PostgreSQL URLs and common SQL Server connection strings into connect fields.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Optional
from urllib.parse import parse_qs, unquote, urlparse

from app.models.schemas import DatabaseType

logger = logging.getLogger(__name__)


@dataclass
class ParsedConnection:
    type: DatabaseType
    host: str
    port: int
    username: str
    password: str
    database: str


def _parse_server_host_port(server_val: str) -> tuple[str, int]:
    """SQL Server Server= value: host,1433 | tcp:host,1433 | (local) | host\\instance."""
    s = server_val.strip().strip('"').strip("'")
    default_port = 1433
    if s.lower().startswith("tcp:"):
        s = s[4:].strip()
    if "," in s and not s.count("\\"):
        host_part, _, port_part = s.rpartition(",")
        host = host_part.strip()
        try:
            return host, int(port_part.strip())
        except ValueError:
            return host_part.strip(), default_port
    if "\\" in s:
        return s.split("\\")[0].strip() or "localhost", default_port
    if s in (".", "(local)", "(localdb)", "localhost"):
        return "localhost", default_port
    return s or "localhost", default_port


def _parse_mssql_key_value(conn: str) -> Optional[ParsedConnection]:
    """ADO.NET style: Server=...;Database=...;User Id=...;Password=..."""
    text = conn.strip().strip('"').strip("'")
    if ";" not in text or "=" not in text:
        return None
    low = text.lower()
    if "server=" not in low and "data source=" not in low:
        return None

    kv: dict[str, str] = {}
    for part in text.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        k, _, v = part.partition("=")
        key = k.strip().lower()
        kv[key] = v.strip().strip('"').strip("'")

    server_raw = kv.get("server") or kv.get("data source") or ""
    if not server_raw:
        return None

    host, port = _parse_server_host_port(server_raw)
    database = (
        kv.get("database")
        or kv.get("initial catalog")
        or kv.get("dbname")
        or ""
    )
    username = (
        kv.get("user id")
        or kv.get("userid")
        or kv.get("uid")
        or kv.get("user")
        or ""
    )
    password = kv.get("password") or kv.get("pwd") or ""

    if not database or not username:
        return None

    return ParsedConnection(
        type=DatabaseType.mssql,
        host=host,
        port=port,
        username=username,
        password=password,
        database=database,
    )


def _parse_postgres_url(conn: str) -> Optional[ParsedConnection]:
    """postgresql://user:pass@host:5432/dbname — also jdbc:postgresql://... normalized upstream."""
    u = urlparse(conn.strip())
    if u.scheme not in ("postgresql", "postgres"):
        return None
    host = u.hostname or "localhost"
    port = u.port or 5432
    username = unquote(u.username or "")
    password = unquote(u.password or "")
    if u.query and (not username or not password):
        qs = parse_qs(u.query, keep_blank_values=True)
        if not username:
            for k in ("user", "username", "uid"):
                if k in qs and qs[k][0]:
                    username = qs[k][0]
                    break
        if not password:
            for k in ("password", "pwd"):
                if k in qs and qs[k][0]:
                    password = qs[k][0]
                    break
    path = (u.path or "").lstrip("/")
    database = path.split("?", 1)[0] if path else ""
    if not database:
        return None
    return ParsedConnection(
        type=DatabaseType.postgresql,
        host=host,
        port=port,
        username=username,
        password=password,
        database=database,
    )


def parse_connection_string(raw: str) -> Optional[ParsedConnection]:
    """
    Supported:
    - postgres:// or postgresql:// URI (password may be URL-encoded)
    - jdbc:postgresql://host:port/db (optional ?user=&password=)
    - Server=...;Database=...;User Id=...;Password=... (SQL Server)
    """
    s = raw.strip().strip('"').strip("'")
    if not s:
        return None

    low = s.lower()
    if low.startswith("jdbc:postgresql://") or low.startswith("jdbc:postgres://"):
        rest = s.split("://", 1)[1]
        s = "postgresql://" + rest
        low = s.lower()

    if re.match(r"^(postgres|postgresql)://", low):
        return _parse_postgres_url(s)

    parsed_mssql = _parse_mssql_key_value(s)
    if parsed_mssql:
        return parsed_mssql

    logger.debug("[connstr] Unrecognized connection string shape")
    return None
