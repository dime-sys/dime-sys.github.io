"""
DeliveryEngine — resolves subscriptions for a completed execution and
dispatches each matched sink in the same thread (non-blocking from the
caller's point of view via try/except: a delivery failure never fails
the main execution).
"""
import traceback
import uuid
from datetime import datetime
from typing import List, Optional

import pandas as pd

from app.db.output_store import ARTIFACTS_DB, DELIVERY_JOBS_DB, SUBSCRIPTIONS_DB
from .contracts import ArtifactResult, OutputContract
from .local_sink import LocalSink

# Ring buffer for recent dispatch errors (max 50) — visible via /admin/debug/errors
DISPATCH_ERRORS: list = []
_MAX_ERRORS = 50


def _log_error(context: str, exc: Exception) -> None:
    entry = {
        "ts": datetime.utcnow().isoformat(),
        "context": context,
        "error": str(exc),
        "traceback": traceback.format_exc(),
    }
    DISPATCH_ERRORS.append(entry)
    if len(DISPATCH_ERRORS) > _MAX_ERRORS:
        DISPATCH_ERRORS.pop(0)


def _build_sink(provider: str, config: dict):
    """Factory — returns a configured sink instance."""
    if provider == "local":
        return LocalSink(config)
    # Future: azure_blob, gcs, s3, webhook
    raise ValueError(f"Proveedor desconocido: {provider}")


def _matching_subscriptions(contract: OutputContract) -> List[dict]:
    """
    Return all active subscriptions whose scope matches the execution.

    Matching logic (most-specific wins, but we return ALL matches so
    every configured sink receives the data):
      - scope_type == "process"  → scope_id == contract.process_id
      - scope_type == "folder"   → scope_id is anywhere in contract.folder_path
                                   (supports any level, inherits downward)
      - scope_type == "global"   → always matches
    """
    matched = []
    for sub in SUBSCRIPTIONS_DB.values():
        if not sub.get("active", True):
            continue
        scope_type = sub.get("scope_type", "global")
        scope_id = sub.get("scope_id", "")

        if scope_type == "process" and scope_id == contract.process_id:
            matched.append(sub)
        elif scope_type == "folder" and scope_id and scope_id in (contract.folder_ids or []):
            matched.append(sub)
        elif scope_type == "global":
            matched.append(sub)
    return matched


def dispatch(contract: OutputContract, df: pd.DataFrame) -> Optional[dict]:
    """
    Called after a successful execution.  Finds matching subscriptions,
    writes through each sink, and records the job + artifacts.

    Returns the delivery_job dict (or None if nothing matched / on error).
    """
    try:
        subscriptions = _matching_subscriptions(contract)
        if not subscriptions:
            return None

        job_id = str(uuid.uuid4())
        job = {
            "id": job_id,
            "execution_id": contract.execution_id,
            "process_id": contract.process_id,
            "sheet_name": contract.sheet_name,
            "table_name": contract.table_name,
            "subscription_count": len(subscriptions),
            "status": "running",
            "started_at": datetime.utcnow().isoformat(),
            "finished_at": None,
            "error_count": 0,
            "artifact_ids": [],
        }
        DELIVERY_JOBS_DB.append(job)

        error_count = 0
        for sub in subscriptions:
            try:
                sink = _build_sink(sub["provider"], sub.get("config", {}))
                result: ArtifactResult = sink.write(contract, df)
            except Exception as exc:
                _log_error(f"sink={sub.get('provider')} sub={sub['id']}", exc)
                result = ArtifactResult(
                    sink_provider=sub.get("provider", "unknown"),
                    uri="",
                    row_count=0,
                    checksum="",
                    error=str(exc),
                )

            artifact_id = str(uuid.uuid4())
            artifact = {
                "id": artifact_id,
                "delivery_job_id": job_id,
                "execution_id": contract.execution_id,
                "subscription_id": sub["id"],
                "sink_provider": result.sink_provider,
                "uri": result.uri,
                "row_count": result.row_count,
                "checksum": result.checksum,
                "manifest": result.manifest,
                "status": "ok" if result.success else "error",
                "error": result.error,
                "written_at": datetime.utcnow().isoformat(),
            }
            ARTIFACTS_DB.append(artifact)
            job["artifact_ids"].append(artifact_id)
            if not result.success:
                error_count += 1

        job["error_count"] = error_count
        job["status"] = "completed" if error_count == 0 else "partial"
        job["finished_at"] = datetime.utcnow().isoformat()
        return job

    except Exception as exc:
        _log_error(f"dispatch outer — execution={contract.execution_id}", exc)
        return None


def dispatch_original(
    folder_path: List[str],
    folder_ids: List[str],
    process_id: str,
    process_name: str,
    timestamp: str,
    contents: bytes,
    filename: str,
) -> None:
    """
    Copy the raw uploaded file to the configured path of every matching
    local-sink subscription.  Errors are logged but never propagated.

    Written as: <base_path>/<folder_hierarchy>/<process_name>/uploads/<ts>/<filename>
    """
    import os
    from .local_sink import _safe

    # Build a minimal contract solely for subscription matching
    dummy = OutputContract(
        execution_id="",
        process_id=process_id,
        process_name=process_name,
        folder_id=folder_ids[-1] if folder_ids else None,
        folder_path=folder_path,
        folder_ids=folder_ids,
        sheet_name="",
        table_name="",
        columns=[],
        row_count=0,
        extraction_mode="range",
        timestamp=timestamp,
    )

    for sub in _matching_subscriptions(dummy):
        if sub.get("provider") != "local":
            continue
        try:
            sink = LocalSink(sub.get("config", {}))
            hierarchy = [_safe(p) for p in (folder_path or [])]
            ts_safe = timestamp[:19].replace("-", "").replace("T", "_").replace(":", "")
            upload_folder = os.path.join(
                sink.base_path,
                *hierarchy,
                _safe(process_name or process_id),
                ts_safe,
            )
            os.makedirs(upload_folder, exist_ok=True)
            with open(os.path.join(upload_folder, _safe(filename)), "wb") as fh:
                fh.write(contents)
        except Exception as exc:
            _log_error(f"dispatch_original sub={sub['id']} file={filename}", exc)
