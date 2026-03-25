from typing import List, Optional
from pydantic import BaseModel

class ProjectNode(BaseModel):
    """Nodo del árbol de proyectos"""
    id: str
    name: str
    level: int  # 1 para el nivel más alto, aumenta hacia abajo
    parent_id: Optional[str] = None
    children: List['ProjectNode'] = []
    files: List[str] = []  # File IDs stored in this node
    created_at: str
    
    class Config:
        arbitrary_types_allowed = True

class ProjectTree(BaseModel):
    """Árbol completo de proyectos"""
    root_nodes: List[ProjectNode] = []
    total_nodes: int = 0
    max_levels: int = 4

class ProjectPath(BaseModel):
    """Ruta de acceso a un nodo en el árbol"""
    path: List[str]  # IDs del nodo: [root_id, level2_id, level3_id, ...]
    names: List[str]  # Nombres correspondientes
