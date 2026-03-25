import json
import os
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/config", tags=["config"])

CONFIG_FILE = os.path.join(os.path.dirname(__file__), "../../config.json")


class ProjectConfigPayload(BaseModel):
    max_levels: int = 4
    level_names: Optional[List[str]] = None
    level_allow_files: Optional[List[bool]] = None


def default_config():
    return {
        "project_max_levels": 4,
        "project_level_names": ["Compañía", "Área", "Departamento", "Proyecto"],
        "project_level_allow_files": [False, False, False, True],
    }

def load_config():
    """Load configuration from config.json"""
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            loaded_config = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return default_config()

    config = default_config()
    if isinstance(loaded_config, dict):
        config.update(loaded_config)

    max_levels = config.get("project_max_levels", 4)
    level_names = config.get("project_level_names") or []
    level_allow_files = config.get("project_level_allow_files") or []

    if len(level_names) != max_levels:
        default_names = [
            "Nivel 1", "Nivel 2", "Nivel 3", "Nivel 4", "Nivel 5",
            "Nivel 6", "Nivel 7", "Nivel 8", "Nivel 9", "Nivel 10"
        ]
        config["project_level_names"] = default_names[:max_levels]

    if len(level_allow_files) != max_levels:
        config["project_level_allow_files"] = [False] * (max_levels - 1) + [True]

    return config

def save_config(config):
    """Save configuration to config.json"""
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)

@router.get("/project-levels")
async def get_project_config():
    """Get project configuration (max levels and level names)"""
    config = load_config()
    return {
        "max_levels": config.get("project_max_levels", 4),
        "level_names": config.get("project_level_names", ["Compañía", "Área", "Departamento", "Proyecto"]),
        "level_allow_files": config.get("project_level_allow_files", [False, False, False, True])
    }

@router.put("/project-levels")
async def update_project_config(payload: ProjectConfigPayload):
    """Update project configuration"""
    max_levels = payload.max_levels
    level_names = payload.level_names
    level_allow_files = payload.level_allow_files

    if max_levels < 1 or max_levels > 10:
        raise HTTPException(status_code=400, detail="Max levels must be between 1 and 10")
    
    config = load_config()
    config["project_max_levels"] = max_levels
    
    if level_names is not None:
        if len(level_names) != max_levels:
            raise HTTPException(
                status_code=400,
                detail=f"Number of level names ({len(level_names)}) must match max_levels ({max_levels})",
            )
        config["project_level_names"] = level_names
    else:
        # Generate default level names if not provided
        default_names = ["Nivel 1", "Nivel 2", "Nivel 3", "Nivel 4", "Nivel 5", "Nivel 6", "Nivel 7", "Nivel 8", "Nivel 9", "Nivel 10"]
        config["project_level_names"] = default_names[:max_levels]
    
    # Handle level_allow_files configuration
    if level_allow_files is not None:
        if len(level_allow_files) != max_levels:
            raise HTTPException(
                status_code=400,
                detail=f"Number of level_allow_files ({len(level_allow_files)}) must match max_levels ({max_levels})",
            )
        config["project_level_allow_files"] = level_allow_files
    else:
        # Default: allow files only in the last level
        config["project_level_allow_files"] = [False] * (max_levels - 1) + [True]
    
    save_config(config)
    return {
        "status": "success",
        "max_levels": max_levels,
        "level_names": config["project_level_names"],
        "level_allow_files": config["project_level_allow_files"]
    }
