from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query, Header
from typing import Optional
import os
import re
import pandas as pd
import uuid
import json
from io import BytesIO
from datetime import datetime
from zoneinfo import ZoneInfo
from app.services.processor import apply_rules
from app.db.database import load_snapshot, save_snapshot


def _col_index_to_letter(n: int) -> str:
    """Convert 0-based column index to Excel letter(s): 0→A, 25→Z, 26→AA, 51→AZ..."""
    result = ""
    n += 1
    while n > 0:
        n, r = divmod(n - 1, 26)
        result = chr(65 + r) + result
    return result


def _rename_cols_to_excel_letters(df: pd.DataFrame) -> pd.DataFrame:
    """Return a copy of df with columns renamed to A, B, C, D... (0-based index)."""
    df = df.copy()
    df.columns = [_col_index_to_letter(i) for i in range(len(df.columns))]
    return df


_DIAS_MAP = {
    0: "lunes", 1: "martes", 2: "miercoles", 3: "jueves",
    4: "viernes", 5: "sabado", 6: "domingo",
}


def _normalized_schedule_ranges(schedule: dict):
    """Return normalized list of ranges [{hora_inicio, hora_fin}] sorted by start."""
    if not schedule:
        return []

    raw_ranges = schedule.get("rangos")
    if isinstance(raw_ranges, list) and raw_ranges:
        source = raw_ranges
    else:
        source = [{
            "hora_inicio": schedule.get("hora_inicio", "00:00"),
            "hora_fin": schedule.get("hora_fin", "23:59"),
        }]

    normalized = []
    for r in source:
        try:
            h_ini = (r or {}).get("hora_inicio", "00:00")
            h_fin = (r or {}).get("hora_fin", "23:59")
            ini_h, ini_m = [int(x) for x in str(h_ini).split(":")]
            fin_h, fin_m = [int(x) for x in str(h_fin).split(":")]
            start_minutes = ini_h * 60 + ini_m
            end_minutes = fin_h * 60 + fin_m
            if end_minutes <= start_minutes:
                continue
            normalized.append({
                "hora_inicio": f"{ini_h:02d}:{ini_m:02d}",
                "hora_fin": f"{fin_h:02d}:{fin_m:02d}",
                "_start_minutes": start_minutes,
            })
        except Exception:
            continue

    normalized.sort(key=lambda x: x["_start_minutes"])
    for r in normalized:
        r.pop("_start_minutes", None)
    return normalized


def _normalize_schedule_payload(schedule: Optional[dict]) -> Optional[dict]:
    if not schedule:
        return None
    normalized = dict(schedule)
    ranges = _normalized_schedule_ranges(normalized)
    if not ranges:
        ranges = [{"hora_inicio": "08:00", "hora_fin": "10:00"}]
    normalized["rangos"] = ranges
    normalized["hora_inicio"] = ranges[0]["hora_inicio"]
    normalized["hora_fin"] = ranges[-1]["hora_fin"]
    return normalized


def _check_commitment_alert(record: dict) -> Optional[str]:
    """Return 'vencido' if today's commitment window has passed without an upload."""
    schedule = record.get("commitment_schedule")
    if not schedule or not schedule.get("activo"):
        return None
    try:
        now = datetime.now(_SCL)
        windows = _commitment_windows_for_datetime(schedule, now)
        if not windows:
            return None
        fin_dt = max(end_dt for _, end_dt in windows)
        if now <= fin_dt:
            return None
        # If the commitment was configured today AFTER the window already ended,
        # don't penalize — the first real evaluation starts tomorrow.
        set_at_str = record.get("commitment_schedule_set_at")
        if set_at_str:
            try:
                set_at = datetime.fromisoformat(set_at_str)
                if set_at.tzinfo is None:
                    set_at = set_at.replace(tzinfo=_SCL)
                if set_at.astimezone(_SCL).date() == now.date() and set_at.astimezone(_SCL) >= fin_dt:
                    return None
            except Exception:
                pass
        # Window has ended — check if there was an upload today
        today_date = now.date()
        for e in reversed(record.get("executions", [])):
            ts = e.get("timestamp")
            if not ts:
                continue
            exec_dt = datetime.fromisoformat(ts)
            if exec_dt.tzinfo is None:
                exec_dt = exec_dt.replace(tzinfo=_SCL)
            exec_dt_local = exec_dt.astimezone(_SCL)
            # Only counts as fulfilled if uploaded WITHIN the commitment window
            if exec_dt_local.date() == today_date and _commitment_state_for_upload(schedule, exec_dt_local) == "on_time" and e.get("status") != "error_formato":
                return None
        return "vencido"
    except Exception:
        return None

def _commitment_windows_for_datetime(schedule: dict, when_dt: datetime):
    """Return list[(start_dt, end_dt)] for applicable ranges on the given date."""
    if not schedule or not schedule.get("activo"):
        return []
    try:
        tipo = schedule.get("tipo", "diario")
        dias = schedule.get("dias", []) or []
        today_name = _DIAS_MAP[when_dt.weekday()]
        if tipo != "diario" and today_name not in dias:
            return []

        ranges = _normalized_schedule_ranges(schedule)
        windows = []
        for r in ranges:
            ini_h, ini_m = [int(x) for x in r["hora_inicio"].split(":")]
            fin_h, fin_m = [int(x) for x in r["hora_fin"].split(":")]
            start_dt = when_dt.replace(hour=ini_h, minute=ini_m, second=0, microsecond=0)
            end_dt = when_dt.replace(hour=fin_h, minute=fin_m, second=0, microsecond=0)
            windows.append((start_dt, end_dt))
        return windows
    except Exception:
        return []

def _commitment_state_for_upload(schedule: dict, upload_dt: datetime) -> str:
    """Return on_time | late | n_a for the given upload timestamp."""
    windows = _commitment_windows_for_datetime(schedule, upload_dt)
    if not windows:
        return "n_a"
    if any(start_dt <= upload_dt <= end_dt for start_dt, end_dt in windows):
        return "on_time"
    return "late"

router = APIRouter()

FILES_NAMESPACE = "files"
FILES_DB = load_snapshot(FILES_NAMESPACE, dict)
DEFAULT_EXECUTION_USER = "user_x"
_SCL = ZoneInfo("America/Santiago")


def save_files_state() -> None:
    save_snapshot(FILES_NAMESPACE, FILES_DB)


def _now_scl() -> str:
    """Return current datetime as ISO string in America/Santiago timezone."""
    return datetime.now(_SCL).isoformat(timespec="seconds")


_OUTPUT_DELIVERY_BASE = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "../../../output_delivery")
)


def _safe_path(name: str) -> str:
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", str(name)).strip(". ") or "_"


def _save_original_file(
    contents: bytes, filename: str, process_name: str, project_id: str, timestamp: str
) -> None:
    """Write the raw uploaded bytes to output_delivery/.../uploads/<ts>/<filename>."""
    try:
        from app.routes.rules import _get_folder_path
        hierarchy = [_safe_path(p) for p in (_get_folder_path(project_id) or [])]
        ts_safe = timestamp[:19].replace("-", "").replace("T", "_").replace(":", "")
        upload_folder = os.path.join(
            _OUTPUT_DELIVERY_BASE, *hierarchy, _safe_path(process_name), "uploads", ts_safe
        )
        os.makedirs(upload_folder, exist_ok=True)
        with open(os.path.join(upload_folder, _safe_path(filename)), "wb") as fh:
            fh.write(contents)
    except Exception as exc:
        print(f"[upload] Warning: could not save original file: {exc}")


def _resolve_username(authorization: Optional[str]) -> str:
    """Extract username from Bearer token; fall back to DEFAULT_EXECUTION_USER."""
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
        from app.db.user_store import SESSIONS_DB, USERS_DB
        uid = SESSIONS_DB.get(token)
        if uid:
            user = USERS_DB.get(uid)
            if user:
                return user["username"]
    return DEFAULT_EXECUTION_USER


def _normalize_process_name(value: Optional[str]) -> str:
    return (value or "").strip().lower()


def _process_name_exists_in_project(process_name: str, project_id: Optional[str], exclude_process_id: Optional[str] = None) -> bool:
    target = _normalize_process_name(process_name)
    if not target:
        return False

    for pid, rec in FILES_DB.items():
        if exclude_process_id and pid == exclude_process_id:
            continue
        if rec.get("project_id") != project_id:
            continue
        existing = _normalize_process_name(rec.get("process_name") or rec.get("latest_input_name"))
        if existing == target:
            return True
    return False

def validate_project_allows_files(project_id: str) -> bool:
    """Allow uploads on any existing project node."""
    try:
        from app.routes.projects import find_node_by_id
        
        node = find_node_by_id(project_id)
        if not node:
            return False

        return True
    except Exception:
        return False


def get_project_name(project_id: Optional[str]) -> Optional[str]:
    if not project_id:
        return None

    try:
        from app.routes.projects import find_node_by_id

        node = find_node_by_id(project_id)
        return node.name if node else None
    except Exception:
        return None


def serialize_preview(df: pd.DataFrame, max_rows: int = 10):
    preview = []
    for row_idx, (_, row) in enumerate(df.head(max_rows).iterrows()):
        row_dict = {"_row": row_idx + 1}
        for col in df.columns:
            val = row[col]
            if pd.isna(val):
                row_dict[col] = None
            elif isinstance(val, (pd.Timestamp, datetime)):
                row_dict[col] = str(val)
            elif hasattr(val, "isoformat"):
                row_dict[col] = val.isoformat()
            else:
                row_dict[col] = str(val) if not isinstance(val, (str, int, float, bool)) else val
        preview.append(row_dict)
    return preview


def build_process_response(process_id: str, record: dict):
    active_rule = next(
        (rule for rule in record.get("rule_versions", []) if rule.get("id") == record.get("current_rule_version_id")),
        None,
    )
    raw_executions = record.get("executions", [])
    last_executions = [
        {
            "id": e.get("id"),
            "timestamp": e.get("timestamp"),
            "status": e.get("status", "success"),
            "sheet_name": e.get("sheet_name"),
            "error_sheets": [
                output.get("sheet_name")
                for output in e.get("outputs", [])
                if output.get("status") in {"error", "error_formato"}
            ],
            "rule_version": e.get("rule_version"),
            "latest_input_name": e.get("latest_input_name"),
            "uploaded_by": e.get("uploaded_by", DEFAULT_EXECUTION_USER),
        }
        for e in raw_executions[-10:]
    ]
    return {
        "id": process_id,
        "file_name": record.get("process_name") or record.get("latest_input_name"),
        "process_name": record.get("process_name") or record.get("latest_input_name"),
        "latest_input_name": record.get("latest_input_name"),
        "timestamp": record.get("updated_at") or record.get("created_at"),
        "metadata": record.get("metadata", {}),
        "project_id": record.get("project_id"),
        "project_name": get_project_name(record.get("project_id")),
        "rule_versions_count": len(record.get("rule_versions", [])),
        "executions_count": len(raw_executions),
        "current_rule_version_id": record.get("current_rule_version_id"),
        "current_rule_version": active_rule.get("version") if active_rule else None,
        "input_mode": record.get("input_mode", "manual_upload"),
        "last_executions": last_executions,
        "sheet_names": record.get("sheet_names", []),
        "enabled_sheet_names": record.get("enabled_sheet_names", record.get("sheet_names", [])),
        "commitment_schedule": record.get("commitment_schedule"),
        "commitment_alert": _check_commitment_alert(record),
        "commitment_history": record.get("commitment_history", []),
        "commitment_schedule_set_at": record.get("commitment_schedule_set_at"),
    }


def ensure_process(process_id: str):
    record = FILES_DB.get(process_id)
    if not record:
        raise HTTPException(status_code=404, detail="Proceso no encontrado")
    return record


def append_execution_record(process_record: dict, execution: dict):
    process_record.setdefault("executions", []).append(execution)
    try:
        from app.routes.rules import EXECUTIONS_DB, save_executions_state
        EXECUTIONS_DB.append(execution)
        save_executions_state()
    except Exception:
        pass
    save_files_state()


@router.post("/")
async def upload_file(
    file: UploadFile = File(...),
    metadata: Optional[str] = Form(None),
    project_id: Optional[str] = Form(None),
    process_id: Optional[str] = Form(None),
    nombre_del_proceso: Optional[str] = Form(None),
    commitment_schedule: Optional[str] = Form(None),
    authorization: Optional[str] = Header(None),
):
    try:
        # Read file contents
        contents = await file.read()
        
        if not contents:
            raise HTTPException(status_code=400, detail="El archivo está vacío")
        
        # Validate project if provided
        if project_id:
            if not validate_project_allows_files(project_id):
                raise HTTPException(
                    status_code=400,
                    detail="La carpeta seleccionada no existe o no es válida para cargar archivos."
                )

        # Enforce role-based upload restrictions
        if authorization and authorization.startswith("Bearer "):
            from app.db.user_store import SESSIONS_DB, USERS_DB
            token = authorization[7:]
            uid = SESSIONS_DB.get(token)
            if uid:
                actor = USERS_DB.get(uid)
                if actor and actor["role"] == "responsable":
                    assigned = actor.get("assigned_project_ids", [])
                    if project_id and project_id not in assigned:
                        raise HTTPException(
                            status_code=403,
                            detail="No tienes permiso para cargar archivos en esta carpeta"
                        )
        
        # Try to read workbook and keep all sheets (raw: no header transform)
        try:
            raw_wb = pd.read_excel(BytesIO(contents), sheet_name=None, header=None)
            if not raw_wb:
                raise ValueError("El archivo no contiene hojas")
            workbook = {name: _rename_cols_to_excel_letters(shdf) for name, shdf in raw_wb.items()}
            sheet_names = list(workbook.keys())
            default_sheet = sheet_names[0]
            df = workbook[default_sheet]
        except Exception as e:
            print(f"Excel read error: {str(e)}")
            raise HTTPException(status_code=400, detail=f"No se pudo leer el archivo Excel. Asegúrate que sea un archivo válido (.xlsx, .xls): {str(e)}")

        # Parse metadata if provided
        parsed_metadata = {}
        if metadata:
            try:
                parsed_metadata = json.loads(metadata)
            except (json.JSONDecodeError, TypeError) as e:
                print(f"Metadata parse error: {str(e)}")
                # Continue without metadata if it's malformed

        now = _now_scl()
        # Enrich metadata with upload context
        uploaded_by_user = _resolve_username(authorization)
        parsed_metadata["uploaded_by"] = uploaded_by_user
        parsed_metadata["uploaded_at"] = now
        if nombre_del_proceso and nombre_del_proceso.strip():
            parsed_metadata["nombre_del_proceso"] = nombre_del_proceso.strip()

        parsed_commitment = None
        if commitment_schedule:
            try:
                parsed_commitment = _normalize_schedule_payload(json.loads(commitment_schedule))
            except (json.JSONDecodeError, TypeError):
                pass

        if process_id and process_id in FILES_DB:
            record = FILES_DB[process_id]
            _save_original_file(
                contents, file.filename,
                record.get("process_name") or file.filename,
                project_id or record.get("project_id"),
                now,
            )
            record["latest_input_name"] = file.filename
            record["current_data"] = df
            record["sheet_data"] = workbook
            record["sheet_names"] = sheet_names
            record["current_sheet_name"] = default_sheet
            previous_enabled = set(record.get("enabled_sheet_names", []))
            if previous_enabled:
                record["enabled_sheet_names"] = [s for s in sheet_names if s in previous_enabled]
            else:
                record["enabled_sheet_names"] = list(sheet_names)
            record["updated_at"] = now
            if parsed_metadata:
                record["metadata"] = parsed_metadata
            if parsed_commitment is not None:
                record["commitment_schedule"] = parsed_commitment
                if "commitment_schedule_set_at" not in record and parsed_commitment.get("activo"):
                    record["commitment_schedule_set_at"] = now
            if project_id:
                record["project_id"] = project_id
            save_files_state()

            return {
                "file_id": process_id,
                "process_id": process_id,
                "file_name": record.get("process_name") or file.filename,
                "latest_input_name": file.filename,
                "timestamp": record["updated_at"],
                "metadata": record.get("metadata", {}),
                "project_id": record.get("project_id"),
                "sheet_names": record.get("sheet_names", []),
                "enabled_sheet_names": record.get("enabled_sheet_names", record.get("sheet_names", [])),
                "current_sheet_name": record.get("current_sheet_name"),
            }

        # Responsable cannot create new processes
        if authorization and authorization.startswith("Bearer "):
            from app.db.user_store import SESSIONS_DB, USERS_DB
            token = authorization[7:]
            uid = SESSIONS_DB.get(token)
            if uid:
                actor = USERS_DB.get(uid)
                if actor and actor["role"] == "responsable":
                    raise HTTPException(status_code=403, detail="Los responsables no pueden crear nuevos procesos")

        process_id = str(uuid.uuid4())
        if nombre_del_proceso and nombre_del_proceso.strip():
            process_name = nombre_del_proceso.strip()
        else:
            process_name = file.filename.rsplit(".", 1)[0] if "." in file.filename else file.filename

        if _process_name_exists_in_project(process_name, project_id):
            raise HTTPException(
                status_code=409,
                detail="Ya existe un proceso con ese nombre en la carpeta seleccionada",
            )

        _save_original_file(contents, file.filename, process_name, project_id, now)

        FILES_DB[process_id] = {
            "process_name": process_name,
            "latest_input_name": file.filename,
            "current_data": df,
            "sheet_data": workbook,
            "sheet_names": sheet_names,
            "enabled_sheet_names": list(sheet_names),
            "current_sheet_name": default_sheet,
            "metadata": parsed_metadata,
            "commitment_schedule": parsed_commitment,
            "commitment_schedule_set_at": now if parsed_commitment and parsed_commitment.get("activo") else None,
            "commitment_history": [],
            "created_at": now,
            "updated_at": now,
            "project_id": project_id,
            "input_mode": "manual_upload",
            "current_rule_set_id": None,
            "rule_sets": [],
            "current_rule_version_id": None,
            "current_rule_version_id_by_sheet": {},
            "rule_versions": [],
            "executions": [],
        }
        save_files_state()

        if project_id:
            try:
                from app.routes.projects import find_node_by_id, save_projects_state
                node = find_node_by_id(project_id)
                if node and process_id not in node.files:
                    node.files.append(process_id)
                    save_projects_state()
            except Exception as e:
                print(f"Warning: Could not associate process with project: {str(e)}")

        return {
            "file_id": process_id,
            "process_id": process_id,
            "file_name": process_name,
            "latest_input_name": file.filename,
            "timestamp": FILES_DB[process_id]["updated_at"],
            "metadata": parsed_metadata,
            "project_id": project_id,
            "sheet_names": sheet_names,
            "enabled_sheet_names": list(sheet_names),
            "current_sheet_name": default_sheet,
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"Unexpected error: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error inesperado: {str(e)}")


@router.get("/")
def list_files(
    project_id: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(None),
):
    try:
        # Determine assigned filter for responsable role
        assigned_ids: Optional[list] = None
        if authorization and authorization.startswith("Bearer "):
            from app.db.user_store import SESSIONS_DB, USERS_DB
            token = authorization[7:]
            uid = SESSIONS_DB.get(token)
            if uid:
                actor = USERS_DB.get(uid)
                if actor and actor["role"] == "responsable":
                    assigned_ids = actor.get("assigned_project_ids", [])

        def _visible(file_id: str, data: dict) -> bool:
            if project_id is not None and data.get("project_id") != project_id:
                return False
            if assigned_ids is not None:
                process_folder = data.get("project_id")
                if file_id not in assigned_ids and (not process_folder or process_folder not in assigned_ids):
                    return False
            return True

        return [
            build_process_response(file_id, data)
            for file_id, data in FILES_DB.items()
            if _visible(file_id, data)
        ]
    except Exception as e:
        print(f"Error listing files: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error al listar archivos: {str(e)}")


@router.post("/{process_id}/instance")
async def upload_process_instance(
    process_id: str,
    file: UploadFile = File(...),
    raw_only: bool = Query(default=False),
    authorization: Optional[str] = Header(None),
):
    """Upload a new file instance.

    - default: auto-apply current active rule by enabled sheet
    - raw_only=true: store/move raw file only (no rule execution)
    """
    record = ensure_process(process_id)

    # Role check: responsable can only upload to assigned processes or folders
    if authorization and authorization.startswith("Bearer "):
        from app.db.user_store import SESSIONS_DB, USERS_DB
        token = authorization[7:]
        uid = SESSIONS_DB.get(token)
        if uid:
            actor = USERS_DB.get(uid)
            if actor and actor["role"] == "responsable":
                assigned = actor.get("assigned_project_ids", [])
                process_folder = record.get("project_id")
                if process_id not in assigned and (not process_folder or process_folder not in assigned):
                    raise HTTPException(status_code=403, detail="No tienes permiso para cargar archivos en este proceso")

    contents = await file.read()
    now = _now_scl()
    uploaded_by = _resolve_username(authorization)
    if not contents:
        execution = {
            "id": str(uuid.uuid4()),
            "process_id": process_id,
            "file_id": process_id,
            "file_name": record.get("process_name") or record.get("latest_input_name"),
            "latest_input_name": file.filename,
            "rule": None,
            "rule_version_id": record.get("current_rule_version_id"),
            "rule_version": None,
            "timestamp": now,
            "status": "error_formato",
            "error": "Error de formato: archivo vacío",
            "uploaded_by": uploaded_by,
            "result": [],
        }
        append_execution_record(record, execution)
        raise HTTPException(status_code=400, detail="Error de formato: el archivo está vacío")

    fname_lower = file.filename.lower()
    try:
        if fname_lower.endswith((".xlsx", ".xls")):
            raw_wb = pd.read_excel(BytesIO(contents), sheet_name=None, header=None)
            if not raw_wb:
                raise ValueError("El archivo no contiene hojas")
            workbook = {name: _rename_cols_to_excel_letters(shdf) for name, shdf in raw_wb.items()}
        elif fname_lower.endswith(".csv"):
            csv_df = pd.read_csv(BytesIO(contents), header=None)
            workbook = {"Sheet1": _rename_cols_to_excel_letters(csv_df)}
        else:
            raise ValueError("Formato no soportado")
    except Exception as e:
        execution = {
            "id": str(uuid.uuid4()),
            "process_id": process_id,
            "file_id": process_id,
            "file_name": record.get("process_name") or record.get("latest_input_name"),
            "latest_input_name": file.filename,
            "rule": None,
            "rule_version_id": record.get("current_rule_version_id"),
            "rule_version": None,
            "timestamp": now,
            "status": "error_formato",
            "error": f"Error de formato: {str(e)}",
            "uploaded_by": uploaded_by,
            "result": [],
        }
        append_execution_record(record, execution)
        raise HTTPException(status_code=400, detail="Error de formato")

    sheet_names = list(workbook.keys())
    enabled_sheet_names = record.get("enabled_sheet_names", sheet_names)
    enabled_sheet_names = [s for s in enabled_sheet_names if s in sheet_names]
    if not enabled_sheet_names:
        enabled_sheet_names = list(sheet_names)

    selected_sheet = record.get("current_sheet_name")
    if selected_sheet not in workbook:
        selected_sheet = enabled_sheet_names[0]

    record["sheet_data"] = workbook
    record["sheet_names"] = sheet_names
    record["enabled_sheet_names"] = enabled_sheet_names
    record["current_sheet_name"] = selected_sheet
    record["current_data"] = workbook[selected_sheet]
    record["latest_input_name"] = file.filename
    record["updated_at"] = now
    save_files_state()
    _save_original_file(
        contents, file.filename,
        record.get("process_name") or file.filename,
        record.get("project_id"),
        now,
    )
    outputs = []
    current_rule_by_sheet = record.get("current_rule_version_id_by_sheet", {})

    if raw_only:
        outputs.append(
            {
                "sheet_name": selected_sheet,
                "rule": None,
                "rule_version_id": None,
                "rule_version": None,
                "status": "raw_only",
                "result": [],
            }
        )
    else:
        for sheet in enabled_sheet_names:
            active_rule_id = current_rule_by_sheet.get(sheet)
            if not active_rule_id:
                continue

            active_rule = next(
                (r for r in record.get("rule_versions", []) if r.get("id") == active_rule_id),
                None,
            )
            if not active_rule:
                continue

            output = {
                "sheet_name": sheet,
                "rule": active_rule.get("rule"),
                "rule_version_id": active_rule_id,
                "rule_version": active_rule.get("version"),
                "status": "success",
                "result": [],
                "_result_df": None,   # internal, stripped before storing
            }

            rule_payload = active_rule.get("rule") or {}
            table_rules = rule_payload.get("tables", []) if isinstance(rule_payload, dict) else []
            is_raw_only_rule = bool(table_rules) and all(
                (tr or {}).get("extraction_mode") == "raw_only" for tr in table_rules
            )
            if is_raw_only_rule:
                output["status"] = "raw_only"
                output["result"] = []
                outputs.append(output)
                continue

            try:
                result_df = apply_rules(workbook[sheet].copy(), active_rule["rule"])
                output["_result_df"] = result_df
                if isinstance(result_df, dict):
                    output["tables"] = [
                        {
                            "table_name": table_name,
                            "result": table_df.fillna("").to_dict(orient="records"),
                        }
                        for table_name, table_df in result_df.items()
                    ]
                    output["result"] = output["tables"][0]["result"] if output["tables"] else []
                else:
                    output["tables"] = []
                    output["result"] = result_df.fillna("").to_dict(orient="records")
                output["status"] = "success"
            except Exception as e:
                output["status"] = "error_formato"
                output["error"] = f"Error de formato: {str(e)}"

            outputs.append(output)

    if not outputs:
        outputs.append(
            {
                "sheet_name": selected_sheet,
                "rule": None,
                "rule_version_id": None,
                "rule_version": None,
                "status": "sin_regla",
                "result": [],
            }
        )

    has_error = any(output.get("status") in {"error", "error_formato"} for output in outputs)
    overall_status = "warning" if has_error else "success"
    now_dt = datetime.fromisoformat(now)
    if now_dt.tzinfo is None:
        now_dt = now_dt.replace(tzinfo=_SCL)
    commitment_state = _commitment_state_for_upload(record.get("commitment_schedule"), now_dt)
    representative_result = next(
        (output.get("result") for output in outputs if output.get("status") == "success" and output.get("result")),
        outputs[0].get("result", []),
    )

    # Stash DataFrames before storing execution (not JSON-serialisable)
    result_dfs_by_sheet = {}
    for output in outputs:
        df_obj = output.pop("_result_df", None)
        if df_obj is not None:
            result_dfs_by_sheet[output["sheet_name"]] = (output.get("rule") or {}, df_obj)

    execution_batch = {
        "id": str(uuid.uuid4()),
        "process_id": process_id,
        "file_id": process_id,
        "file_name": record.get("process_name") or record.get("latest_input_name"),
        "latest_input_name": file.filename,
        "timestamp": now,
        "status": overall_status,
        "commitment_status": commitment_state,
        "uploaded_by": uploaded_by,
        "outputs": outputs,
        "result": representative_result,
    }
    append_execution_record(record, execution_batch)

    # ── Output Delivery: fire for each successfully processed sheet/table ──
    try:
        from app.services.output_delivery.contracts import OutputContract
        from app.services.output_delivery import engine as delivery_engine
        from app.routes.rules import _get_folder_path

        folder_path = _get_folder_path(record.get("project_id"))
        from app.routes.rules import _get_folder_ids
        folder_ids = _get_folder_ids(record.get("project_id"))

        # ── Copy original file to every matching subscription's base_path ──
        delivery_engine.dispatch_original(
            folder_path=folder_path,
            folder_ids=folder_ids,
            process_id=process_id,
            process_name=record.get("process_name") or record.get("latest_input_name", ""),
            timestamp=now,
            contents=contents,
            filename=file.filename,
        )

        for sheet_name_out, (rule_used, result_df) in result_dfs_by_sheet.items():
            tables_df = result_df if isinstance(result_df, dict) else {"default": result_df}
            for tname, tdf in tables_df.items():
                contract = OutputContract(
                    execution_id=execution_batch["id"],
                    process_id=process_id,
                    process_name=record.get("process_name") or record.get("latest_input_name", ""),
                    folder_id=record.get("project_id"),
                    folder_path=folder_path,
                    folder_ids=folder_ids,
                    sheet_name=sheet_name_out,
                    table_name=tname,
                    columns=list(tdf.columns),
                    row_count=len(tdf),
                    extraction_mode=rule_used.get("extraction_mode", "range"),
                    timestamp=now,
                    rule_version_id=rule_used.get("id"),
                    rule_version=rule_used.get("version"),
                    rule_config=rule_used,
                    process_metadata=record.get("metadata", {}),
                )
                delivery_engine.dispatch(contract, tdf)
    except Exception:
        pass
    # ── end Output Delivery ──

    return {
        "process_id": process_id,
        "latest_input_name": file.filename,
        "timestamp": now,
        "status": overall_status,
        "execution": {
            "execution_id": execution_batch["id"],
            "status": overall_status,
            "outputs": [
                {
                    "sheet_name": output.get("sheet_name"),
                    "status": output.get("status"),
                    "rule_version": output.get("rule_version"),
                }
                for output in outputs
            ],
        },
    }


@router.put("/{file_id}/sheet-selection")
def update_sheet_selection(file_id: str, payload: dict):
    try:
        record = ensure_process(file_id)
        available = record.get("sheet_names", [])
        requested = payload.get("enabled_sheet_names", []) or []
        enabled = [sheet for sheet in requested if sheet in available]
        if not enabled:
            enabled = list(available)

        record["enabled_sheet_names"] = enabled
        if record.get("current_sheet_name") not in enabled and enabled:
            record["current_sheet_name"] = enabled[0]
            if record.get("sheet_data", {}).get(enabled[0]) is not None:
                record["current_data"] = record["sheet_data"][enabled[0]]
        record["updated_at"] = _now_scl()
        save_files_state()
        return {
            "status": "ok",
            "enabled_sheet_names": record["enabled_sheet_names"],
            "current_sheet_name": record.get("current_sheet_name"),
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error updating sheet selection: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error al actualizar seleccion de hojas: {str(e)}")


@router.put("/{file_id}")
def update_metadata(file_id: str, payload: dict):
    try:
        record = ensure_process(file_id)

        if payload.get("metadata") is not None:
            record["metadata"] = payload.get("metadata", {})
        if payload.get("process_name"):
            next_name = str(payload["process_name"] or "").strip()
            if next_name:
                if _process_name_exists_in_project(next_name, record.get("project_id"), exclude_process_id=file_id):
                    raise HTTPException(
                        status_code=409,
                        detail="Ya existe un proceso con ese nombre en la misma carpeta",
                    )
                record["process_name"] = next_name
        if "commitment_schedule" in payload:
            old_schedule = record.get("commitment_schedule")
            new_schedule = _normalize_schedule_payload(payload["commitment_schedule"])
            if old_schedule is not None and old_schedule != new_schedule:
                record.setdefault("commitment_history", []).append({
                    "schedule": old_schedule,
                    "valid_until": _now_scl(),
                })
            record["commitment_schedule"] = new_schedule
            # Track when the schedule was first activated
            if "commitment_schedule_set_at" not in record and new_schedule and new_schedule.get("activo"):
                record["commitment_schedule_set_at"] = _now_scl()
        record["updated_at"] = _now_scl()
        save_files_state()

        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error updating metadata: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error al actualizar metadata: {str(e)}")


@router.delete("/{file_id}")
def delete_file(file_id: str):
    try:
        if file_id not in FILES_DB:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")

        file_project_id = FILES_DB[file_id].get("project_id")

        if file_project_id:
            try:
                from app.routes.projects import find_node_by_id, save_projects_state

                node = find_node_by_id(file_project_id)
                if node:
                    node.files = [stored_file_id for stored_file_id in node.files if stored_file_id != file_id]
                    save_projects_state()
            except Exception as unlink_error:
                print(f"Warning unlinking file from project: {str(unlink_error)}")

        del FILES_DB[file_id]
        save_files_state()

        return {"status": "ok", "message": f"Proceso {file_id} eliminado correctamente"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error deleting file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error al eliminar archivo: {str(e)}")


@router.get("/{file_id}")
def get_file(file_id: str, sheet_name: Optional[str] = Query(default=None), preview_rows: int = Query(default=50, ge=10, le=500)):
    try:
        record = ensure_process(file_id)

        sheets = record.get("sheet_data") or {"Sheet1": record["current_data"]}
        available_sheets = record.get("sheet_names") or list(sheets.keys())
        enabled_sheets = record.get("enabled_sheet_names", available_sheets)
        selected_sheet = sheet_name or record.get("current_sheet_name") or (enabled_sheets[0] if enabled_sheets else None)
        if selected_sheet not in enabled_sheets and enabled_sheets:
            selected_sheet = enabled_sheets[0]
        if selected_sheet and selected_sheet in sheets:
            df = sheets[selected_sheet]
            record["current_sheet_name"] = selected_sheet
            record["current_data"] = df
            save_files_state()
        else:
            df = record["current_data"]
            selected_sheet = None

        active_rule_id = (
            record.get("current_rule_version_id_by_sheet", {}).get(selected_sheet)
            or record.get("current_rule_version_id")
        )
        active_rule = next(
            (rule for rule in record.get("rule_versions", []) if rule.get("id") == active_rule_id),
            None,
        )

        return {
            "file_id": file_id,
            "process_id": file_id,
            "file_name": record.get("process_name") or record.get("latest_input_name"),
            "process_name": record.get("process_name") or record.get("latest_input_name"),
            "latest_input_name": record.get("latest_input_name"),
            "sheet_names": available_sheets,
            "enabled_sheet_names": enabled_sheets,
            "current_sheet_name": selected_sheet,
            "columns": df.columns.tolist(),
            "preview": serialize_preview(df, max_rows=preview_rows),
            "metadata": record.get("metadata", {}),
            "current_rule": active_rule,
            "rule_versions_count": len(record.get("rule_versions", [])),
            "executions_count": len(record.get("executions", [])),
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error getting file: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error al obtener archivo: {str(e)}")