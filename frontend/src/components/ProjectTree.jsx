import React, { useState, useEffect, useMemo } from 'react';

const API = "/api";

const ProjectTree = ({ onSelectProject, onConfigLevels, selectedProjectId = null, refreshKey = 0, currentUser = null }) => {
  const [projects, setProjects] = useState([]);
  const [config, setConfig] = useState({ max_levels: 5, level_names: [] });
  const [expandedNodes, setExpandedNodes] = useState(new Set());
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [creating, setCreating] = useState(null);
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState('');
  const [loading, setLoading] = useState(true);

  const role = currentUser?.role || null;
  const canManageTree = role === 'admin' || role === 'configurador' || role === null;
  const canCreateRoot = role === 'admin' || role === null;

  const authHeaders = () => {
    const token = localStorage.getItem('authToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  useEffect(() => {
    loadProjects();
    loadConfig();
  }, [refreshKey]);

  const collectExpandedIds = (nodes) => {
    const ids = [];

    const visit = (node) => {
      if (node.children?.length) {
        ids.push(node.id);
        node.children.forEach(visit);
      }
    };

    nodes.forEach(visit);
    return ids;
  };

  const loadProjects = async () => {
    try {
      const response = await fetch(`${API}/projects/`, { headers: authHeaders() });
      const data = await response.json();
      const loadedProjects = data.projects || [];
      setProjects(loadedProjects);
      setExpandedNodes(new Set(collectExpandedIds(loadedProjects)));
    } catch (error) {
      console.error('Error loading projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadConfig = async () => {
    try {
      const response = await fetch(`${API}/config/project-levels`);
      const data = await response.json();
      setConfig(data);
    } catch (error) {
      console.error('Error loading config:', error);
    }
  };

  const toggleExpandNode = (nodeId) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    setExpandedNodes(newExpanded);
  };

  const normalizeName = (value) => String(value || '').trim().toLowerCase();

  const findNodeById = (nodes, nodeId) => {
    for (const node of nodes || []) {
      if (node.id === nodeId) return node;
      const found = findNodeById(node.children || [], nodeId);
      if (found) return found;
    }
    return null;
  };

  const hasSiblingNameConflict = (name, parentId = null, excludeId = null) => {
    const target = normalizeName(name);
    if (!target) return false;

    const siblings = parentId
      ? (findNodeById(projects, parentId)?.children || [])
      : projects;

    return siblings.some((n) => n.id !== excludeId && normalizeName(n.name) === target);
  };

  // For responsable: only show nodes they are assigned to + their ancestors
  const displayProjects = useMemo(() => {
    if (role !== 'responsable') return projects;
    const assignedIds = new Set(currentUser?.assigned_project_ids || []);
    if (assignedIds.size === 0) return [];

    const nodeIsRelevant = (node) => {
      if (assignedIds.has(node.id)) return true;
      return (node.children || []).some(nodeIsRelevant);
    };

    const pruneNode = (node) => {
      if (assignedIds.has(node.id)) return node;
      const relevantChildren = (node.children || []).filter(nodeIsRelevant).map(pruneNode);
      if (relevantChildren.length === 0) return null;
      return { ...node, children: relevantChildren };
    };

    return projects.filter(nodeIsRelevant).map(pruneNode).filter(Boolean);
  }, [projects, role, currentUser?.assigned_project_ids]);

  const createNameConflict = (() => {
    if (creating === null) return false;
    const parentId = creating === 'root' ? null : creating;
    return hasSiblingNameConflict(newName, parentId);
  })();

  const editNameConflict = (() => {
    if (!editingId) return false;
    const node = findNodeById(projects, editingId);
    if (!node) return false;
    return hasSiblingNameConflict(editName, node.parent_id || null, node.id);
  })();

  const createProject = async (parentId = null) => {
    if (!newName.trim()) return;
    if (hasSiblingNameConflict(newName, parentId)) {
      setNameError('Ya existe un proyecto con ese nombre en este nivel');
      return;
    }
    try {
      const response = await fetch(
        `${API}/projects/?name=${encodeURIComponent(newName)}&parent_id=${parentId || ''}`,
        { method: 'POST', headers: authHeaders() }
      );
      const data = await response.json();
      if (data.status === 'success') {
        loadProjects();
        setCreating(null);
        setNewName('');
        setNameError('');
      } else if (response.status === 409) {
        setNameError(data?.detail || 'Ya existe un proyecto con ese nombre en este nivel');
      }
    } catch (error) {
      console.error('Error creating project:', error);
    }
  };

  const deleteProject = async (projectId) => {
    if (!confirm('¿Eliminar este nodo y todos sus subniveles?')) return;
    try {
      const response = await fetch(`${API}/projects/${projectId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await response.json();
      if (data.status === 'success') loadProjects();
    } catch (error) {
      console.error('Error deleting project:', error);
    }
  };

  const updateProject = async (projectId) => {
    if (!editName.trim()) return;
    const node = findNodeById(projects, projectId);
    if (node && hasSiblingNameConflict(editName, node.parent_id || null, node.id)) {
      setNameError('Ya existe un proyecto con ese nombre en este nivel');
      return;
    }
    try {
      const response = await fetch(
        `${API}/projects/${projectId}?name=${encodeURIComponent(editName)}`,
        { method: 'PUT', headers: authHeaders() }
      );
      const data = await response.json();
      if (data.status === 'success') {
        loadProjects();
        setEditingId(null);
        setNameError('');
      } else if (response.status === 409) {
        setNameError(data?.detail || 'Ya existe un proyecto con ese nombre en este nivel');
      }
    } catch (error) {
      console.error('Error updating project:', error);
    }
  };

  const TreeNode = ({ node, depth = 0 }) => {
    const isExpanded = expandedNodes.has(node.id);
    const canAddChild = canManageTree && depth < config.max_levels - 1;
    const isRoot = node.level === 1;
    // Configurador can add children but NOT delete/rename root nodes
    const canEditThisNode = canManageTree && !(role === 'configurador' && isRoot);
    const canDeleteThisNode = canManageTree && !(role === 'configurador' && isRoot);
    const levelAllowsFiles = true;
    const isSelected = selectedProjectId === node.id;

    return (
      <div key={node.id} className="project-tree-node">
        <div className="node-content" style={{ paddingLeft: `${depth * 20}px` }}>
          <div className={`node-header ${isSelected ? 'selected' : ''}`}>
            {node.children?.length > 0 && (
              <button
                className="expand-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  toggleExpandNode(node.id);
                }}
              >
                {isExpanded ? '▾' : '▸'}
              </button>
            )}
            {node.children?.length === 0 && <div className="expand-placeholder"></div>}

            {editingId === node.id ? (
              <div className="edit-input-group">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => {
                    setEditName(e.target.value);
                    setNameError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') updateProject(node.id);
                    if (e.key === 'Escape') {
                      setEditingId(null);
                      setNameError('');
                    }
                  }}
                  autoFocus
                />
                <button onClick={() => updateProject(node.id)} className="btn-save" disabled={editNameConflict}>✓</button>
                <button onClick={() => { setEditingId(null); setNameError(''); }} className="btn-cancel">✕</button>
                {nameError && editNameConflict && <div className="name-error-inline">{nameError}</div>}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="node-select"
                  onClick={() =>
                    onSelectProject?.({
                      ...node,
                      allowsFiles: levelAllowsFiles,
                      levelName: config.level_names?.[node.level - 1] || `Nivel ${node.level}`,
                    })
                  }
                >
                  <span className="node-name" title={node.name}>{node.name}</span>
                  <span className="node-meta">
                    <span className="node-level">{config.level_names?.[node.level - 1] || `Nivel ${node.level}`}</span>
                    <span className={`file-policy ${levelAllowsFiles ? 'allowed' : 'blocked'}`}>
                      {levelAllowsFiles ? 'Permite archivos' : 'Sin archivos'}
                    </span>
                    <span className="file-count">{node.files?.length || 0} archivos</span>
                  </span>
                </button>
              </>
            )}

            <div className="node-actions">
              {editingId !== node.id ?  (
                <>
                  {canAddChild && (
                    <button
                      className="action-btn add-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        setCreating(node.id);
                      }}
                      title={`Agregar ${config.level_names?.[node.level] || 'subnivel'}`}
                    >
                      +
                    </button>
                  )}
                  {canEditThisNode && (
                    <button
                      className="action-btn edit-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        setEditingId(node.id);
                        setEditName(node.name);
                      }}
                      title="Renombrar"
                    >
                      ✎
                    </button>
                  )}
                  {canDeleteThisNode && (
                    <button
                      className="action-btn delete-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteProject(node.id);
                      }}
                      title="Eliminar"
                    >
                      🗑
                    </button>
                  )}
                </>
              ) : null}
            </div>
          </div>

          {creating === node.id && (
            <div className="create-input-group">
              <input
                type="text"
                placeholder={`Nombre del ${config.level_names?.[node.level] || `nivel ${node.level + 1}`}`}
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setNameError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createProject(node.id);
                  if (e.key === 'Escape') {
                    setCreating(null);
                    setNameError('');
                  }
                }}
                autoFocus
              />
              <button onClick={() => createProject(node.id)} className="btn-save" disabled={createNameConflict}>✓</button>
              <button onClick={() => { setCreating(null); setNameError(''); }} className="btn-cancel">✕</button>
              {nameError && createNameConflict && <div className="name-error-inline">{nameError}</div>}
            </div>
          )}
        </div>

        {isExpanded && node.children?.length > 0 && (
          <div className="children-container">
            {node.children.map(child => (
              <TreeNode key={child.id} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return <div className="project-tree-loading">Cargando proyectos...</div>;
  }

  const styles = `
    .project-tree-wrapper .project-tree-container {
      padding: 14px;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.06);
    }

    .project-tree-wrapper .tree-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      padding-bottom: 10px;
      border-bottom: 1px solid #e5e7eb;
      gap: 8px;
      flex-wrap: wrap;
    }

    .project-tree-wrapper .tree-header h3 {
      margin: 0;
      color: #111827;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: -0.15px;
    }

    .project-tree-wrapper .btn-new-root {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 11px;
      background: #111827;
      color: #ffffff;
      border: 1px solid #111827;
      border-radius: 8px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 600;
      transition: background 0.2s;
      line-height: 1.2;
    }

    .project-tree-wrapper .btn-new-root:hover {
      background: #1f2937;
    }

    .project-tree-wrapper .create-root-group {
      display: flex;
      gap: 8px;
      margin-bottom: 10px;
    }

    .project-tree-wrapper .create-root-group input {
      flex: 1;
      padding: 8px 10px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      font-size: 12px;
    }

    .project-tree-wrapper .nodes-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .project-tree-wrapper .project-tree-node {
      display: flex;
      flex-direction: column;
    }

    .project-tree-wrapper .node-content {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .project-tree-wrapper .node-header {
      display: grid;
      grid-template-columns: 22px minmax(0, 1fr) auto;
      align-items: start;
      column-gap: 8px;
      padding: 8px;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      transition: background 0.2s;
    }

    .project-tree-wrapper .node-header.selected {
      background: #f3f4f6;
      border-color: #9ca3af;
      box-shadow: inset 0 0 0 1px #d1d5db;
    }

    .project-tree-wrapper .node-header:hover {
      background: #f3f4f6;
    }

    .project-tree-wrapper .expand-btn,
    .project-tree-wrapper .expand-placeholder {
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: none;
      border: none;
      cursor: pointer;
      color: #6b7280;
      flex-shrink: 0;
      font-size: 12px;
    }

    .project-tree-wrapper .expand-placeholder {
      cursor: default;
    }

    .project-tree-wrapper .expand-btn:hover {
      color: #111827;
    }

    .project-tree-wrapper .node-name {
      font-weight: 600;
      color: #1f2937;
      display: block;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .project-tree-wrapper .node-select {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 5px;
      min-width: 0;
      background: transparent;
      border: none;
      padding: 0;
      cursor: pointer;
      text-align: left;
      color: inherit;
    }

    .project-tree-wrapper .node-meta {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      min-width: 0;
    }

    .project-tree-wrapper .node-level,
    .project-tree-wrapper .file-policy,
    .project-tree-wrapper .file-count {
      padding: 2px 7px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 600;
      white-space: nowrap;
      border: 1px solid #d1d5db;
      background: #f3f4f6;
      color: #4b5563;
    }

    .project-tree-wrapper .file-policy.allowed,
    .project-tree-wrapper .file-policy.blocked {
      background: #f3f4f6;
      color: #4b5563;
    }

    .project-tree-wrapper .node-actions {
      display: flex;
      gap: 4px;
      flex-shrink: 0;
      align-self: start;
    }

    .project-tree-wrapper .action-btn {
      width: 26px;
      height: 26px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #ffffff;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
      color: #6b7280;
      font-size: 12px;
    }

    .project-tree-wrapper .action-btn:hover {
      background: #f3f4f6;
      border-color: #9ca3af;
      color: #1f2937;
    }

    .project-tree-wrapper .edit-input-group,
    .project-tree-wrapper .create-input-group {
      display: flex;
      gap: 6px;
      margin-top: 6px;
    }

    .project-tree-wrapper .edit-input-group input,
    .project-tree-wrapper .create-input-group input {
      flex: 1;
      padding: 7px 9px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      font-size: 12px;
    }

    .project-tree-wrapper .btn-save,
    .project-tree-wrapper .btn-cancel {
      min-width: 30px;
      padding: 6px 8px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      background: #ffffff;
      cursor: pointer;
      font-weight: 700;
      transition: all 0.2s;
      color: #4b5563;
    }

    .project-tree-wrapper .btn-save:hover,
    .project-tree-wrapper .btn-cancel:hover {
      background: #f3f4f6;
      border-color: #9ca3af;
      color: #111827;
    }

    .project-tree-wrapper .children-container {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 4px;
    }

    .project-tree-wrapper .empty-state {
      padding: 22px 14px;
      text-align: center;
      color: #6b7280;
      background: #f9fafb;
      border: 1px dashed #d1d5db;
      border-radius: 8px;
      font-size: 12px;
    }

    .project-tree-loading {
      padding: 28px 14px;
      text-align: center;
      color: #6b7280;
      font-size: 12px;
    }

    .project-tree-wrapper .name-error-inline {
      grid-column: 1 / -1;
      color: #b91c1c;
      font-size: 11px;
      margin-top: 2px;
    }

    @media (max-width: 768px) {
      .project-tree-wrapper .btn-new-root {
        width: 100%;
        justify-content: center;
      }

      .project-tree-wrapper .node-header {
        grid-template-columns: 22px minmax(0, 1fr);
        row-gap: 8px;
      }

      .project-tree-wrapper .node-actions {
        grid-column: 1 / -1;
        justify-content: flex-end;
      }
    }
  `;

  return (
    <div className="project-tree-wrapper">
      <div className="project-tree-container">
        <div className="tree-header">
          <h3>Proyectos</h3>
          {canCreateRoot && (
            <button
              className="btn-new-root"
              onClick={() => setCreating('root')}
              title="Crear nuevo proyecto"
            >
              + Nuevo Proyecto
            </button>
          )}
        </div>

        {creating === 'root' && (
          <div className="create-root-group">
            <input
              type="text"
              placeholder={`Nombre del ${config.level_names?.[0] || 'Nivel 1'}`}
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setNameError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createProject();
                if (e.key === 'Escape') {
                  setCreating(null);
                  setNameError('');
                }
              }}
              autoFocus
            />
            <button onClick={() => createProject()} className="btn-save" disabled={createNameConflict}>✓</button>
            <button onClick={() => { setCreating(null); setNameError(''); }} className="btn-cancel">✕</button>
            {nameError && createNameConflict && <div className="name-error-inline">{nameError}</div>}
          </div>
        )}

        <div className="nodes-list">
          {displayProjects.length === 0 ? (
            <div className="empty-state">
              {canCreateRoot
                ? 'No hay proyectos. Crea uno nuevo para comenzar.'
                : 'No tienes proyectos asignados.'}
            </div>
          ) : (
            displayProjects.map(project => (
              <TreeNode key={project.id} node={project} />
            ))
          )}
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
};

export default ProjectTree;
