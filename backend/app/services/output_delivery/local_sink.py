import hashlib
import json
import os
import re
from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd

from .base_sink import BaseSink
from .contracts import ArtifactResult, OutputContract

_SCL = ZoneInfo("America/Santiago")


def _safe(name: str) -> str:
    """Sanitize a string so it can be used as a directory component."""
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", str(name)).strip(". ") or "_"


class LocalSink(BaseSink):
    """
    Writes the DataFrame as a Parquet file + manifest.json to local disk.

    Output structure
    ----------------
    <base_path>/
      <folder_path[0]>/           ← project-tree hierarchy
        <folder_path[1]>/
          ...
            <process_name>/
              <YYYYMMDD_HHMMSS>/  ← second-precision execution timestamp (America/Santiago)
                manifest.json     ← one manifest per execution, accumulates all tables
                <sheet_name>/
                  <table_name>/
                    <table_name>.parquet
    """

    provider = "local"

    def __init__(self, config: dict):
        self.base_path = config.get("base_path") or os.path.join(
            os.path.dirname(__file__), "../../../output_delivery"
        )

    def write(self, contract: OutputContract, df: pd.DataFrame) -> ArtifactResult:
        try:
            # ── Build execution-level directory ───────────────────────────
            hierarchy = [_safe(p) for p in (contract.folder_path or [])]
            ts_raw = contract.timestamp or datetime.now(_SCL).isoformat(timespec="seconds")
            # "2026-03-24T14:30:22..." → "20260324_143022"
            exec_ts = ts_raw[:19].replace("-", "").replace("T", "_").replace(":", "")

            exec_folder = os.path.join(
                self.base_path,
                *hierarchy,
                _safe(contract.process_name or contract.process_id),
                exec_ts,
            )

            # ── Table-level directory ─────────────────────────────────────
            table_folder = os.path.join(
                exec_folder,
                _safe(contract.sheet_name),
                _safe(contract.table_name),
            )
            os.makedirs(table_folder, exist_ok=True)

            # ── Write Parquet ─────────────────────────────────────────────
            parquet_name = f"{_safe(contract.table_name)}.parquet"
            parquet_path = os.path.join(table_folder, parquet_name)

            # Sanitize: object columns with mixed types cause pyarrow failures.
            df_clean = df.copy()
            for col in df_clean.columns:
                if df_clean[col].dtype == object:
                    df_clean[col] = df_clean[col].astype(str).replace({"nan": None, "<NA>": None})

            df_clean.to_parquet(parquet_path, index=False, engine="pyarrow")

            with open(parquet_path, "rb") as fh:
                checksum = hashlib.md5(fh.read()).hexdigest()

            # ── Accumulate manifest at execution-folder level ─────────────
            # Relative path from execution folder so the manifest is portable.
            rel_parquet = os.path.join(
                _safe(contract.sheet_name), _safe(contract.table_name), parquet_name
            )
            table_entry = {
                "sheet_name": contract.sheet_name,
                "table_name": contract.table_name,
                "rule": {
                    "version_id": contract.rule_version_id,
                    "version": contract.rule_version,
                    "extraction_mode": contract.extraction_mode,
                    "config": contract.rule_config or {},
                },
                "schema": {
                    "columns": contract.columns,
                    "row_count": contract.row_count,
                },
                "artifact": {
                    "parquet_file": rel_parquet,
                    "checksum_md5": checksum,
                },
            }

            manifest_path = os.path.join(exec_folder, "manifest.json")
            now_iso = datetime.now(_SCL).isoformat(timespec="seconds")

            if os.path.exists(manifest_path):
                with open(manifest_path, "r", encoding="utf-8") as fh:
                    manifest = json.load(fh)
                # Remove any previous entry for the same sheet+table (idempotent re-runs)
                manifest["tables"] = [
                    t for t in manifest.get("tables", [])
                    if not (t["sheet_name"] == contract.sheet_name
                            and t["table_name"] == contract.table_name)
                ]
                manifest["tables"].append(table_entry)
                manifest["updated_at"] = now_iso
            else:
                manifest = {
                    "execution_id": contract.execution_id,
                    "execution_timestamp": exec_ts,
                    "process": {
                        "id": contract.process_id,
                        "name": contract.process_name,
                        "metadata": contract.process_metadata or {},
                    },
                    "folder_path": contract.folder_path,
                    "tables": [table_entry],
                    "created_at": now_iso,
                    "updated_at": now_iso,
                }

            with open(manifest_path, "w", encoding="utf-8") as fh:
                json.dump(manifest, fh, indent=2, ensure_ascii=False)

            return ArtifactResult(
                sink_provider=self.provider,
                uri=parquet_path,
                row_count=contract.row_count,
                checksum=checksum,
                manifest=manifest,
            )

        except Exception as exc:
            return ArtifactResult(
                sink_provider=self.provider,
                uri="",
                row_count=0,
                checksum="",
                error=str(exc),
            )
