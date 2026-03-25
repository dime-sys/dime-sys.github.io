from fastapi import APIRouter, HTTPException
from typing import List, Optional
import json
import os
from datetime import datetime
import uuid
from app.models.project import ProjectNode, ProjectTree

router = APIRouter(prefix="/projects", tags=["projects"])

# In-memory project store
PROJECTS_DB = {}

def load_projects():
    """Load projects from file (placeholder for future persistence)"""
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
async def get_all_projects():
    """Get all root projects (tree structure)"""
    config = get_config()
    projects = list(PROJECTS_DB.values())
    
    return {
        "projects": projects,
        "count": len(projects),
        "max_levels": config.get("project_max_levels", 4),
        "level_names": config.get("project_level_names", []),
        "level_allow_files": config.get("project_level_allow_files", [])
    }

@router.post("/")
async def create_project(name: str, parent_id: Optional[str] = None):
    """Create a new project node"""
    config = get_config()
    max_levels = config.get("project_max_levels", 4)
    
    if parent_id:
        parent_node = find_node_by_id(parent_id)
        if not parent_node:
            raise HTTPException(status_code=404, detail="Parent project not found")
        
        # Check if we can add a child (depth limit)
        if parent_node.level >= max_levels:
            raise HTTPException(status_code=400, detail=f"Cannot create more than {max_levels} levels")
        
        new_node = ProjectNode(
            id=str(uuid.uuid4()),
            name=name,
            level=parent_node.level + 1,
            parent_id=parent_id,
            created_at=datetime.now().isoformat()
        )
        parent_node.children.append(new_node)
    else:
        # Create root project
        new_node = ProjectNode(
            id=str(uuid.uuid4()),
            name=name,
            level=1,
            created_at=datetime.now().isoformat()
        )
        PROJECTS_DB[new_node.id] = new_node
    
    return {
        "status": "success",
        "project": new_node
    }

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
async def update_project(project_id: str, name: Optional[str] = None):
    """Update a project (rename)"""
    node = find_node_by_id(project_id)
    if not node:
        raise HTTPException(status_code=404, detail="Project not found")
    
    if name:
        node.name = name
    
    return {
        "status": "success",
        "project": node
    }

@router.delete("/{project_id}")
async def delete_project(project_id: str, cascade: bool = True):
    """Delete a project"""
    node = find_node_by_id(project_id)
    if not node:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # If this is a root project
    if project_id in PROJECTS_DB:
        deleted_count = 1 + len(_count_descendants(node))
        del PROJECTS_DB[project_id]
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
    
    return {
        "status": "success",
        "project": node
    }
