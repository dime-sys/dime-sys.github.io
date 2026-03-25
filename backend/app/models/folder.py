from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from datetime import datetime


class FolderNode(BaseModel):
    """Nodo de carpeta en la estructura jerárquica"""
    id: str
    name: str
    level: int  # 1 para raíz, incrementa hacia abajo
    parent_id: Optional[str] = None
    children: List['FolderNode'] = []
    files: List[Dict[str, Any]] = []  # Archivos dentro de esta carpeta
    metadata: Dict[str, Any] = {}  # Metadatos personalizados
    created_at: str
    updated_at: str
    
    class Config:
        arbitrary_types_allowed = True


class FolderStructure(BaseModel):
    """Estructura completa de carpetas"""
    id: str  # ID único de la estructura (proyecto)
    name: str
    description: Optional[str] = None
    root_nodes: List[FolderNode] = []
    total_nodes: int = 0
    created_at: str
    updated_at: str


class FolderLevel(BaseModel):
    """Definición de un nivel de carpeta"""
    level: int
    name: str  # Ej: "Compañía", "Departamento", "proyecto"
    description: Optional[str] = None
    allow_files: bool = True  # ¿Se pueden subir archivos en este nivel?
    custom_fields: List[str] = []  # Campos personalizados para este nivel


class FolderConfig(BaseModel):
    """Configuración de la estructura de carpetas"""
    id: str  # ID del proyecto
    max_levels: int  # Máximo número de niveles
    levels: List[FolderLevel] = []  # Definición de cada nivel
    created_at: str
    updated_at: str
    
    class Config:
        arbitrary_types_allowed = True


class FolderPath(BaseModel):
    """Ruta de acceso a una carpeta"""
    path: List[str]  # IDs del nodo: [root_id, level2_id, level3_id, ...]
    names: List[str]  # Nombres correspondientes
    full_path: str  # Ruta completa como string "Raíz/Nivel2/Nivel3"


class FileInFolder(BaseModel):
    """Archivo dentro de una carpeta"""
    id: str
    filename: str
    folder_id: str
    file_type: str
    size: int  # En bytes
    upload_date: str
    metadata: Dict[str, Any] = {}
