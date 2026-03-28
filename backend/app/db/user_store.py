import hashlib
import uuid
from datetime import datetime

# In-memory stores
USERS_DB = {}        # { user_id: user_dict }
SESSIONS_DB = {}     # { token_str: user_id }
PENDING_USERS_DB = {}  # { pending_id: { id, email, password_hash, requested_at, last_attempt } }


def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


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


_seed()
