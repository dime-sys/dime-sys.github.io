from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class OutputContract:
    """Describes a single extracted table ready for delivery."""
    execution_id: str
    process_id: str
    process_name: str
    folder_id: Optional[str]        # leaf project-tree node id
    folder_path: List[str]          # ["Compañía", "Área", ..., "Proyecto"] — display names
    folder_ids: List[str]           # [root_id, ..., leaf_id]  — used for subscription matching
    sheet_name: str
    table_name: str
    columns: List[str]
    row_count: int
    extraction_mode: str            # range | headers_horizontal | headers_vertical
    timestamp: str                  # ISO-8601 UTC

    # Rule traceability
    rule_version_id: Optional[str] = None
    rule_version: Optional[int] = None
    rule_config: Optional[Dict[str, Any]] = field(default=None)

    # Process-level metadata (free-form, from upload form)
    process_metadata: Optional[Dict[str, Any]] = field(default=None)


@dataclass
class ArtifactResult:
    """Result returned by a Sink after writing."""
    sink_provider: str             # local | azure_blob | gcs | s3
    uri: str                       # path or URL of written artifact
    row_count: int
    checksum: str                  # md5 hex of raw bytes
    manifest: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None

    @property
    def success(self) -> bool:
        return self.error is None
