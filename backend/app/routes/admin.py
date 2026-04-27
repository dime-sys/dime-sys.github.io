from fastapi import APIRouter, Body, HTTPException, Query, Header
from datetime import datetime, timedelta
import uuid
from zoneinfo import ZoneInfo
from typing import Optional

from app.db.output_store import (
    ARTIFACTS_DB,
    DELIVERY_JOBS_DB,
    SUBSCRIPTIONS_DB,
    save_subscriptions_state,
)

router = APIRouter(prefix="/admin", tags=["admin"])

_SCL = ZoneInfo("America/Santiago")
_DIAS_MAP = {
    0: "lunes", 1: "martes", 2: "miercoles", 3: "jueves",
    4: "viernes", 5: "sabado", 6: "domingo",
}


def _parse_iso_local(value: str):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=_SCL)
        return dt.astimezone(_SCL)
    except Exception:
        return None


def _schedule_applies_on_date(schedule: dict, day_dt: datetime) -> bool:
    if not schedule or not schedule.get("activo"):
        return False
    tipo = schedule.get("tipo", "diario")
    if tipo == "diario":
        return True
    dias = schedule.get("dias", []) or []
    return _DIAS_MAP[day_dt.weekday()] in dias


def _normalized_schedule_ranges(schedule: dict):
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


def _windows_for_date(schedule: dict, day_dt: datetime):
    windows = []
    for r in _normalized_schedule_ranges(schedule):
        ini_h, ini_m = [int(x) for x in r["hora_inicio"].split(":")]
        fin_h, fin_m = [int(x) for x in r["hora_fin"].split(":")]
        start_dt = day_dt.replace(hour=ini_h, minute=ini_m, second=0, microsecond=0)
        end_dt = day_dt.replace(hour=fin_h, minute=fin_m, second=0, microsecond=0)
        windows.append((start_dt, end_dt))
    return windows


def _window_for_date(schedule: dict, day_dt: datetime):
    """Aggregate day window for compatibility: earliest start to latest end."""
    windows = _windows_for_date(schedule, day_dt)
    if not windows:
        return day_dt.replace(hour=0, minute=0, second=0, microsecond=0), day_dt.replace(hour=23, minute=59, second=0, microsecond=0)
    start_dt = min(w[0] for w in windows)
    end_dt = max(w[1] for w in windows)
    return start_dt, end_dt


def _next_due_datetime(schedule: dict, now: datetime):
    if not schedule or not schedule.get("activo"):
        return None
    for offset in range(0, 14):
        day = (now + timedelta(days=offset)).replace(hour=0, minute=0, second=0, microsecond=0)
        if not _schedule_applies_on_date(schedule, day):
            continue
        day_windows = _windows_for_date(schedule, day)
        for _, end_dt in day_windows:
            if end_dt >= now:
                return end_dt
    return None


def _build_process_monitor_row(process_id: str, record: dict, now: datetime) -> dict:
    from app.db.user_store import USERS_DB
    from app.routes.rules import _get_folder_ids

    if now.tzinfo is None:
        now = now.replace(tzinfo=_SCL)
    else:
        now = now.astimezone(_SCL)

    schedule = record.get("commitment_schedule") or {}
    active_schedule = bool(schedule.get("activo"))
    folder_ids = _get_folder_ids(record.get("project_id")) or []

    responsables = []
    for u in USERS_DB.values():
        from app.routes.auth import _has_role
        if not _has_role(u, "responsable"):
            continue
        if _user_covers_process(u, process_id, folder_ids):
            responsables.append(u.get("username"))
    responsables = sorted({r for r in responsables if r})

    # Most recent configurators first, deduplicated by username.
    configuradores = []
    seen_configuradores = set()
    rule_versions = record.get("rule_versions", []) or []
    for rv in sorted(rule_versions, key=lambda x: x.get("created_at") or "", reverse=True):
        who = (rv or {}).get("created_by") or "user_x"
        if not who or who in seen_configuradores:
            continue
        seen_configuradores.add(who)
        configuradores.append(who)

    executions = []
    for ex in record.get("executions", []):
        ts = _parse_iso_local(ex.get("timestamp"))
        if not ts:
            continue
        executions.append({
            "timestamp": ts,
            "uploaded_by": ex.get("uploaded_by") or "user_x",
            "status": ex.get("status") or "success",
        })
    executions.sort(key=lambda e: e["timestamp"])

    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_execs = [
        e for e in executions
        if e["timestamp"].date() == today_start.date() and e["status"] != "error_formato"
    ]

    window_today = None
    today_on_time = False
    today_late = False
    if active_schedule and _schedule_applies_on_date(schedule, today_start):
        day_windows = _windows_for_date(schedule, today_start)
        if day_windows:
            start_dt = min(w[0] for w in day_windows)
            end_dt = max(w[1] for w in day_windows)
        else:
            day_windows = []
            start_dt, end_dt = _window_for_date(schedule, today_start)
        window_today = {
            "start": start_dt.isoformat(timespec="seconds"),
            "end": end_dt.isoformat(timespec="seconds"),
        }
        today_on_time = any(
            any(w_start <= e["timestamp"] <= w_end for w_start, w_end in day_windows)
            and e.get("status") != "compromiso_vencido"
            for e in today_execs
        )
        today_late = bool(today_execs) and not today_on_time
    next_due = _next_due_datetime(schedule, now) if active_schedule else None

    stats = {
        "due_days": 0,
        "on_time_days": 0,
        "late_days": 0,
        "missed_days": 0,
        "late_dates": [],
        "missed_dates": [],
    }
    on_time_users = {}
    late_users = {}

    if active_schedule:
        set_at = _parse_iso_local(record.get("commitment_schedule_set_at")) or now
        day = set_at.replace(hour=0, minute=0, second=0, microsecond=0)
        last_due_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        while day <= last_due_day:
            if not _schedule_applies_on_date(schedule, day):
                day += timedelta(days=1)
                continue

            day_windows = _windows_for_date(schedule, day)
            if not day_windows:
                day += timedelta(days=1)
                continue
            day_end = max(w[1] for w in day_windows)
            if day_end > now:
                day += timedelta(days=1)
                continue

            stats["due_days"] += 1
            day_execs = [
                e for e in executions
                if e["timestamp"].date() == day.date() and e["status"] != "error_formato"
            ]
            on_time_exec = next(
                (
                    e for e in day_execs
                    if any(w_start <= e["timestamp"] <= w_end for w_start, w_end in day_windows)
                    and e.get("status") != "compromiso_vencido"
                ),
                None,
            )
            if on_time_exec:
                stats["on_time_days"] += 1
                who = on_time_exec["uploaded_by"]
                on_time_users[who] = on_time_users.get(who, 0) + 1
            elif day_execs:
                stats["late_days"] += 1
                _ranges = [{"hora_inicio": r["hora_inicio"], "hora_fin": r["hora_fin"]} for r in _normalized_schedule_ranges(schedule)]
                stats["late_dates"].append({"date": day.date().isoformat(), "ranges": _ranges})
                who = day_execs[0]["uploaded_by"]
                late_users[who] = late_users.get(who, 0) + 1
            else:
                stats["missed_days"] += 1
                _ranges = [{"hora_inicio": r["hora_inicio"], "hora_fin": r["hora_fin"]} for r in _normalized_schedule_ranges(schedule)]
                stats["missed_dates"].append({"date": day.date().isoformat(), "ranges": _ranges})
            day += timedelta(days=1)

    compliance_rate = (
        round((stats["on_time_days"] / stats["due_days"]) * 100, 2)
        if stats["due_days"] > 0 else None
    )

    if not active_schedule:
        monitor_status = "sin_compromiso"
    elif window_today is None:
        monitor_status = "proximo"
    else:
        window_end = _parse_iso_local(window_today["end"])
        if today_on_time:
            monitor_status = "cumplido"
        elif window_end and now > window_end:
            monitor_status = "atrasado"
        else:
            monitor_status = "proximo"

    labels = {
        "cumplido": "En cumplimiento",
        "proximo": "Próximo vencimiento",
        "atrasado": "Atrasado",
        "sin_compromiso": "Sin compromiso activo",
    }

    last_exec = executions[-1] if executions else None

    return {
        "process_id": process_id,
        "process_name": record.get("process_name") or record.get("latest_input_name") or process_id,
        "project_id": record.get("project_id"),
        "monitor_status": monitor_status,
        "monitor_status_label": labels.get(monitor_status, monitor_status),
        "next_due_at": next_due.isoformat(timespec="seconds") if next_due else None,
        "window_today": window_today,
        "today": {
            "executions_count": len(today_execs),
            "on_time": today_on_time,
            "late": today_late,
        },
        "last_execution": {
            "timestamp": last_exec["timestamp"].isoformat(timespec="seconds") if last_exec else None,
            "uploaded_by": last_exec["uploaded_by"] if last_exec else None,
            "status": last_exec["status"] if last_exec else None,
        },
        "stats": {
            **stats,
            "compliance_rate": compliance_rate,
        },
        "users": {
            "on_time": [{"user": u, "count": c} for u, c in sorted(on_time_users.items(), key=lambda x: x[1], reverse=True)],
            "late": [{"user": u, "count": c} for u, c in sorted(late_users.items(), key=lambda x: x[1], reverse=True)],
        },
        "responsables": responsables,
        "configuradores": configuradores,
        "commitment_schedule": schedule if active_schedule else None,
    }


def _collect_folder_descendants(node) -> set:
    ids = {node.id}
    for child in getattr(node, "children", []):
        ids |= _collect_folder_descendants(child)
    return ids


def _resolve_admin_scope(admin_user: dict):
    """
    Resolve folder/process scope reachable by this admin.

    If assigned_project_ids is empty -> full visibility.
    Otherwise, only assigned nodes/processes and descendants are visible.
    """
    from app.routes.projects import PROJECTS_DB, find_node_by_id
    from app.routes.upload import FILES_DB

    assigned_ids = set(admin_user.get("assigned_project_ids", []) or [])
    if not assigned_ids:
        return {
            "is_global": True,
            "allowed_folder_ids": set(),
            "allowed_process_ids": set(),
        }

    folder_ids = set()
    process_ids = set()
    for aid in assigned_ids:
        if aid in FILES_DB:
            process_ids.add(aid)
            continue
        node = find_node_by_id(aid)
        if node:
            folder_ids |= _collect_folder_descendants(node)

    # Any process under allowed folder scope also becomes visible.
    from app.routes.rules import _get_folder_ids
    for pid, rec in FILES_DB.items():
        fids = set(_get_folder_ids(rec.get("project_id")) or [])
        if fids & folder_ids:
            process_ids.add(pid)

    return {
        "is_global": False,
        "allowed_folder_ids": folder_ids,
        "allowed_process_ids": process_ids,
    }


def _user_covers_process(user: dict, process_id: str, folder_ids: list) -> bool:
    """Return True when a user's assigned scope includes the process."""
    assigned = set(user.get("assigned_project_ids", []) or [])

    # Admin with empty assignments is treated as global admin.
    from app.routes.auth import _has_role
    if _has_role(user, "admin") and not assigned:
        return True

    if not assigned:
        return False
    if process_id in assigned:
        return True
    return bool(set(folder_ids or []) & assigned)


def _public_trace_user(user: dict) -> dict:
    from app.routes.auth import _get_user_roles, _primary_role
    return {
        "id": user.get("id"),
        "username": user.get("username"),
        "roles": _get_user_roles(user),
        "role": _primary_role(user),
        "assigned_project_ids": user.get("assigned_project_ids", []),
        "created_at": user.get("created_at"),
    }


# ───────────────────────────────────────────────
# Subscriptions
# ───────────────────────────────────────────────

@router.get("/subscriptions")
def list_subscriptions(
    scope_type: str = Query(default=None),
    scope_id: str = Query(default=None),
):
    subs = list(SUBSCRIPTIONS_DB.values())
    if scope_type:
        subs = [s for s in subs if s.get("scope_type") == scope_type]
    if scope_id:
        subs = [s for s in subs if s.get("scope_id") == scope_id]
    return subs


@router.post("/subscriptions")
def create_subscription(payload: dict = Body(...)):
    """
    Expected body:
    {
        "scope_type": "folder" | "process" | "global",
        "scope_id": "<node_id or process_id — omit for global>",
        "provider": "local",            // local | azure_blob | gcs | s3
        "config": { "base_path": "..." },
        "active": true
    }
    """
    scope_type = payload.get("scope_type")
    if scope_type not in ("folder", "process", "global"):
        raise HTTPException(status_code=400, detail="scope_type debe ser folder, process o global")
    provider = payload.get("provider")
    if not provider:
        raise HTTPException(status_code=400, detail="provider requerido")

    sub_id = str(uuid.uuid4())
    sub = {
        "id": sub_id,
        "scope_type": scope_type,
        "scope_id": payload.get("scope_id", ""),
        "provider": provider,
        "config": payload.get("config", {}),
        "active": payload.get("active", True),
        "created_at": datetime.now(_SCL).isoformat(timespec="seconds"),
    }
    SUBSCRIPTIONS_DB[sub_id] = sub
    save_subscriptions_state()
    return sub


@router.put("/subscriptions/{sub_id}")
def update_subscription(sub_id: str, payload: dict = Body(...)):
    sub = SUBSCRIPTIONS_DB.get(sub_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Suscripción no encontrada")
    allowed = {"provider", "config", "active", "scope_type", "scope_id"}
    for key in allowed:
        if key in payload:
            sub[key] = payload[key]
    sub["updated_at"] = datetime.now(_SCL).isoformat(timespec="seconds")
    save_subscriptions_state()
    return sub


@router.delete("/subscriptions/{sub_id}")
def delete_subscription(sub_id: str):
    if sub_id not in SUBSCRIPTIONS_DB:
        raise HTTPException(status_code=404, detail="Suscripción no encontrada")
    del SUBSCRIPTIONS_DB[sub_id]
    save_subscriptions_state()
    return {"status": "deleted", "id": sub_id}


# ───────────────────────────────────────────────
# Delivery Jobs
# ───────────────────────────────────────────────

@router.get("/delivery-jobs")
def list_delivery_jobs(
    execution_id: str = Query(default=None),
    process_id: str = Query(default=None),
    status: str = Query(default=None),
    limit: int = Query(default=50, le=500),
):
    jobs = list(reversed(DELIVERY_JOBS_DB))  # most recent first
    if execution_id:
        jobs = [j for j in jobs if j.get("execution_id") == execution_id]
    if process_id:
        jobs = [j for j in jobs if j.get("process_id") == process_id]
    if status:
        jobs = [j for j in jobs if j.get("status") == status]
    return jobs[:limit]


# ───────────────────────────────────────────────
# Artifacts
# ───────────────────────────────────────────────

@router.get("/artifacts")
def list_artifacts(
    execution_id: str = Query(default=None),
    delivery_job_id: str = Query(default=None),
    limit: int = Query(default=100, le=1000),
):
    arts = list(reversed(ARTIFACTS_DB))
    if execution_id:
        arts = [a for a in arts if a.get("execution_id") == execution_id]
    if delivery_job_id:
        arts = [a for a in arts if a.get("delivery_job_id") == delivery_job_id]
    return arts[:limit]


# ───────────────────────────────────────────────
# Summary / health
# ───────────────────────────────────────────────

@router.get("/summary")
def admin_summary():
    total_subs = len(SUBSCRIPTIONS_DB)
    active_subs = sum(1 for s in SUBSCRIPTIONS_DB.values() if s.get("active", True))
    total_jobs = len(DELIVERY_JOBS_DB)
    ok_jobs = sum(1 for j in DELIVERY_JOBS_DB if j.get("status") == "completed")
    error_jobs = sum(1 for j in DELIVERY_JOBS_DB if j.get("status") == "partial")
    total_artifacts = len(ARTIFACTS_DB)
    return {
        "subscriptions": {"total": total_subs, "active": active_subs},
        "delivery_jobs": {"total": total_jobs, "completed": ok_jobs, "partial": error_jobs},
        "artifacts": {"total": total_artifacts},
    }


@router.get("/commitment-monitor")
def commitment_monitor(
    scope_id: str = Query(default=None),
    process_id: str = Query(default=None),
    status: str = Query(default=None),
    user: str = Query(default=None),
    include_without_schedule: bool = Query(default=True),
):
    """
    General monitoring for commitment compliance by process.

    Filters:
      - scope_id: any folder node id in the process ancestry
      - process_id: exact process
      - status: cumplido | proximo | atrasado | sin_compromiso
      - user: username substring in last execution or user stats
    """
    from app.routes.upload import FILES_DB
    from app.routes.rules import _get_folder_ids, _get_folder_path

    now = datetime.now(_SCL)
    items = []
    for pid, record in FILES_DB.items():
        if process_id and pid != process_id:
            continue

        folder_ids = _get_folder_ids(record.get("project_id"))
        if scope_id and scope_id not in folder_ids:
            continue

        row = _build_process_monitor_row(pid, record, now)
        row["folder_ids"] = folder_ids
        row["folder_path"] = _get_folder_path(record.get("project_id"))

        if not include_without_schedule and row["monitor_status"] == "sin_compromiso":
            continue
        if status and row["monitor_status"] != status:
            continue

        if user:
            u = user.lower()
            matched_last = (row.get("last_execution", {}).get("uploaded_by") or "").lower().find(u) >= 0
            matched_on_time = any(u in (x.get("user", "").lower()) for x in row.get("users", {}).get("on_time", []))
            matched_late = any(u in (x.get("user", "").lower()) for x in row.get("users", {}).get("late", []))
            matched_configuradores = any(u in (x or "").lower() for x in row.get("configuradores", []))
            matched_responsables = any(u in (x or "").lower() for x in row.get("responsables", []))
            if not (matched_last or matched_on_time or matched_late or matched_configuradores or matched_responsables):
                continue

        items.append(row)

    severity_order = {"atrasado": 0, "proximo": 1, "cumplido": 2, "sin_compromiso": 3}
    items.sort(
        key=lambda i: (
            severity_order.get(i.get("monitor_status"), 99),
            i.get("next_due_at") or "9999-99-99T99:99:99",
            i.get("process_name") or "",
        )
    )

    totals = {
        "total": len(items),
        "cumplido": sum(1 for i in items if i.get("monitor_status") == "cumplido"),
        "proximo": sum(1 for i in items if i.get("monitor_status") == "proximo"),
        "atrasado": sum(1 for i in items if i.get("monitor_status") == "atrasado"),
        "sin_compromiso": sum(1 for i in items if i.get("monitor_status") == "sin_compromiso"),
    }

    user_on_time = {}
    user_late = {}
    for it in items:
        for d in it.get("users", {}).get("on_time", []):
            who = d.get("user")
            user_on_time[who] = user_on_time.get(who, 0) + d.get("count", 0)
        for d in it.get("users", {}).get("late", []):
            who = d.get("user")
            user_late[who] = user_late.get(who, 0) + d.get("count", 0)

    return {
        "generated_at": now.isoformat(timespec="seconds"),
        "filters": {
            "scope_id": scope_id,
            "process_id": process_id,
            "status": status,
            "user": user,
            "include_without_schedule": include_without_schedule,
        },
        "totals": totals,
        "top_users": {
            "on_time": [{"user": u, "count": c} for u, c in sorted(user_on_time.items(), key=lambda x: x[1], reverse=True)[:10]],
            "late": [{"user": u, "count": c} for u, c in sorted(user_late.items(), key=lambda x: x[1], reverse=True)[:10]],
        },
        "items": items,
    }


@router.get("/role-traceability")
def role_traceability(
    scope_id: str = Query(default=None),
    process_id: str = Query(default=None),
    role: str = Query(default=None),
    user: str = Query(default=None),
    authorization: Optional[str] = Header(None),
):
    """
    Role traceability across folders/processes, scoped to admin visibility.

    Filters:
      - scope_id: folder node id in process ancestry
      - process_id: exact process id
      - role: admin | configurador | responsable
      - user: username substring
    """
    from app.routes.auth import _get_user_by_token
    from app.db.user_store import USERS_DB
    from app.routes.upload import FILES_DB
    from app.routes.rules import _get_folder_ids, _get_folder_path
    from app.routes.projects import PROJECTS_DB, get_config

    caller = _get_user_by_token(authorization)
    if caller.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Solo administradores pueden ver trazabilidad")
    allowed_roles = {"admin", "configurador", "responsable"}
    if role and role not in allowed_roles:
        raise HTTPException(status_code=400, detail="role debe ser admin, configurador o responsable")

    scope = _resolve_admin_scope(caller)
    level_names = get_config().get("project_level_names", [])

    # Flat folder catalog for navigation (already scope-filtered for caller)
    folder_nodes = []

    def _walk(node, depth: int, anc_ids: list, anc_names: list):
        ids = anc_ids + [node.id]
        names = anc_names + [node.name]
        if (not scope["is_global"]) and node.id not in scope["allowed_folder_ids"]:
            # Don't include branches outside caller scope.
            return
        folder_nodes.append({
            "id": node.id,
            "name": node.name,
            "level": depth,
            "level_name": level_names[depth - 1] if depth - 1 < len(level_names) else f"Nivel {depth}",
            "path_ids": ids,
            "path_names": names,
            "full_path": " / ".join(names),
        })
        for ch in getattr(node, "children", []):
            _walk(ch, depth + 1, ids, names)

    for root in PROJECTS_DB.values():
        _walk(root, 1, [], [])

    users = [_public_trace_user(u) for u in USERS_DB.values()]
    if role:
        users = [u for u in users if role in u.get("roles", [u.get("role", "")])]
    if user:
        ul = user.lower()
        users = [u for u in users if ul in (u.get("username") or "").lower()]

    users_by_id = {u["id"]: u for u in users}

    process_items = []
    for pid, rec in FILES_DB.items():
        if process_id and pid != process_id:
            continue

        folder_ids = _get_folder_ids(rec.get("project_id")) or []
        if scope_id and scope_id not in folder_ids:
            continue
        if (not scope["is_global"]) and pid not in scope["allowed_process_ids"]:
            continue

        assigned = {"admin": [], "configurador": [], "responsable": []}
        for u in users_by_id.values():
            if _user_covers_process(u, pid, folder_ids):
                for r in u.get("roles", [u.get("role", "responsable")]):
                    if r in assigned:
                        assigned[r].append(u)

        if role:
            for rk in ["admin", "configurador", "responsable"]:
                if rk != role:
                    assigned[rk] = []

        if user:
            # If user filter is present, keep only processes where at least one role match exists.
            if not (assigned["admin"] or assigned["configurador"] or assigned["responsable"]):
                continue

        monitor_row = _build_process_monitor_row(pid, rec, datetime.now(_SCL))

        process_items.append({
            "process_id": pid,
            "process_name": rec.get("process_name") or rec.get("latest_input_name") or pid,
            "project_id": rec.get("project_id"),
            "folder_ids": folder_ids,
            "folder_path": _get_folder_path(rec.get("project_id")) or [],
            "roles": {
                "admin": assigned["admin"],
                "configurador": assigned["configurador"],
                "responsable": assigned["responsable"],
            },
            "counts": {
                "admin": len(assigned["admin"]),
                "configurador": len(assigned["configurador"]),
                "responsable": len(assigned["responsable"]),
            },
            # Compliance data from commitment monitor
            "monitor_status": monitor_row.get("monitor_status"),
            "monitor_status_label": monitor_row.get("monitor_status_label"),
            "next_due_at": monitor_row.get("next_due_at"),
            "last_execution": monitor_row.get("last_execution"),
            "stats": monitor_row.get("stats"),
            "commitment_schedule": monitor_row.get("commitment_schedule"),
        })

    process_items.sort(key=lambda p: ((p.get("folder_path") or ["zz"]), p.get("process_name") or ""))

    # Folder-level aggregate counts (for level navigation)
    folder_aggregate = []
    for node in folder_nodes:
        node_pid = node.get("id")
        scoped = [p for p in process_items if node_pid in (p.get("folder_ids") or [])]
        admins = {u["id"] for p in scoped for u in p.get("roles", {}).get("admin", [])}
        confs = {u["id"] for p in scoped for u in p.get("roles", {}).get("configurador", [])}
        resps = {u["id"] for p in scoped for u in p.get("roles", {}).get("responsable", [])}
        status_counts = {"cumplido": 0, "proximo": 0, "atrasado": 0, "sin_compromiso": 0}
        for p in scoped:
            s = p.get("monitor_status") or "sin_compromiso"
            status_counts[s] = status_counts.get(s, 0) + 1
        compliance_rates = [p["stats"]["compliance_rate"] for p in scoped if p.get("stats") and p["stats"].get("compliance_rate") is not None]
        folder_aggregate.append({
            "id": node_pid,
            "full_path": node.get("full_path"),
            "level": node.get("level"),
            "level_name": node.get("level_name"),
            "process_count": len(scoped),
            "user_counts": {
                "admin": len(admins),
                "configurador": len(confs),
                "responsable": len(resps),
            },
            "status_counts": status_counts,
            "avg_compliance_rate": round(sum(compliance_rates) / len(compliance_rates), 1) if compliance_rates else None,
        })

    return {
        "filters": {
            "scope_id": scope_id,
            "process_id": process_id,
            "role": role,
            "user": user,
        },
        "scope": {
            "is_global": scope["is_global"],
            "assigned_project_ids": caller.get("assigned_project_ids", []),
        },
        "folders": folder_nodes,
        "folder_aggregate": folder_aggregate,
        "users": users,
        "processes": process_items,
    }


# ───────────────────────────────────────────────
# Debug / diagnostics
# ───────────────────────────────────────────────

@router.get("/folder-nodes")
def list_folder_nodes():
    """
    Return a flat list of all project-tree nodes so the frontend can
    build a folder-scope subscription picker.

    Each item:  { id, name, level, level_name, path_ids, path_names, full_path }
    """
    from app.routes.projects import PROJECTS_DB, get_config

    config = get_config()
    level_names: list = config.get("project_level_names", [])

    result = []

    def _walk(node, depth: int, ancestor_ids: list, ancestor_names: list):
        ids = ancestor_ids + [node.id]
        names = ancestor_names + [node.name]
        lname = level_names[depth - 1] if depth - 1 < len(level_names) else f"Nivel {depth}"
        result.append({
            "id": node.id,
            "name": node.name,
            "level": depth,
            "level_name": lname,
            "path_ids": ids,
            "path_names": names,
            "full_path": " / ".join(names),
        })
        for child in getattr(node, "children", []):
            _walk(child, depth + 1, ids, names)

    for root in PROJECTS_DB.values():
        _walk(root, 1, [], [])

    return result


@router.get("/debug/errors")
def get_dispatch_errors():
    """Return the last dispatch errors (engine ring-buffer)."""
    from app.services.output_delivery.engine import DISPATCH_ERRORS
    return list(reversed(DISPATCH_ERRORS))


@router.get("/debug/match/{process_id}")
def debug_match(process_id: str):
    """Show which subscriptions would fire for a given process_id."""
    from app.services.output_delivery.engine import _matching_subscriptions
    from app.services.output_delivery.contracts import OutputContract
    dummy = OutputContract(
        execution_id="debug",
        process_id=process_id,
        process_name="",
        folder_id=None,
        folder_path=[],
        folder_ids=[],
        sheet_name="",
        table_name="",
        columns=[],
        row_count=0,
        extraction_mode="range",
        timestamp="",
    )
    matched = _matching_subscriptions(dummy)
    return {
        "process_id": process_id,
        "all_subscriptions": list(SUBSCRIPTIONS_DB.values()),
        "matched_count": len(matched),
        "matched": matched,
    }


@router.post("/debug/redispatch/{execution_id}")
def redispatch_execution(execution_id: str):
    """
    Manually re-trigger delivery for a past execution.
    Re-applies the rule on the stored source data and dispatches to all matching sinks.
    Returns the dispatch result (including any errors).
    """
    from datetime import datetime as dt
    from app.routes.upload import FILES_DB
    from app.services.processor import apply_rules
    from app.services.output_delivery.engine import dispatch, _matching_subscriptions
    from app.services.output_delivery.contracts import OutputContract
    from app.routes.rules import _get_folder_path, serialize_result_df

    # Find the execution record
    execution = None
    process_record = None
    for pid, record in FILES_DB.items():
        for e in record.get("executions", []):
            if e.get("id") == execution_id:
                execution = e
                process_record = record
                process_id = pid
                break
        if execution:
            break

    if not execution:
        raise HTTPException(status_code=404, detail="Ejecución no encontrada")

    sheet_name = execution.get("sheet_name")
    rule = execution.get("rule")
    sheets_data = process_record.get("sheet_data") or {}

    if sheet_name not in sheets_data:
        raise HTTPException(status_code=400, detail=f"Hoja '{sheet_name}' no encontrada en datos del proceso")

    df = sheets_data[sheet_name].copy()
    df.columns = df.columns.map(str)

    try:
        result_df = apply_rules(df, rule)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error al re-aplicar regla: {str(exc)}")

    serialized = serialize_result_df(result_df)
    tables_df = result_df if isinstance(result_df, dict) else {"default": result_df}
    folder_path = _get_folder_path(process_record.get("project_id"))
    from app.routes.rules import _get_folder_ids
    folder_ids = _get_folder_ids(process_record.get("project_id"))

    dispatch_results = []
    for tname, tdf in tables_df.items():
        contract = OutputContract(
            execution_id=execution_id,
            process_id=process_id,
            process_name=process_record.get("process_name") or process_record.get("latest_input_name", ""),
            folder_id=process_record.get("project_id"),
            folder_path=folder_path,
            folder_ids=folder_ids,
            sheet_name=sheet_name,
            table_name=tname,
            columns=list(tdf.columns),
            row_count=len(tdf),
            extraction_mode=(rule or {}).get("extraction_mode", "range"),
            timestamp=datetime.now(_SCL).isoformat(timespec="seconds"),
            rule_version_id=execution.get("rule_version_id"),
            rule_version=execution.get("rule_version"),
            rule_config=rule,
            process_metadata=process_record.get("metadata", {}),
        )
        matched = _matching_subscriptions(contract)
        job = dispatch(contract, tdf)
        dispatch_results.append({
            "table_name": tname,
            "rows": len(tdf),
            "matched_subscriptions": len(matched),
            "job": job,
        })

    return {
        "execution_id": execution_id,
        "process_id": process_id,
        "sheet_name": sheet_name,
        "dispatch_results": dispatch_results,
    }


# ───────────────────────────────────────────────
# Reset endpoints
# ───────────────────────────────────────────────

@router.delete("/reset-project/{project_id}")
def reset_project(project_id: str, authorization: Optional[str] = Header(None)):
    """Delete all data related to a specific project (files, executions, rules)."""
    from app.routes.auth import _get_user_by_token
    from app.routes.upload import FILES_DB, save_files_state
    from app.routes.rules import EXECUTIONS_DB, save_executions_state
    from app.routes.projects import PROJECTS_DB, save_projects_state, find_node_by_id, find_parent_node
    
    caller = _get_user_by_token(authorization)
    from app.routes.auth import _has_role as _hr
    if not _hr(caller, "admin"):
        raise HTTPException(status_code=403, detail="Solo administradores pueden resetear proyectos")

    # Delete project folder structure (root or child node)
    if project_id in PROJECTS_DB:
        del PROJECTS_DB[project_id]
        save_projects_state()
    else:
        parent = find_parent_node(project_id)
        if parent is not None:
            parent.children = [c for c in parent.children if c.id != project_id]
            save_projects_state()

    # Delete all files/executions in this project
    files_to_delete = [f_id for f_id, f_rec in FILES_DB.items() if f_rec.get("project_id") == project_id]
    for f_id in files_to_delete:
        del FILES_DB[f_id]
    if files_to_delete:
        save_files_state()

    # Delete executions for files in this project
    execs_to_delete = [e for e in EXECUTIONS_DB if e.get("process_id") in files_to_delete]
    for e in execs_to_delete:
        EXECUTIONS_DB.remove(e)
    if execs_to_delete:
        save_executions_state()

    return {"status": "ok", "message": f"Proyecto {project_id} reseteado completamente"}


@router.delete("/reset-all")
def reset_all_data(authorization: Optional[str] = Header(None)):
    """Completely reset the application (DELETE ALL DATA except current admin user)."""
    from app.routes.auth import _get_user_by_token
    from app.routes.upload import FILES_DB, save_files_state
    from app.routes.rules import EXECUTIONS_DB, save_executions_state
    from app.routes.projects import PROJECTS_DB, save_projects_state
    from app.db.user_store import USERS_DB, SESSIONS_DB, PENDING_USERS_DB, save_users_state, save_sessions_state, save_pending_users_state
    from app.db.output_store import SUBSCRIPTIONS_DB, DELIVERY_JOBS_DB, ARTIFACTS_DB, save_subscriptions_state, save_delivery_jobs_state, save_artifacts_state
    
    caller = _get_user_by_token(authorization)
    from app.routes.auth import _has_role as _hr
    if not _hr(caller, "admin"):
        raise HTTPException(status_code=403, detail="Solo administradores pueden resetear la aplicación")

    admin_user_id = caller.get("id")

    # Clear projects
    PROJECTS_DB.clear()
    save_projects_state()

    # Clear files and executions
    FILES_DB.clear()
    save_files_state()

    EXECUTIONS_DB.clear()
    save_executions_state()

    # Clear users (except current admin)
    keep_users = {admin_user_id: USERS_DB.get(admin_user_id)} if admin_user_id in USERS_DB else {}
    USERS_DB.clear()
    USERS_DB.update(keep_users)
    save_users_state()

    # Keep current session
    SESSIONS_DB.clear()
    save_sessions_state()

    # Clear pending users
    PENDING_USERS_DB.clear()
    save_pending_users_state()

    # Clear delivery module
    SUBSCRIPTIONS_DB.clear()
    save_subscriptions_state()

    DELIVERY_JOBS_DB.clear()
    save_delivery_jobs_state()

    ARTIFACTS_DB.clear()
    save_artifacts_state()

    return {"status": "ok", "message": "Aplicación reseteada completamente"}
