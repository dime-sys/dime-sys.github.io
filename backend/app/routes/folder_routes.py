from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional
import json
import os
from datetime import datetime
import uuid
from app.models.folder import (
    FolderNode, FolderStructure, FolderLevel, FolderConfig, 
    FolderPath, FileInFolder
)

router = APIRouter(prefix="/folders", tags=["folders"])

# Almacenamiento en memoria (será reemplazado por base de datos)
FOLDER_STRUCTURES = {}  # {structure_id: FolderStructure}
FOLDER_CONFIGS = {}  # {structure_id: FolderConfig}


def get_default_config():
    """Retorna la configuración por defecto de carpetas"""
    return {
        "max_levels": 5,
        "levels": [
            {
                "level": 1,
                "name": "Tipo de Documento",
                "description": "Clasificación principal",
                "allow_files": False
            },
            {
                "level": 2,
                "name": "Categoría",
                "description": "Subcategoría del documento",
                "allow_files": False
            },
            {
                "level": 3,
                "name": "Proyecto",
                "description": "Proyecto específico",
                "allow_files": False
            },
            {
                "level": 4,
                "name": "Período",
                "description": "Período de tiempo",
                "allow_files": True
            },
            {
                "level": 5,
                "name": "Referencia",
                "description": "Referencia específica",
                "allow_files": True
            }
        ]
    }


def find_node_by_id(node_id: str, node: Optional[FolderNode] = None) -> Optional[FolderNode]:
    """Busca recursivamente un nodo por ID en el árbol"""
    if node is None:
        for root in FOLDER_STRUCTURES.values():
            for root_node in root.root_nodes:
                result = find_node_by_id(node_id, root_node)
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


def find_parent_node(node_id: str, search_node: Optional[FolderNode] = None) -> Optional[FolderNode]:
    """Encuentra el padre de un nodo"""
    if search_node is None:
        for root in FOLDER_STRUCTURES.values():
            for root_node in root.root_nodes:
                result = find_parent_node(node_id, root_node)
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


def count_descendants(node: FolderNode) -> int:
    """Cuenta todos los descendientes de un nodo"""
    count = 1
    for child in node.children:
        count += count_descendants(child)
    return count


# ============== RUTAS DE CONFIGURACIÓN ==============

@router.post("/config/{structure_id}")
async def create_or_update_config(structure_id: str, config_data: dict):
    """Crea o actualiza la configuración de estructura de carpetas"""
    levels = []
    for level_data in config_data.get("levels", []):
        levels.append(FolderLevel(**level_data))
    
    config = FolderConfig(
        id=structure_id,
        max_levels=config_data.get("max_levels", 5),
        levels=levels,
        created_at=datetime.now().isoformat(),
        updated_at=datetime.now().isoformat()
    )
    
    FOLDER_CONFIGS[structure_id] = config
    return {
        "status": "success",
        "config": config
    }


@router.get("/config/{structure_id}")
async def get_config(structure_id: str):
    """Obtiene la configuración de estructura de carpetas"""
    if structure_id not in FOLDER_CONFIGS:
        # Crear configuración por defecto
        default_config = get_default_config()
        return await create_or_update_config(structure_id, default_config)
    
    return {
        "status": "success",
        "config": FOLDER_CONFIGS[structure_id]
    }


@router.put("/config/{structure_id}/levels")
async def update_levels(structure_id: str, levels_data: List[dict]):
    """Actualiza los niveles de carpetas"""
    if structure_id not in FOLDER_CONFIGS:
        raise HTTPException(status_code=404, detail="Configuración no encontrada")
    
    config = FOLDER_CONFIGS[structure_id]
    config.levels = [FolderLevel(**level) for level in levels_data]
    config.max_levels = len(config.levels)
    config.updated_at = datetime.now().isoformat()
    
    return {
        "status": "success",
        "config": config
    }


# ============== RUTAS DE ESTRUCTURA (ÁRBOL) ==============

@router.post("/structure/{structure_id}")
async def create_folder_structure(structure_id: str, name: str, description: Optional[str] = None):
    """Crea una nueva estructura de carpetas para un proyecto"""
    structure = FolderStructure(
        id=structure_id,
        name=name,
        description=description,
        root_nodes=[],
        total_nodes=0,
        created_at=datetime.now().isoformat(),
        updated_at=datetime.now().isoformat()
    )
    
    FOLDER_STRUCTURES[structure_id] = structure
    
    # Crear configuración por defecto
    default_config = get_default_config()
    await create_or_update_config(structure_id, default_config)
    
    return {
        "status": "success",
        "structure": structure
    }


@router.get("/structure/{structure_id}")
async def get_folder_structure(structure_id: str):
    """Obtiene la estructura completa de carpetas"""
    if structure_id not in FOLDER_STRUCTURES:
        raise HTTPException(status_code=404, detail="Estructura no encontrada")
    
    structure = FOLDER_STRUCTURES[structure_id]
    config = FOLDER_CONFIGS.get(structure_id)
    
    return {
        "status": "success",
        "structure": structure,
        "config": config
    }


@router.post("/structure/{structure_id}/folder")
async def create_folder(
    structure_id: str,
    name: str,
    parent_id: Optional[str] = None,
    metadata: Optional[dict] = None
):
    """Crea una nueva carpeta (nodo) en la estructura"""
    if structure_id not in FOLDER_STRUCTURES:
        raise HTTPException(status_code=404, detail="Estructura no encontrada")
    
    structure = FOLDER_STRUCTURES[structure_id]
    config = FOLDER_CONFIGS.get(structure_id)
    
    if not config:
        raise HTTPException(status_code=400, detail="Configuración no disponible")
    
    if parent_id:
        # Crear como subcarpeta
        parent_node = find_node_by_id(parent_id)
        if not parent_node:
            raise HTTPException(status_code=404, detail="Carpeta padre no encontrada")
        
        # Verificar límite de niveles
        if parent_node.level >= config.max_levels:
            raise HTTPException(
                status_code=400,
                detail=f"No se pueden crear más de {config.max_levels} niveles"
            )
        
        new_folder = FolderNode(
            id=str(uuid.uuid4()),
            name=name,
            level=parent_node.level + 1,
            parent_id=parent_id,
            metadata=metadata or {},
            created_at=datetime.now().isoformat(),
            updated_at=datetime.now().isoformat()
        )
        parent_node.children.append(new_folder)
    else:
        # Crear carpeta raíz
        if config.max_levels < 1:
            raise HTTPException(status_code=400, detail="Configuración inválida")
        
        new_folder = FolderNode(
            id=str(uuid.uuid4()),
            name=name,
            level=1,
            metadata=metadata or {},
            created_at=datetime.now().isoformat(),
            updated_at=datetime.now().isoformat()
        )
        structure.root_nodes.append(new_folder)
    
    structure.total_nodes = count_all_nodes(structure)
    structure.updated_at = datetime.now().isoformat()
    
    return {
        "status": "success",
        "folder": new_folder
    }


@router.put("/folder/{folder_id}")
async def update_folder(
    folder_id: str,
    name: Optional[str] = None,
    metadata: Optional[dict] = None
):
    """Actualiza una carpeta (renombar o metadatos)"""
    folder = find_node_by_id(folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Carpeta no encontrada")
    
    if name:
        folder.name = name
    
    if metadata:
        folder.metadata.update(metadata)
    
    folder.updated_at = datetime.now().isoformat()
    
    return {
        "status": "success",
        "folder": folder
    }


@router.delete("/structure/{structure_id}/folder/{folder_id}")
async def delete_folder(structure_id: str, folder_id: str, cascade: bool = True):
    """Elimina una carpeta"""
    if structure_id not in FOLDER_STRUCTURES:
        raise HTTPException(status_code=404, detail="Estructura no encontrada")
    
    structure = FOLDER_STRUCTURES[structure_id]
    folder = find_node_by_id(folder_id)
    
    if not folder:
        raise HTTPException(status_code=404, detail="Carpeta no encontrada")
    
    # Si es carpeta raíz
    if folder_id in [node.id for node in structure.root_nodes]:
        deleted_count = count_descendants(folder)
        structure.root_nodes = [node for node in structure.root_nodes if node.id != folder_id]
    else:
        # Es una subcarpeta
        parent = find_parent_node(folder_id)
        if parent:
            deleted_count = count_descendants(folder)
            parent.children = [child for child in parent.children if child.id != folder_id]
        else:
            raise HTTPException(status_code=400, detail="No se puede eliminar esta carpeta")
    
    structure.total_nodes = count_all_nodes(structure)
    structure.updated_at = datetime.now().isoformat()
    
    return {
        "status": "success",
        "deleted_count": deleted_count
    }


@router.get("/folder/{folder_id}/path")
async def get_folder_path(folder_id: str):
    """Obtiene la ruta completa de una carpeta"""
    folder = find_node_by_id(folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Carpeta no encontrada")
    
    path_ids = []
    path_names = []
    current = folder
    
    while current:
        path_ids.insert(0, current.id)
        path_names.insert(0, current.name)
        
        if current.parent_id:
            current = find_node_by_id(current.parent_id)
        else:
            break
    
    full_path = " / ".join(path_names)
    
    return {
        "status": "success",
        "path": FolderPath(
            path=path_ids,
            names=path_names,
            full_path=full_path
        )
    }


@router.get("/folder/{folder_id}/info")
async def get_folder_info(folder_id: str):
    """Obtiene información detallada de una carpeta"""
    folder = find_node_by_id(folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Carpeta no encontrada")
    
    return {
        "status": "success",
        "folder": folder,
        "children_count": len(folder.children),
        "files_count": len(folder.files),
        "descendants_count": count_descendants(folder) - 1
    }


# ============== RUTAS DE ARCHIVOS ==============

@router.post("/folder/{folder_id}/file")
async def add_file_to_folder(
    folder_id: str,
    filename: str,
    file_type: str,
    size: int,
    metadata: Optional[dict] = None
):
    """Agrega un archivo a una carpeta"""
    folder = find_node_by_id(folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Carpeta no encontrada")
    
    file_obj = FileInFolder(
        id=str(uuid.uuid4()),
        filename=filename,
        folder_id=folder_id,
        file_type=file_type,
        size=size,
        upload_date=datetime.now().isoformat(),
        metadata=metadata or {}
    )
    
    folder.files.append({
        "id": file_obj.id,
        "filename": file_obj.filename,
        "file_type": file_obj.file_type,
        "size": file_obj.size,
        "upload_date": file_obj.upload_date,
        "metadata": file_obj.metadata
    })
    
    folder.updated_at = datetime.now().isoformat()
    
    return {
        "status": "success",
        "file": file_obj
    }


@router.get("/folder/{folder_id}/files")
async def get_folder_files(folder_id: str):
    """Obtiene todos los archivos de una carpeta"""
    folder = find_node_by_id(folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Carpeta no encontrada")
    
    return {
        "status": "success",
        "folder_id": folder_id,
        "files": folder.files,
        "count": len(folder.files)
    }


@router.delete("/folder/{folder_id}/file/{file_id}")
async def delete_file_from_folder(folder_id: str, file_id: str):
    """Elimina un archivo de una carpeta"""
    folder = find_node_by_id(folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Carpeta no encontrada")
    
    initial_count = len(folder.files)
    folder.files = [f for f in folder.files if f["id"] != file_id]
    
    if len(folder.files) == initial_count:
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    
    folder.updated_at = datetime.now().isoformat()
    
    return {
        "status": "success",
        "message": "Archivo eliminado"
    }


# ============== FUNCIONES AUXILIARES ==============

def count_all_nodes(structure: FolderStructure) -> int:
    """Cuenta todos los nodos en la estructura"""
    count = 0
    for root in structure.root_nodes:
        count += count_descendants(root)
    return count
