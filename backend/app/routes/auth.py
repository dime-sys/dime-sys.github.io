from fastapi import APIRouter, HTTPException, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
import uuid
from datetime import datetime

from app.db.user_store import USERS_DB, SESSIONS_DB, PENDING_USERS_DB, _hash_password

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class CheckRequest(BaseModel):
    identifier: str


@router.post("/check")
def check_identity(body: CheckRequest):
    """Pre-flight check: is this identifier registered, pending, or new?"""
    value = body.identifier.strip().lower()
    original = body.identifier.strip()
    user = next(
        (u for u in USERS_DB.values()
         if u["username"] == value or u["username"] == original),
        None,
    )
    if user:
        return {"status": "registered"}
    if _is_email(value):
        existing = next(
            (p for p in PENDING_USERS_DB.values() if p["email"] == value), None
        )
        if existing:
            return {"status": "pending"}
        return {"status": "new"}
    return {"status": "registered"}


def _is_email(value: str) -> bool:
    parts = value.split("@")
    return len(parts) == 2 and "." in parts[1]


def _get_user_by_token(authorization: Optional[str]) -> dict:
    """Resolve a Bearer token to its user dict, raising 401 on failure."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token no proporcionado")
    token = authorization[7:]
    user_id = SESSIONS_DB.get(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")
    user = USERS_DB.get(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no encontrado")
    return user


def _public_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "username": user["username"],
        "role": user["role"],
        "assigned_project_ids": user.get("assigned_project_ids", []),
        "created_at": user.get("created_at"),
        "preregistered": user.get("preregistered", False),
    }


@router.post("/login")
def login(body: LoginRequest):
    # 1. Try to match a registered user (by username or by email stored as username)
    user = next(
        (u for u in USERS_DB.values()
         if u["username"] == body.username or u["username"] == body.username.lower()),
        None,
    )

    # 1a. Pre-registered user: first login activates the account with the entered password
    if user and user.get("preregistered"):
        if len(body.password) < 4:
            raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 4 caracteres")
        user["password_hash"] = _hash_password(body.password)
        user.pop("preregistered", None)
        token = str(uuid.uuid4())
        SESSIONS_DB[token] = user["id"]
        return {"token": token, "user": _public_user(user)}

    if user and user["password_hash"] == _hash_password(body.password):
        token = str(uuid.uuid4())
        SESSIONS_DB[token] = user["id"]
        return {"token": token, "user": _public_user(user)}

    # 2. If it looks like an email and was not found as a registered user → pending flow
    if _is_email(body.username):
        email = body.username.lower()
        pw_hash = _hash_password(body.password)
        # Find or create pending entry
        existing = next(
            (p for p in PENDING_USERS_DB.values() if p["email"] == email), None
        )
        if existing:
            raise HTTPException(status_code=401, detail="Credenciales inválidas")
        else:
            pid = str(uuid.uuid4())
            PENDING_USERS_DB[pid] = {
                "id": pid,
                "email": email,
                "password_hash": pw_hash,
                "requested_at": datetime.now().isoformat(timespec="seconds"),
                "last_attempt": datetime.now().isoformat(timespec="seconds"),
            }
        return JSONResponse(
            status_code=202,
            content={
                "status": "pending_approval",
                "detail": "Tu solicitud de acceso ha sido enviada al administrador. Podrás ingresar una vez que te asignen un rol.",
            },
        )

    raise HTTPException(status_code=401, detail="Credenciales inválidas")


@router.get("/me")
def me(authorization: Optional[str] = Header(None)):
    user = _get_user_by_token(authorization)
    return _public_user(user)


@router.post("/logout")
def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
        SESSIONS_DB.pop(token, None)
    return {"success": True}
