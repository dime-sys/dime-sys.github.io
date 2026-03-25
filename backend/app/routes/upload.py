from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from typing import Optional
import pandas as pd
import uuid
import json
from io import BytesIO
from datetime import datetime
from app.services.processor import apply_rules

router = APIRouter()

FILES_DB = {}
DEFAULT_EXECUTION_USER = "user_x"

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
    for _, row in df.head(max_rows).iterrows():
        row_dict = {}
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
    }


def ensure_process(process_id: str):
    record = FILES_DB.get(process_id)
    if not record:
        raise HTTPException(status_code=404, detail="Proceso no encontrado")
    return record


def append_execution_record(process_record: dict, execution: dict):
    process_record.setdefault("executions", []).append(execution)
    try:
        from app.routes.rules import EXECUTIONS_DB
        EXECUTIONS_DB.append(execution)
    except Exception:
        pass


@router.post("/")
async def upload_file(
    file: UploadFile = File(...),
    metadata: Optional[str] = Form(None),
    project_id: Optional[str] = Form(None),
    process_id: Optional[str] = Form(None)
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
        
        # Try to read workbook and keep all sheets
        try:
            workbook = pd.read_excel(BytesIO(contents), sheet_name=None)
            if not workbook:
                raise ValueError("El archivo no contiene hojas")
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

        now = datetime.utcnow().isoformat()

        if process_id and process_id in FILES_DB:
            record = FILES_DB[process_id]
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
            if project_id:
                record["project_id"] = project_id

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

        process_id = str(uuid.uuid4())
        process_name = file.filename.rsplit(".", 1)[0] if "." in file.filename else file.filename

        FILES_DB[process_id] = {
            "process_name": process_name,
            "latest_input_name": file.filename,
            "current_data": df,
            "sheet_data": workbook,
            "sheet_names": sheet_names,
            "enabled_sheet_names": list(sheet_names),
            "current_sheet_name": default_sheet,
            "metadata": parsed_metadata,
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

        if project_id:
            try:
                from app.routes.projects import find_node_by_id
                node = find_node_by_id(project_id)
                if node and process_id not in node.files:
                    node.files.append(process_id)
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
def list_files(project_id: Optional[str] = Query(default=None)):
    try:
        return [
            build_process_response(file_id, data)
            for file_id, data in FILES_DB.items()
            if project_id is None or data.get("project_id") == project_id
        ]
    except Exception as e:
        print(f"Error listing files: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error al listar archivos: {str(e)}")


@router.post("/{process_id}/instance")
async def upload_process_instance(
    process_id: str,
    file: UploadFile = File(...),
):
    """Upload a new file instance to an existing process and auto-apply the current active rule."""
    record = ensure_process(process_id)

    contents = await file.read()
    now = datetime.utcnow().isoformat()
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
            "uploaded_by": DEFAULT_EXECUTION_USER,
            "result": [],
        }
        append_execution_record(record, execution)
        raise HTTPException(status_code=400, detail="Error de formato: el archivo está vacío")

    fname_lower = file.filename.lower()
    try:
        if fname_lower.endswith((".xlsx", ".xls")):
            workbook = pd.read_excel(BytesIO(contents), sheet_name=None)
            if not workbook:
                raise ValueError("El archivo no contiene hojas")
        elif fname_lower.endswith(".csv"):
            workbook = {"Sheet1": pd.read_csv(BytesIO(contents))}
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
            "uploaded_by": DEFAULT_EXECUTION_USER,
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

    for sheet in sheet_names:
        sheet_df = workbook[sheet]
        sheet_df.columns = sheet_df.columns.map(str)
        workbook[sheet] = sheet_df

    record["sheet_data"] = workbook
    record["sheet_names"] = sheet_names
    record["enabled_sheet_names"] = enabled_sheet_names
    record["current_sheet_name"] = selected_sheet
    record["current_data"] = workbook[selected_sheet]
    record["latest_input_name"] = file.filename
    record["updated_at"] = now
    outputs = []
    current_rule_by_sheet = record.get("current_rule_version_id_by_sheet", {})

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
        }

        try:
            result_df = apply_rules(workbook[sheet].copy(), active_rule["rule"])
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
    representative_result = next(
        (output.get("result") for output in outputs if output.get("status") == "success" and output.get("result")),
        outputs[0].get("result", []),
    )

    execution_batch = {
        "id": str(uuid.uuid4()),
        "process_id": process_id,
        "file_id": process_id,
        "file_name": record.get("process_name") or record.get("latest_input_name"),
        "latest_input_name": file.filename,
        "timestamp": now,
        "status": overall_status,
        "uploaded_by": DEFAULT_EXECUTION_USER,
        "outputs": outputs,
        "result": representative_result,
    }
    append_execution_record(record, execution_batch)

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
        record["updated_at"] = datetime.utcnow().isoformat()
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
            record["process_name"] = payload["process_name"]
        record["updated_at"] = datetime.utcnow().isoformat()

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
                from app.routes.projects import find_node_by_id

                node = find_node_by_id(file_project_id)
                if node:
                    node.files = [stored_file_id for stored_file_id in node.files if stored_file_id != file_id]
            except Exception as unlink_error:
                print(f"Warning unlinking file from project: {str(unlink_error)}")

        del FILES_DB[file_id]

        return {"status": "ok", "message": f"Proceso {file_id} eliminado correctamente"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error deleting file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error al eliminar archivo: {str(e)}")


@router.get("/{file_id}")
def get_file(file_id: str, sheet_name: Optional[str] = Query(default=None)):
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
            "preview": serialize_preview(df),
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