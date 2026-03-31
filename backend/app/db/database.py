import json
import math
import os
import pickle
import threading
import time
from datetime import date, datetime, time as dt_time, timedelta
from typing import Any, Callable, Optional, TypeVar

import numpy as np
import pandas as pd
from sqlalchemy import JSON, DateTime, LargeBinary, String, create_engine, select
from sqlalchemy import text as sa_text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

T = TypeVar("T")

# ── DataFrame serialization marker ───────────────────────────────────────────
_DF_MARKER = "__dataframe__"
_PN_MARKER = "ProjectNode"


def _df_to_serializable(df: pd.DataFrame) -> dict:
	rows = []
	for _, row in df.iterrows():
		record: dict = {}
		for col in df.columns:
			val = row[col]
			try:
				is_na = pd.isna(val)
			except (TypeError, ValueError):
				is_na = False
			if is_na:
				record[str(col)] = None
			elif isinstance(val, pd.Timestamp):
				record[str(col)] = val.isoformat()
			elif isinstance(val, np.integer):
				record[str(col)] = int(val)
			elif isinstance(val, np.floating):
				f = float(val)
				record[str(col)] = None if math.isnan(f) else f
			elif isinstance(val, np.bool_):
				record[str(col)] = bool(val)
			else:
				record[str(col)] = val
		rows.append(record)
	return {_DF_MARKER: True, "columns": [str(c) for c in df.columns], "rows": rows}


def _project_node_to_dict(node) -> dict:
	"""Recursively convert a ProjectNode to a JSON-serializable dict."""
	return {
		"__type__": _PN_MARKER,
		"id": node.id,
		"name": node.name,
		"level": node.level,
		"parent_id": node.parent_id,
		"children": [_project_node_to_dict(c) for c in node.children],
		"files": node.files,
		"created_at": node.created_at,
	}


def _json_default(obj: Any) -> Any:
	"""Custom JSON serializer for non-standard types."""
	if isinstance(obj, pd.DataFrame):
		return _df_to_serializable(obj)
	if isinstance(obj, np.integer):
		return int(obj)
	if isinstance(obj, np.floating):
		f = float(obj)
		return None if math.isnan(f) else f
	if isinstance(obj, np.bool_):
		return bool(obj)
	if isinstance(obj, np.ndarray):
		return obj.tolist()
	if isinstance(obj, pd.Timestamp):
		return obj.isoformat()
	if isinstance(obj, (datetime, date)):
		return obj.isoformat()
	if isinstance(obj, dt_time):
		return obj.strftime("%H:%M:%S")
	if isinstance(obj, timedelta):
		return obj.total_seconds()
	if isinstance(obj, set):
		return sorted(obj)
	# Pydantic ProjectNode (lazy check to avoid circular import)
	try:
		from app.models.project import ProjectNode
		if isinstance(obj, ProjectNode):
			return _project_node_to_dict(obj)
	except ImportError:
		pass
	if hasattr(obj, "model_dump"):
		return obj.model_dump()
	raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def _reconstruct_obj(obj: Any) -> Any:
	"""Recursively reconstruct DataFrames and ProjectNodes from their serialized forms."""
	if isinstance(obj, dict):
		if obj.get("__type__") == _PN_MARKER:
			try:
				from app.models.project import ProjectNode
				children = [_reconstruct_obj(c) for c in obj.get("children", [])]
				data = {k: v for k, v in obj.items() if k not in ("__type__", "children")}
				return ProjectNode(**data, children=children)
			except Exception:
				pass
		if obj.get(_DF_MARKER):
			return pd.DataFrame(obj["rows"], columns=obj["columns"])
		return {k: _reconstruct_obj(v) for k, v in obj.items()}
	if isinstance(obj, list):
		return [_reconstruct_obj(item) for item in obj]
	return obj


# ── ORM models ────────────────────────────────────────────────────────────────

class Base(DeclarativeBase):
	pass


class AppState(Base):
	__tablename__ = "app_state"

	namespace: Mapped[str] = mapped_column(String(100), primary_key=True)
	payload: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)   # legacy pickle
	json_payload: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)       # readable JSON
	updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


# ── Engine setup ──────────────────────────────────────────────────────────────

def get_database_url() -> str:
	return os.getenv("DATABASE_URL", "sqlite:///./app_state.db")


def _create_engine():
	database_url = get_database_url()
	connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
	return create_engine(database_url, future=True, pool_pre_ping=True, connect_args=connect_args)


ENGINE = _create_engine()
SessionLocal = sessionmaker(bind=ENGINE, autoflush=False, autocommit=False, future=True)

_init_lock = threading.Lock()
_initialized = False


def _run_migrations() -> None:
	"""Idempotent schema migrations — safe to run on every startup."""
	if ENGINE.dialect.name == "postgresql":
		with ENGINE.connect() as conn:
			# Add json_payload column if it doesn't exist yet (for pre-existing instances)
			conn.execute(sa_text(
				"ALTER TABLE app_state ADD COLUMN IF NOT EXISTS json_payload JSON"
			))
			# Make legacy payload column nullable so we can clear it after migration
			conn.execute(sa_text(
				"ALTER TABLE app_state ALTER COLUMN payload DROP NOT NULL"
			))
			conn.commit()
	else:
		# SQLite: best-effort column add (no IF NOT EXISTS support)
		with ENGINE.connect() as conn:
			try:
				conn.execute(sa_text("ALTER TABLE app_state ADD COLUMN json_payload TEXT"))
				conn.commit()
			except Exception:
				conn.rollback()


def ensure_database(max_retries: int = 10, retry_delay: float = 1.0) -> None:
	global _initialized
	if _initialized:
		return

	with _init_lock:
		if _initialized:
			return

		last_error = None
		for attempt in range(max_retries):
			try:
				Base.metadata.create_all(ENGINE)
				_run_migrations()
				_initialized = True
				return
			except Exception as exc:
				last_error = exc
				if attempt == max_retries - 1:
					raise
				time.sleep(retry_delay)

		if last_error:
			raise last_error


# ── Public API ────────────────────────────────────────────────────────────────

def load_snapshot(namespace: str, default_factory: Callable[[], T]) -> T:
	ensure_database()
	with SessionLocal() as session:
		row = session.get(AppState, namespace)
		if not row:
			return default_factory()

		# Prefer JSON (new format)
		if row.json_payload is not None:
			return _reconstruct_obj(row.json_payload)

		# Fall back to pickle (legacy format) — migrate to JSON automatically
		if row.payload is not None:
			value = pickle.loads(row.payload)
			if ENGINE.dialect.name == "postgresql":
				save_snapshot(namespace, value)   # migrate in-place
			return value

		return default_factory()


def save_snapshot(namespace: str, value: T) -> None:
	ensure_database()
	now = datetime.utcnow()

	with SessionLocal() as session:
		row = session.get(AppState, namespace)

		if ENGINE.dialect.name == "postgresql":
			# Serialize to JSON string first (handles DataFrames, ProjectNodes, numpy, etc.)
			json_str = json.dumps(value, default=_json_default, ensure_ascii=False)
			json_obj = json.loads(json_str)   # back to plain Python — SQLAlchemy stores as JSON
			if row is None:
				row = AppState(namespace=namespace, payload=None, json_payload=json_obj, updated_at=now)
				session.add(row)
			else:
				row.json_payload = json_obj
				row.payload = None   # clear legacy blob
				row.updated_at = now
		else:
			# SQLite fallback: keep using pickle
			payload = pickle.dumps(value, protocol=pickle.HIGHEST_PROTOCOL)
			if row is None:
				row = AppState(namespace=namespace, payload=payload, json_payload=None, updated_at=now)
				session.add(row)
			else:
				row.payload = payload
				row.updated_at = now

		session.commit()


def state_exists(namespace: str) -> bool:
	ensure_database()
	with SessionLocal() as session:
		stmt = select(AppState.namespace).where(AppState.namespace == namespace)
		return session.execute(stmt).first() is not None
