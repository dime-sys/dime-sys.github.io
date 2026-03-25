from fastapi import APIRouter, Body, Query
from datetime import datetime
import uuid

from app.services.processor import apply_rules
from app.routes.upload import FILES_DB

router = APIRouter()

EXECUTIONS_DB = []
DEFAULT_EXECUTION_USER = "user_x"


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


def store_rule_version(process_record: dict, sheet_name: str, rule: dict):
    applied_at = datetime.utcnow().isoformat()
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
        "is_active": True,
    }

    if active_rule:
        active_rule["is_active"] = False

    process_record.setdefault("rule_versions", []).append(stored_rule)
    process_record["current_rule_version_id"] = rule_version_id
    process_record.setdefault("current_rule_version_id_by_sheet", {})[sheet_name] = rule_version_id
    process_record["updated_at"] = applied_at

    return stored_rule


@router.post("/")
def save_rule(payload: dict = Body(...)):
    process_id = payload.get("process_id") or payload.get("file_id")
    rule = payload.get("rule")
    sheet_name = payload.get("sheet_name")

    if not process_id:
        return {"error": "process_id requerido"}

    if not rule:
        return {"error": "rule requerida"}

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
        result_df = apply_rules(df, rule)
        serialized = serialize_result_df(result_df)
        stored_rule = store_rule_version(process_record, sheet_name, rule)
        applied_at = stored_rule["created_at"]

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
            "uploaded_by": DEFAULT_EXECUTION_USER,
        }

        process_record.setdefault("executions", []).append(execution)
        EXECUTIONS_DB.append(execution)

        return {
            "status": "processed",
            "execution": execution,
            "rule_version": stored_rule,
        }

    except Exception as e:
        print(f"ERROR EN APPLY_RULES: {str(e)}")
        import traceback
        traceback.print_exc()
        return {"error": f"Error al aplicar regla: {str(e)}"}


@router.post("/bulk")
def save_rules_bulk(payload: dict = Body(...)):
    process_id = payload.get("process_id") or payload.get("file_id")
    rules_by_sheet = payload.get("rules_by_sheet") or {}

    if not process_id:
        return {"error": "process_id requerido"}

    if not isinstance(rules_by_sheet, dict) or not rules_by_sheet:
        return {"error": "rules_by_sheet requerido"}

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
            df = sheets_data[sheet_name].copy()
            df.columns = df.columns.map(str)
            apply_rules(df, rule)
            saved_rule = store_rule_version(process_record, sheet_name, rule)
            saved.append({
                "sheet_name": sheet_name,
                "rule_version_id": saved_rule["id"],
                "version": saved_rule["version"],
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
    return {"status": "ok"}