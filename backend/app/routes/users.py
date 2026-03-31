from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Optional, List
import uuid
from datetime import datetime

from app.db.user_store import (
    USERS_DB,
    PENDING_USERS_DB,
    _hash_password,
    save_pending_users_state,
    save_users_state,
)
from app.routes.auth import _get_user_by_token, _public_user

router = APIRouter()


def _collect_accessible_ids(node) -> set:
    """Return ALL IDs reachable from a project node: folder IDs + file/process IDs."""
    ids = {node.id}
    ids.update(getattr(node, "files", []))
    for child in getattr(node, "children", []):
        ids |= _collect_accessible_ids(child)
    return ids


class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: str  # "admin" | "configurador" | "responsable"
    assigned_project_ids: List[str] = []


class UpdateUserRequest(BaseModel):
    role: Optional[str] = None
    password: Optional[str] = None
    assigned_project_ids: Optional[List[str]] = None


VALID_ROLES = ("admin", "configurador", "responsable")


def _require_admin(authorization: Optional[str]) -> dict:
    user = _get_user_by_token(authorization)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Solo administradores pueden gestionar usuarios")
    return user


@router.get("/")
def list_users(authorization: Optional[str] = Header(None)):
    caller = _get_user_by_token(authorization)
    if caller["role"] == "admin":
        return [_public_user(u) for u in USERS_DB.values()]
    if caller["role"] == "configurador":
        return [_public_user(u) for u in USERS_DB.values() if u["role"] == "responsable"]
    raise HTTPException(status_code=403, detail="Sin permiso")


@router.post("/")
def create_user(body: CreateUserRequest, authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Rol inválido. Debe ser: admin, configurador o responsable")
    if any(u["username"] == body.username for u in USERS_DB.values()):
        raise HTTPException(status_code=400, detail="El nombre de usuario ya existe")
    user_id = str(uuid.uuid4())
    USERS_DB[user_id] = {
        "id": user_id,
        "username": body.username,
        "password_hash": _hash_password(body.password),
        "role": body.role,
        "assigned_project_ids": body.assigned_project_ids,
        "created_at": datetime.utcnow().isoformat(),
    }
    save_users_state()
    return _public_user(USERS_DB[user_id])


@router.put("/{user_id}")
def update_user(user_id: str, body: UpdateUserRequest, authorization: Optional[str] = Header(None)):
    caller = _get_user_by_token(authorization)
    user = USERS_DB.get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    if caller["role"] == "configurador":
        # Configuradores can only update assigned_project_ids for responsable users
        if user["role"] != "responsable":
            raise HTTPException(status_code=403, detail="El configurador solo puede asignar proyectos a responsables")
        if body.role is not None or body.password is not None:
            raise HTTPException(status_code=403, detail="El configurador solo puede modificar las asignaciones de carpetas")
        if body.assigned_project_ids is not None:
            from app.routes.projects import PROJECTS_DB
            # Build the set of all node IDs + process IDs reachable from configurador's assigned projects
            accessible: set = set()
            for pid in caller.get("assigned_project_ids", []):
                root = PROJECTS_DB.get(pid)
                if root:
                    accessible |= _collect_accessible_ids(root)
            # Preserve any existing assignments outside configurador's scope
            current_ids = set(user.get("assigned_project_ids", []))
            preserved = current_ids - accessible
            allowed_new = set(body.assigned_project_ids) & accessible
            user["assigned_project_ids"] = list(preserved | allowed_new)
        save_users_state()
        return _public_user(user)

    # Admin path
    if caller["role"] != "admin":
        raise HTTPException(status_code=403, detail="Sin permiso")
    if body.role is not None:
        if body.role not in VALID_ROLES:
            raise HTTPException(status_code=400, detail="Rol inválido")
        user["role"] = body.role
    if body.password is not None:
        if len(body.password) < 4:
            raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 4 caracteres")
        user["password_hash"] = _hash_password(body.password)
    if body.assigned_project_ids is not None:
        user["assigned_project_ids"] = body.assigned_project_ids
    save_users_state()
    return _public_user(user)


@router.delete("/{user_id}")
def delete_user(user_id: str, authorization: Optional[str] = Header(None)):
    current = _require_admin(authorization)
    if user_id == current["id"]:
        raise HTTPException(status_code=400, detail="No puedes eliminar tu propio usuario")
    if user_id not in USERS_DB:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    del USERS_DB[user_id]
    save_users_state()
    return {"success": True}


# ── Pending users (self-registration flow) ────────────────────────────────────

class ApprovePendingRequest(BaseModel):
    role: str
    assigned_project_ids: List[str] = []


@router.get("/pending")
def list_pending(authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    return list(PENDING_USERS_DB.values())


@router.post("/pending/{pending_id}/approve")
def approve_pending(
    pending_id: str,
    body: ApprovePendingRequest,
    authorization: Optional[str] = Header(None),
):
    _require_admin(authorization)
    pending = PENDING_USERS_DB.get(pending_id)
    if not pending:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Rol inválido")
    # Don't allow duplicate email as username
    if any(u["username"] == pending["email"] for u in USERS_DB.values()):
        del PENDING_USERS_DB[pending_id]
        save_pending_users_state()
        raise HTTPException(status_code=409, detail="Ya existe un usuario con ese correo")
    user_id = str(uuid.uuid4())
    USERS_DB[user_id] = {
        "id": user_id,
        "username": pending["email"],
        "password_hash": pending["password_hash"],
        "role": body.role,
        "assigned_project_ids": body.assigned_project_ids,
        "created_at": datetime.now().isoformat(timespec="seconds"),
    }
    del PENDING_USERS_DB[pending_id]
    save_users_state()
    save_pending_users_state()
    return _public_user(USERS_DB[user_id])


@router.delete("/pending/{pending_id}")
def reject_pending(pending_id: str, authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    if pending_id not in PENDING_USERS_DB:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")
    del PENDING_USERS_DB[pending_id]
    save_pending_users_state()
    return {"success": True}


# ── Pre-registration (configurador creates a responsable slot) ────────────────

class PreRegisterRequest(BaseModel):
    username: str
    assigned_project_ids: List[str] = []


@router.post("/preregister")
def preregister_user(body: PreRegisterRequest, authorization: Optional[str] = Header(None)):
    """Configurador (or admin) pre-registers a responsable username.
    On first login the user sets their own password and immediately gets a session.
    """
    caller = _get_user_by_token(authorization)
    if caller["role"] not in ("admin", "configurador"):
        raise HTTPException(status_code=403, detail="Sin permiso")

    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="El nombre de usuario es obligatorio")
    if any(u["username"] == username for u in USERS_DB.values()):
        raise HTTPException(status_code=400, detail="Ya existe un usuario con ese nombre")

    assigned_ids = list(body.assigned_project_ids)
    if caller["role"] == "configurador":
        from app.routes.projects import PROJECTS_DB
        accessible: set = set()
        for pid in caller.get("assigned_project_ids", []):
            root = PROJECTS_DB.get(pid)
            if root:
                accessible |= _collect_accessible_ids(root)
        assigned_ids = [x for x in assigned_ids if x in accessible]

    user_id = str(uuid.uuid4())
    USERS_DB[user_id] = {
        "id": user_id,
        "username": username,
        "password_hash": "",
        "role": "responsable",
        "assigned_project_ids": assigned_ids,
        "preregistered": True,
        "created_at": datetime.utcnow().isoformat(),
    }
    save_users_state()
    return _public_user(USERS_DB[user_id])
