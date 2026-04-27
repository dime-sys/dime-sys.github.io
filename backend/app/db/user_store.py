import hashlib
import uuid
from datetime import datetime

from app.db.database import load_snapshot, save_snapshot, state_exists


USERS_NAMESPACE = "users"
SESSIONS_NAMESPACE = "sessions"
PENDING_USERS_NAMESPACE = "pending_users"


# In-memory stores backed by persisted snapshots
USERS_DB = load_snapshot(USERS_NAMESPACE, dict)        # { user_id: user_dict }
SESSIONS_DB = load_snapshot(SESSIONS_NAMESPACE, dict)  # { token_str: user_id }
PENDING_USERS_DB = load_snapshot(PENDING_USERS_NAMESPACE, dict)  # { pending_id: { id, email, password_hash, requested_at, last_attempt } }


def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def save_users_state() -> None:
    save_snapshot(USERS_NAMESPACE, USERS_DB)


def save_sessions_state() -> None:
    save_snapshot(SESSIONS_NAMESPACE, SESSIONS_DB)


def save_pending_users_state() -> None:
    save_snapshot(PENDING_USERS_NAMESPACE, PENDING_USERS_DB)


def _normalize_roles(user: dict) -> list[str]:
    roles = user.get("roles")
    if isinstance(roles, list):
        return [role for role in roles if role]
    legacy_role = user.get("role")
    return [legacy_role] if legacy_role else []


def _ensure_default_user(username: str, role: str) -> bool:
    existing = next((user for user in USERS_DB.values() if user.get("username") == username), None)

    if existing:
        changed = False
        roles = _normalize_roles(existing)
        if role not in roles:
            roles.append(role)
            existing["roles"] = roles
            changed = True
        if not existing.get("password_hash"):
            existing["password_hash"] = _hash_password(username)
            changed = True
        if "assigned_project_ids" not in existing:
            existing["assigned_project_ids"] = []
            changed = True
        if not existing.get("created_at"):
            existing["created_at"] = datetime.utcnow().isoformat()
            changed = True
        return changed

    uid = str(uuid.uuid4())
    USERS_DB[uid] = {
        "id": uid,
        "username": username,
        "password_hash": _hash_password(username),  # contraseña = nombre de usuario
        "roles": [role],
        "assigned_project_ids": [],
        "created_at": datetime.utcnow().isoformat(),
    }
    return True


def _seed_defaults_if_needed() -> bool:
    changed = False
    for username, role in [("admin", "admin"), ("configurador", "configurador"), ("responsable", "responsable")]:
        changed = _ensure_default_user(username, role) or changed
    return changed


if not state_exists(USERS_NAMESPACE):
    _seed_defaults_if_needed()
    save_users_state()
    save_sessions_state()
    save_pending_users_state()
elif _seed_defaults_if_needed():
    save_users_state()
