from fastapi import APIRouter, HTTPException, Header
from typing import List, Optional
import json
import os
from datetime import datetime
import uuid
from app.models.project import ProjectNode, ProjectTree
from app.db.database import load_snapshot, save_snapshot

router = APIRouter(prefix="/projects", tags=["projects"])


def _get_role(authorization: Optional[str]) -> Optional[str]:
    """Resolve a Bearer token to the user's role, or None if unauthenticated."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization[7:]
    from app.db.user_store import SESSIONS_DB, USERS_DB
    uid = SESSIONS_DB.get(token)
    if not uid:
        return None
    user = USERS_DB.get(uid)
    return user["role"] if user else None


def _get_full_user(authorization: Optional[str]) -> Optional[dict]:
    """Resolve a Bearer token to the full user dict."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization[7:]
    from app.db.user_store import SESSIONS_DB, USERS_DB
    uid = SESSIONS_DB.get(token)
    if not uid:
        return None
    return USERS_DB.get(uid)


def _collect_all_ids(node: "ProjectNode") -> set:
    """Return the set of all node IDs in a subtree (node itself + all descendants)."""
    ids = {node.id}
    for child in node.children:
        ids |= _collect_all_ids(child)
    return ids


def _find_root_of_node(node_id: str) -> Optional["ProjectNode"]:
    """Return the root-level ProjectNode that contains node_id in its subtree."""
    for root in PROJECTS_DB.values():
        if node_id in _collect_all_ids(root):
            return root
    return None

PROJECTS_NAMESPACE = "projects"


# In-memory project store backed by persisted snapshots
PROJECTS_DB = load_snapshot(PROJECTS_NAMESPACE, dict)


def save_projects_state() -> None:
    save_snapshot(PROJECTS_NAMESPACE, PROJECTS_DB)


def _normalize_project_name(value: Optional[str]) -> str:
    return (value or "").strip().lower()


def _has_sibling_name_conflict(name: str, parent_id: Optional[str], exclude_id: Optional[str] = None) -> bool:
    target = _normalize_project_name(name)
    if not target:
        return False

    if parent_id:
        parent = find_node_by_id(parent_id)
        if not parent:
            return False
        siblings = parent.children
    else:
        siblings = list(PROJECTS_DB.values())

    for node in siblings:
        if exclude_id and node.id == exclude_id:
            continue
        if _normalize_project_name(node.name) == target:
            return True
    return False

def load_projects():
    """Return the current project snapshot."""
    return PROJECTS_DB

def get_config():
    """Load configuration to get max levels"""
    config_file = os.path.join(os.path.dirname(__file__), "../../config.json")
    try:
        with open(config_file, "r", encoding="utf-8") as f:
            loaded_config = json.load(f)
    except Exception:
        return {
            "project_max_levels": 4,
            "project_level_names": ["Compañía", "Área", "Departamento", "Proyecto"],
            "project_level_allow_files": [False, False, False, True]
        }

    config = {
        "project_max_levels": 4,
        "project_level_names": ["Compañía", "Área", "Departamento", "Proyecto"],
        "project_level_allow_files": [False, False, False, True],
    }
    if isinstance(loaded_config, dict):
        config.update(loaded_config)

    max_levels = config.get("project_max_levels", 4)
    if len(config.get("project_level_names", [])) != max_levels:
        default_names = ["Nivel 1", "Nivel 2", "Nivel 3", "Nivel 4", "Nivel 5", "Nivel 6", "Nivel 7", "Nivel 8", "Nivel 9", "Nivel 10"]
        config["project_level_names"] = default_names[:max_levels]
    if len(config.get("project_level_allow_files", [])) != max_levels:
        config["project_level_allow_files"] = [False] * (max_levels - 1) + [True]

    return config

def find_node_by_id(node_id: str, node: Optional[ProjectNode] = None) -> Optional[ProjectNode]:
    """Recursively find a node by ID in the tree"""
    if node is None:
        for root in PROJECTS_DB.values():
            result = find_node_by_id(node_id, root)
            if result:
                return result
        return None
    
    if node.id == node_id:
        return node
    
    for child in node.children:
        result = find_node_by_id(node_id, child)
        if result:
            return result
    
    return None

def find_parent_node(node_id: str, search_node: Optional[ProjectNode] = None) -> Optional[ProjectNode]:
    """Find the parent of a node by searching the tree"""
    if search_node is None:
        for root in PROJECTS_DB.values():
            result = find_parent_node(node_id, root)
            if result:
                return result
        return None
    
    for child in search_node.children:
        if child.id == node_id:
            return search_node
        result = find_parent_node(node_id, child)
        if result:
            return result
    
    return None

@router.get("/")
async def get_all_projects(authorization: Optional[str] = Header(None)):
    """Get all root projects. Configuradors only see their assigned projects."""
    config = get_config()
    user = _get_full_user(authorization)
    if user and user["role"] == "configurador":
        assigned = set(user.get("assigned_project_ids", []))
        projects = [p for p in PROJECTS_DB.values() if p.id in assigned]
    else:
        projects = list(PROJECTS_DB.values())

    return {
        "projects": projects,
        "count": len(projects),
        "max_levels": config.get("project_max_levels", 4),
        "level_names": config.get("project_level_names", []),
        "level_allow_files": config.get("project_level_allow_files", [])
    }

@router.post("/")
async def create_project(
    name: str,
    parent_id: Optional[str] = None,
    authorization: Optional[str] = Header(None),
):
    """Create a new project node. Root nodes: admin only. Child nodes: admin or configurador."""
    role = _get_role(authorization)
    if role == "responsable":
        raise HTTPException(status_code=403, detail="Los responsables no pueden crear proyectos")
    if not parent_id and role not in ("admin", None):
        # non-admin non-anonymous trying to create root → only admin allowed
        # (None = unauthenticated: allow for dev convenience)
        raise HTTPException(status_code=403, detail="Solo el administrador puede crear proyectos raíz")
    if not parent_id and role == "configurador":
        raise HTTPException(status_code=403, detail="Solo el administrador puede crear proyectos raíz")

    # Configurador can only create children within their assigned projects
    if parent_id and role == "configurador":
        user = _get_full_user(authorization)
        if user:
            root = _find_root_of_node(parent_id)
            assigned = set(user.get("assigned_project_ids", []))
            if root and root.id not in assigned:
                raise HTTPException(status_code=403, detail="No tienes acceso a este proyecto")

    if _has_sibling_name_conflict(name, parent_id):
        raise HTTPException(status_code=409, detail="Ya existe un proyecto con ese nombre en este nivel")

    config = get_config()
    max_levels = config.get("project_max_levels", 5)

    if parent_id:
        parent_node = find_node_by_id(parent_id)
        if not parent_node:
            raise HTTPException(status_code=404, detail="Carpeta padre no encontrada")
        if parent_node.level >= max_levels:
            raise HTTPException(status_code=400, detail=f"Máximo {max_levels} niveles de profundidad permitidos")
        new_node = ProjectNode(
            id=str(uuid.uuid4()),
            name=name,
            level=parent_node.level + 1,
            parent_id=parent_id,
            created_at=datetime.now().isoformat()
        )
        parent_node.children.append(new_node)
    else:
        new_node = ProjectNode(
            id=str(uuid.uuid4()),
            name=name,
            level=1,
            created_at=datetime.now().isoformat()
        )
        PROJECTS_DB[new_node.id] = new_node

    save_projects_state()

    return {"status": "success", "project": new_node}

@router.get("/{project_id}")
async def get_project(project_id: str):
    """Get a specific project by ID"""
    node = find_node_by_id(project_id)
    if not node:
        raise HTTPException(status_code=404, detail="Project not found")
    
    return {
        "project": node
    }

@router.put("/{project_id}")
async def update_project(
    project_id: str,
    name: Optional[str] = None,
    authorization: Optional[str] = Header(None),
):
    """Rename a node. Admin or configurador only."""
    role = _get_role(authorization)
    if role == "responsable":
        raise HTTPException(status_code=403, detail="Sin permiso para renombrar")
    node = find_node_by_id(project_id)
    if not node:
        raise HTTPException(status_code=404, detail="Nodo no encontrado")
    if name:
        if _has_sibling_name_conflict(name, node.parent_id, exclude_id=node.id):
            raise HTTPException(status_code=409, detail="Ya existe un proyecto con ese nombre en este nivel")
        node.name = name
        save_projects_state()
    return {"status": "success", "project": node}

@router.delete("/{project_id}")
async def delete_project(
    project_id: str,
    cascade: bool = True,
    authorization: Optional[str] = Header(None),
):
    """Delete a project node. Admin or configurador only."""
    role = _get_role(authorization)
    if role == "responsable":
        raise HTTPException(status_code=403, detail="Sin permiso para eliminar")
    # Root nodes: only admin can delete
    if project_id in PROJECTS_DB and role == "configurador":
        raise HTTPException(status_code=403, detail="Solo el administrador puede eliminar proyectos raíz")
    node = find_node_by_id(project_id)
    if not node:
        raise HTTPException(status_code=404, detail="Nodo no encontrado")

    # If this is a root project
    if project_id in PROJECTS_DB:
        deleted_count = 1 + len(_count_descendants(node))
        del PROJECTS_DB[project_id]
        save_projects_state()
        return {
            "status": "success",
            "deleted_nodes": deleted_count,
            "message": f"Deleted project and {deleted_count - 1} children"
        }
    
    # If this is a child project
    parent_node = find_parent_node(project_id)
    if not parent_node:
        raise HTTPException(status_code=400, detail="Cannot find parent node")
    
    deleted_count = 1 + len(_count_descendants(node))
    parent_node.children = [child for child in parent_node.children if child.id != project_id]
    save_projects_state()
    
    return {
        "status": "success",
        "deleted_nodes": deleted_count,
        "message": f"Deleted project and {deleted_count - 1} children"
    }

def _count_descendants(node: ProjectNode) -> List[ProjectNode]:
    """Count all descendants of a node"""
    descendants = []
    for child in node.children:
        descendants.append(child)
        descendants.extend(_count_descendants(child))
    return descendants

@router.post("/{project_id}/files/{file_id}")
async def add_file_to_project(project_id: str, file_id: str):
    """Add a file to a project"""
    node = find_node_by_id(project_id)
    if not node:
        raise HTTPException(status_code=404, detail="Project not found")
    
    if file_id not in node.files:
        node.files.append(file_id)
        save_projects_state()
    
    return {
        "status": "success",
        "project": node
    }

@router.delete("/{project_id}/files/{file_id}")
async def remove_file_from_project(project_id: str, file_id: str):
    """Remove a file from a project"""
    node = find_node_by_id(project_id)
    if not node:
        raise HTTPException(status_code=404, detail="Project not found")
    
    node.files = [f for f in node.files if f != file_id]
    save_projects_state()
    
    return {
        "status": "success",
        "project": node
    }
