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


def _seed():
    for username, role in [("admin", "admin"), ("configurador", "configurador"), ("responsable", "responsable")]:
        uid = str(uuid.uuid4())
        USERS_DB[uid] = {
            "id": uid,
            "username": username,
            "password_hash": _hash_password(username),  # contraseña = nombre de usuario
            "role": role,
            "assigned_project_ids": [],
            "created_at": datetime.utcnow().isoformat(),
        }


if not state_exists(USERS_NAMESPACE):
    _seed()
    save_users_state()
    save_sessions_state()
    save_pending_users_state()
