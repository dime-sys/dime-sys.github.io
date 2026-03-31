from fastapi import APIRouter, Body, Query, Header
from datetime import datetime
import uuid
from typing import Optional

from app.services.processor import apply_rules
from app.routes.upload import FILES_DB
from app.services.output_delivery.contracts import OutputContract
from app.services.output_delivery import engine as delivery_engine
from app.db.database import load_snapshot, save_snapshot


def _get_folder_path(project_id: str) -> list:
    """Return the list of node names from root to *project_id* (inclusive)."""
    if not project_id:
        return []
    try:
        from app.routes.projects import PROJECTS_DB, find_node_by_id

        def _ancestors(target_id, node, path):
            if node.id == target_id:
                return path + [node.name]
            for child in node.children:
                result = _ancestors(target_id, child, path + [node.name])
                if result:
                    return result
            return None

        for root in PROJECTS_DB.values():
            path = _ancestors(project_id, root, [])
            if path:
                return path
    except Exception:
        pass
    return []


def _get_folder_ids(project_id: str) -> list:
    """Return the list of node IDs from root to *project_id* (inclusive)."""
    if not project_id:
        return []
    try:
        from app.routes.projects import PROJECTS_DB

        def _ancestor_ids(target_id, node, path):
            if node.id == target_id:
                return path + [node.id]
            for child in node.children:
                result = _ancestor_ids(target_id, child, path + [node.id])
                if result:
                    return result
            return None

        for root in PROJECTS_DB.values():
            path = _ancestor_ids(project_id, root, [])
            if path:
                return path
    except Exception:
        pass
    return []

router = APIRouter()

EXECUTIONS_NAMESPACE = "executions"
EXECUTIONS_DB = load_snapshot(EXECUTIONS_NAMESPACE, list)
DEFAULT_EXECUTION_USER = "user_x"


def save_executions_state() -> None:
    save_snapshot(EXECUTIONS_NAMESPACE, EXECUTIONS_DB)


def _resolve_execution_user(authorization: Optional[str]) -> str:
    """Resolve the authenticated username for execution audit; fallback to default."""
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
        try:
            from app.db.user_store import SESSIONS_DB, USERS_DB
            uid = SESSIONS_DB.get(token)
            if uid:
                user = USERS_DB.get(uid)
                if user and user.get("username"):
                    return user["username"]
        except Exception:
            pass
    return DEFAULT_EXECUTION_USER


def _is_raw_only_rule(rule: dict) -> bool:
    tables = (rule or {}).get("tables") if isinstance(rule, dict) else None
    if not tables:
        return (rule or {}).get("extraction_mode") == "raw_only"
    return all((t or {}).get("extraction_mode") == "raw_only" for t in tables)


def get_process(process_id: str):
    return FILES_DB.get(process_id)


def get_active_rule(process_record: dict, sheet_name: str = None):
    if sheet_name:
        active_rule_id = process_record.get("current_rule_version_id_by_sheet", {}).get(sheet_name)
    else:
        active_rule_id = process_record.get("current_rule_version_id")
    return next(
        (rule for rule in process_record.get("rule_versions", []) if rule.get("id") == active_rule_id),
        None,
    )


def serialize_result_df(result_df):
    if isinstance(result_df, dict):
        tables = []
        for table_name, table_df in result_df.items():
            tables.append(
                {
                    "table_name": table_name,
                    "result": table_df.fillna("").to_dict(orient="records"),
                }
            )
        return {
            "tables": tables,
            "result": tables[0]["result"] if tables else [],
        }
    return {
        "tables": [],
        "result": result_df.fillna("").to_dict(orient="records"),
    }


def store_rule_version(process_record: dict, sheet_name: str, rule: dict, created_by: str = DEFAULT_EXECUTION_USER):
    from app.routes.upload import save_files_state

    applied_at = datetime.utcnow().isoformat() + "+00:00"
    active_rule = get_active_rule(process_record, sheet_name)
    next_version = (
        len([r for r in process_record.get("rule_versions", []) if r.get("sheet_name") == sheet_name]) + 1
    )
    rule_version_id = str(uuid.uuid4())
    stored_rule = {
        "id": rule_version_id,
        "version": next_version,
        "sheet_name": sheet_name,
        "rule": rule,
        "created_at": applied_at,
        "created_by": created_by or DEFAULT_EXECUTION_USER,
        "is_active": True,
    }

    if active_rule:
        active_rule["is_active"] = False

    process_record.setdefault("rule_versions", []).append(stored_rule)
    process_record["current_rule_version_id"] = rule_version_id
    process_record.setdefault("current_rule_version_id_by_sheet", {})[sheet_name] = rule_version_id
    process_record["updated_at"] = applied_at
    save_files_state()

    return stored_rule


@router.post("/")
def save_rule(payload: dict = Body(...), authorization: Optional[str] = Header(None)):
    process_id = payload.get("process_id") or payload.get("file_id")
    rule = payload.get("rule")
    sheet_name = payload.get("sheet_name")

    if not process_id:
        return {"error": "process_id requerido"}

    if not rule:
        return {"error": "rule requerida"}

    actor_username = _resolve_execution_user(authorization)

    process_record = get_process(process_id)

    if not process_record:
        return {"error": "Proceso no encontrado"}

    enabled_sheets = process_record.get("enabled_sheet_names", process_record.get("sheet_names", []))

    if not sheet_name:
        sheet_name = process_record.get("current_sheet_name")
    if sheet_name and enabled_sheets and sheet_name not in enabled_sheets:
        return {"error": f"La hoja '{sheet_name}' esta descartada para configuracion"}
    sheets = process_record.get("sheet_data") or {}
    if sheet_name and sheet_name in sheets:
        df = sheets[sheet_name].copy()
    else:
        df = process_record["current_data"].copy()
        sheet_name = process_record.get("current_sheet_name")
    df.columns = df.columns.map(str)

    print("=" * 60)
    print("REGLA RECIBIDA:")
    print(f"Process ID: {process_id}")
    print(f"Sheet: {sheet_name}")
    print(f"Rule: {rule}")
    print(f"DataFrame original shape: {df.shape}")
    print(f"Columnas originales: {df.columns.tolist()}")
    print("=" * 60)

    try:
        had_previous_rule_for_sheet = any(
            r.get("sheet_name") == sheet_name for r in process_record.get("rule_versions", [])
        )
        is_raw_only = _is_raw_only_rule(rule)
        if is_raw_only:
            result_df = None
            serialized = {"tables": [], "result": []}
        else:
            result_df = apply_rules(df, rule)
            serialized = serialize_result_df(result_df)
        stored_rule = store_rule_version(process_record, sheet_name, rule, created_by=actor_username)
        applied_at = stored_rule["created_at"]

        execution = None
        execution_created = False
        # First-time configuration should save rule only (no execution / no delivery).
        if had_previous_rule_for_sheet and not is_raw_only:
            execution = {
                "id": str(uuid.uuid4()),
                "process_id": process_id,
                "file_id": process_id,
                "file_name": process_record.get("process_name") or process_record.get("latest_input_name"),
                "latest_input_name": process_record.get("latest_input_name"),
                "sheet_name": sheet_name,
                "rule": rule,
                "rule_version_id": stored_rule["id"],
                "rule_version": stored_rule["version"],
                "result": serialized["result"],
                "tables": serialized.get("tables", []),
                "timestamp": applied_at,
                "status": "success",
                "uploaded_by": actor_username,
            }

            process_record.setdefault("executions", []).append(execution)
            EXECUTIONS_DB.append(execution)
            from app.routes.upload import save_files_state
            save_files_state()
            save_executions_state()
            execution_created = True

            # ── Output Delivery (non-blocking: failures must not fail the execution) ──
            try:
                tables_df = result_df if isinstance(result_df, dict) else {"default": result_df}
                folder_path = _get_folder_path(process_record.get("project_id"))
                folder_ids = _get_folder_ids(process_record.get("project_id"))
                for tname, tdf in tables_df.items():
                    contract = OutputContract(
                        execution_id=execution["id"],
                        process_id=process_id,
                        process_name=process_record.get("process_name") or process_record.get("latest_input_name", ""),
                        folder_id=process_record.get("project_id"),
                        folder_path=folder_path,
                        folder_ids=folder_ids,
                        sheet_name=sheet_name,
                        table_name=tname,
                        columns=list(tdf.columns),
                        row_count=len(tdf),
                        extraction_mode=rule.get("extraction_mode", "range"),
                        timestamp=applied_at,
                        rule_version_id=stored_rule["id"],
                        rule_version=stored_rule["version"],
                        rule_config=rule,
                        process_metadata=process_record.get("metadata", {}),
                    )
                    delivery_engine.dispatch(contract, tdf)
            except Exception:
                pass
            # ── end Output Delivery ──

        return {
            "status": "processed" if execution_created else "configured",
            "execution": execution,
            "execution_created": execution_created,
            "rule_version": stored_rule,
        }

    except Exception as e:
        print(f"ERROR EN APPLY_RULES: {str(e)}")
        import traceback
        traceback.print_exc()
        return {"error": f"Error al aplicar regla: {str(e)}"}


@router.post("/bulk")
def save_rules_bulk(payload: dict = Body(...), authorization: Optional[str] = Header(None)):
    process_id = payload.get("process_id") or payload.get("file_id")
    rules_by_sheet = payload.get("rules_by_sheet") or {}

    if not process_id:
        return {"error": "process_id requerido"}

    if not isinstance(rules_by_sheet, dict) or not rules_by_sheet:
        return {"error": "rules_by_sheet requerido"}

    actor_username = _resolve_execution_user(authorization)

    process_record = get_process(process_id)
    if not process_record:
        return {"error": "Proceso no encontrado"}

    enabled_sheets = process_record.get("enabled_sheet_names", process_record.get("sheet_names", []))
    sheets_data = process_record.get("sheet_data") or {}

    saved = []
    errors = []
    applied_rules_by_sheet = {}
    for sheet_name, rule in rules_by_sheet.items():
        if enabled_sheets and sheet_name not in enabled_sheets:
            errors.append({"sheet_name": sheet_name, "error": "Hoja descartada"})
            continue
        if sheet_name not in sheets_data:
            errors.append({"sheet_name": sheet_name, "error": "Hoja no encontrada"})
            continue
        if not isinstance(rule, dict):
            errors.append({"sheet_name": sheet_name, "error": "Regla invalida"})
            continue

        try:
            had_previous_rule_for_sheet = any(
                r.get("sheet_name") == sheet_name for r in process_record.get("rule_versions", [])
            )
            is_raw_only = _is_raw_only_rule(rule)
            df = sheets_data[sheet_name].copy()
            df.columns = df.columns.map(str)
            if is_raw_only:
                result_df = None
                serialized = {"tables": [], "result": []}
            else:
                result_df = apply_rules(df, rule)
                serialized = serialize_result_df(result_df)
            saved_rule = store_rule_version(process_record, sheet_name, rule, created_by=actor_username)
            applied_at = saved_rule["created_at"]

            execution_created = False
            if had_previous_rule_for_sheet and not is_raw_only:
                execution = {
                    "id": str(uuid.uuid4()),
                    "process_id": process_id,
                    "file_id": process_id,
                    "file_name": process_record.get("process_name") or process_record.get("latest_input_name"),
                    "latest_input_name": process_record.get("latest_input_name"),
                    "sheet_name": sheet_name,
                    "rule": rule,
                    "rule_version_id": saved_rule["id"],
                    "rule_version": saved_rule["version"],
                    "result": serialized["result"],
                    "tables": serialized.get("tables", []),
                    "timestamp": applied_at,
                    "status": "success",
                    "uploaded_by": actor_username,
                }
                process_record.setdefault("executions", []).append(execution)
                EXECUTIONS_DB.append(execution)
                from app.routes.upload import save_files_state
                save_files_state()
                save_executions_state()
                execution_created = True

                # ── Output Delivery ──
                try:
                    tables_df = result_df if isinstance(result_df, dict) else {"default": result_df}
                    folder_path = _get_folder_path(process_record.get("project_id"))
                    folder_ids = _get_folder_ids(process_record.get("project_id"))
                    for tname, tdf in tables_df.items():
                        contract = OutputContract(
                            execution_id=execution["id"],
                            process_id=process_id,
                            process_name=process_record.get("process_name") or process_record.get("latest_input_name", ""),
                            folder_id=process_record.get("project_id"),
                            folder_path=folder_path,
                            folder_ids=folder_ids,
                            sheet_name=sheet_name,
                            table_name=tname,
                            columns=list(tdf.columns),
                            row_count=len(tdf),
                            extraction_mode=rule.get("extraction_mode", "range"),
                            timestamp=applied_at,
                            rule_version_id=saved_rule["id"],
                            rule_version=saved_rule["version"],
                            rule_config=rule,
                            process_metadata=process_record.get("metadata", {}),
                        )
                        delivery_engine.dispatch(contract, tdf)
                except Exception:
                    pass
                # ── end Output Delivery ──

            saved.append({
                "sheet_name": sheet_name,
                "rule_version_id": saved_rule["id"],
                "version": saved_rule["version"],
                "execution_created": execution_created,
            })
            applied_rules_by_sheet[sheet_name] = rule
        except Exception as e:
            errors.append({"sheet_name": sheet_name, "error": str(e)})

    if saved:
        active_rule_set = next(
            (rule_set for rule_set in process_record.get("rule_sets", []) if rule_set.get("is_active")),
            None,
        )
        if active_rule_set:
            active_rule_set["is_active"] = False

        next_rule_set_version = len(process_record.get("rule_sets", [])) + 1
        rule_set = {
            "id": str(uuid.uuid4()),
            "version": next_rule_set_version,
            "created_at": datetime.utcnow().isoformat(),
            "is_active": True,
            "rules_by_sheet": applied_rules_by_sheet,
        }
        process_record.setdefault("rule_sets", []).append(rule_set)
        process_record["current_rule_set_id"] = rule_set["id"]
        from app.routes.upload import save_files_state
        save_files_state()

    return {
        "status": "ok" if not errors else "partial",
        "saved_count": len(saved),
        "error_count": len(errors),
        "saved": saved,
        "errors": errors,
    }


@router.get("/executions/{file_id}")
def get_executions_by_file(file_id: str, sheet_name: str = Query(default=None)):
    process_record = get_process(file_id)
    if not process_record:
        return []
    executions = process_record.get("executions", [])
    if sheet_name:
        return [e for e in executions if e.get("sheet_name") == sheet_name]
    return executions


@router.get("/rule-history/{file_id}")
def get_rule_history(file_id: str, sheet_name: str = Query(default=None)):
    process_record = get_process(file_id)
    if not process_record:
        return []
    rule_sets = process_record.get("rule_sets", [])
    if rule_sets:
        if sheet_name:
            return [r for r in rule_sets if sheet_name in (r.get("rules_by_sheet") or {})]
        return rule_sets
    rules = process_record.get("rule_versions", [])
    if sheet_name:
        return [r for r in rules if r.get("sheet_name") == sheet_name]
    return rules


@router.get("/current-rule/{file_id}")
def get_current_rule(file_id: str, sheet_name: str = Query(default=None)):
    process_record = get_process(file_id)
    if not process_record:
        return None
    return get_active_rule(process_record, sheet_name)


@router.delete("/executions")
def clear_executions():
    EXECUTIONS_DB.clear()
    for process_record in FILES_DB.values():
        process_record["executions"] = []
    from app.routes.upload import save_files_state
    save_files_state()
    save_executions_state()
    return {"status": "ok"}