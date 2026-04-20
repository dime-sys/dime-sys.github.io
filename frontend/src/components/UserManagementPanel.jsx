import { useState, useEffect } from "react";
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getProjects,
  getProcesses,
  getPendingUsers,
  approvePendingUser,
  rejectPendingUser,
  preregisterUser,
} from "../services/api";

const ROLE_META = {
  admin: { label: "Admin", bg: "#dbeafe", color: "#1e40af", icon: "🛡" },
  configurador: { label: "Configurador", bg: "#dcfce7", color: "#166534", icon: "⚙" },
  responsable: { label: "Responsable", bg: "#fef9c3", color: "#854d0e", icon: "📋" },
};

function RoleBadge({ role, roles }) {
  const effectiveRoles = roles || (role ? [role] : []);
  if (!effectiveRoles.length) return null;
  return (
    <span style={{ display: "inline-flex", gap: "4px", flexWrap: "wrap" }}>
      {effectiveRoles.map((r) => {
        const m = ROLE_META[r] || { label: r, bg: "#f3f4f6", color: "#374151", icon: "👤" };
        return (
          <span
            key={r}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              background: m.bg,
              color: m.color,
              borderRadius: "999px",
              padding: "2px 9px",
              fontSize: "11px",
              fontWeight: 700,
            }}
          >
            {m.icon} {m.label}
          </span>
        );
      })}
    </span>
  );
}

function collectProjectNodes(node, depth = 0) {
  if (!node) return [];
  const indent = "  ".repeat(depth);
  const entry = {
    id: node.id,
    name: `${indent}${depth > 0 ? "└ " : ""}${node.name}`,
    rawName: node.name,
    depth,
  };
  const children = (node.children || []).flatMap((c) => collectProjectNodes(c, depth + 1));
  return [entry, ...children];
}

function UserForm({ user, onSave, onCancel, projectNodes, processes, callerRole = "admin" }) {
  const isEdit = !!user?.id;
  const isCallerConfigurador = callerRole === "configurador";
  // Normalize to roles array
  const initialRoles = user?.roles || (user?.role ? [user.role] : ["configurador"]);
  const [form, setForm] = useState({
    username: user?.username || "",
    password: "",
    roles: initialRoles,
    assigned_project_ids: user?.assigned_project_ids || [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k, v) => setForm((prev) => ({ ...prev, [k]: v }));

  const toggleRole = (roleKey) => {
    set("roles", form.roles.includes(roleKey)
      ? form.roles.filter((r) => r !== roleKey)
      : [...form.roles, roleKey]
    );
  };

  const toggleProject = (id) => {
    set(
      "assigned_project_ids",
      form.assigned_project_ids.includes(id)
        ? form.assigned_project_ids.filter((x) => x !== id)
        : [...form.assigned_project_ids, id]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isCallerConfigurador) {
      if (!form.username.trim()) { setError("El nombre de usuario es obligatorio"); return; }
      if (!isEdit && !form.password.trim()) { setError("La contraseña es obligatoria"); return; }
      if (!isEdit && form.password.length < 4) { setError("La contraseña debe tener al menos 4 caracteres"); return; }
      if (!form.roles.length) { setError("Debes asignar al menos un rol"); return; }
    } else if (!isEdit) {
      if (!form.username.trim()) { setError("El nombre de usuario es obligatorio"); return; }
    }
    setSaving(true);
    setError("");
    try {
      let saved;
      if (isCallerConfigurador) {
        if (!isEdit) {
          // Pre-register a new responsable
          saved = await preregisterUser({ username: form.username.trim(), assigned_project_ids: form.assigned_project_ids });
        } else {
          // Update only assigned_project_ids
          saved = await updateUser(user.id, { assigned_project_ids: form.assigned_project_ids });
        }
      } else {
        const payload = {
          roles: form.roles,
          assigned_project_ids: form.assigned_project_ids,
          ...(form.password ? { password: form.password } : {}),
        };
        saved = isEdit
          ? await updateUser(user.id, payload)
          : await createUser({ username: form.username, password: form.password, roles: form.roles, assigned_project_ids: form.assigned_project_ids });
      }
      onSave(saved);
    } catch (err) {
      setError(err.response?.data?.detail || "Error al guardar usuario");
    } finally {
      setSaving(false);
    }
  };

  // Show project assignment when user has configurador or responsable role (needs scope)
  const needsAssignment = form.roles.includes("responsable") || form.roles.includes("configurador") || isCallerConfigurador;
  // Show individual processes only for responsable role
  const needsProcesses = form.roles.includes("responsable") || (isCallerConfigurador && (user?.roles || [user?.role]).includes("responsable"));

  const inputStyle = {
    width: "100%",
    padding: "7px 10px",
    border: "1px solid #d1d5db",
    borderRadius: "7px",
    fontSize: "13px",
    outline: "none",
    boxSizing: "border-box",
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ fontSize: "14px", fontWeight: 700, color: "#111827", marginBottom: "4px" }}>
        {isCallerConfigurador && !isEdit
          ? "Pre-registrar responsable"
          : isCallerConfigurador
          ? `Asignar proyectos: ${user?.username}`
          : isEdit ? `Editar: ${user.username}` : "Nuevo usuario"}
      </div>

      {/* Username: shown for all new users (admin creates, configurador pre-registers) */}
      {!isEdit && (
        <div>
          <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#6b7280", marginBottom: "4px" }}>
            Usuario
          </label>
          <input
            type="text"
            value={form.username}
            onChange={(e) => set("username", e.target.value)}
            placeholder={isCallerConfigurador ? "Ej: juan@empresa.com" : "Nombre de usuario"}
            style={inputStyle}
            autoComplete="off"
          />
          {isCallerConfigurador && (
            <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "4px" }}>
              El usuario establecerá su contraseña al ingresar por primera vez.
            </div>
          )}
        </div>
      )}

      {!isCallerConfigurador && (
        <div>
          <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#6b7280", marginBottom: "4px" }}>
            {isEdit ? "Nueva contraseña (dejar vacío para no cambiar)" : "Contraseña"}
          </label>
          <input
            type="password"
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
            placeholder={isEdit ? "Nueva contraseña (opcional)" : "Contraseña"}
            style={inputStyle}
            autoComplete="new-password"
          />
        </div>
      )}

      {!isCallerConfigurador && (
        <div>
          <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#6b7280", marginBottom: "6px" }}>
            Roles
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {Object.entries(ROLE_META).map(([roleKey, m]) => (
              <label
                key={roleKey}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "8px",
                  cursor: "pointer",
                  padding: "8px 10px",
                  borderRadius: "8px",
                  border: `1px solid ${form.roles.includes(roleKey) ? "#3b82f6" : "#e5e7eb"}`,
                  background: form.roles.includes(roleKey) ? "#eff6ff" : "white",
                }}
              >
                <input
                  type="checkbox"
                  checked={form.roles.includes(roleKey)}
                  onChange={() => toggleRole(roleKey)}
                  style={{ marginTop: "2px" }}
                />
                <div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: m.color }}>
                    {m.icon} {m.label}
                  </div>
                  <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                    {roleKey === "admin" && "Acceso completo al sistema"}
                    {roleKey === "configurador" && "Carga archivos y configura reglas"}
                    {roleKey === "responsable" && "Solo puede subir a rutas asignadas"}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Project assignment: for responsable (folders + processes) or configurador (folders only) */}
      {needsAssignment && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#6b7280", marginBottom: "6px" }}>
              {form.roles.includes("configurador") && !form.roles.includes("responsable") ? "📁 Proyectos gestionados" : "📂 Carpetas asignadas"}
            </label>
            {projectNodes.length === 0 ? (
              <div style={{ fontSize: "12px", color: "#9ca3af", fontStyle: "italic" }}>
                No hay carpetas disponibles.
              </div>
            ) : (
              <div style={{ maxHeight: "180px", overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "6px", background: "#f9fafb" }}>
                {projectNodes.map((node) => (
                  <label
                    key={node.id}
                    style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 6px", borderRadius: "5px", cursor: "pointer", fontSize: "12px", background: form.assigned_project_ids.includes(node.id) ? "#eff6ff" : "transparent" }}
                  >
                    <input type="checkbox" checked={form.assigned_project_ids.includes(node.id)} onChange={() => toggleProject(node.id)} />
                    <span style={{ fontFamily: "monospace", whiteSpace: "pre" }}>{node.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Individual processes: only for responsable */}
          {needsProcesses && (
            <div>
              <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#6b7280", marginBottom: "6px" }}>
                📊 Procesos individuales asignados
              </label>
              {processes.length === 0 ? (
                <div style={{ fontSize: "12px", color: "#9ca3af", fontStyle: "italic" }}>
                  No hay procesos creados aún.
                </div>
              ) : (
                <div style={{ maxHeight: "180px", overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "6px", background: "#f9fafb" }}>
                  {processes.map((proc) => (
                    <label
                      key={proc.id}
                      style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 6px", borderRadius: "5px", cursor: "pointer", fontSize: "12px", background: form.assigned_project_ids.includes(proc.id) ? "#eff6ff" : "transparent" }}
                    >
                      <input type="checkbox" checked={form.assigned_project_ids.includes(proc.id)} onChange={() => toggleProject(proc.id)} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {proc.process_name || proc.file_name}
                      </span>
                      {proc.project_name && (
                        <span style={{ fontSize: "10px", color: "#9ca3af", flexShrink: 0 }}>· {proc.project_name}</span>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ fontSize: "11px", color: "#9ca3af" }}>
            {form.assigned_project_ids.length} elemento(s) asignado(s) en total
          </div>
        </div>
      )}

      {error && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "7px",
            padding: "8px 12px",
            fontSize: "12px",
            color: "#991b1b",
          }}
        >
          ⚠ {error}
        </div>
      )}

      <div style={{ display: "flex", gap: "8px" }}>
        <button
          type="submit"
          disabled={saving}
          style={{
            padding: "8px 16px",
            background: saving ? "#93c5fd" : "#1d4ed8",
            color: "white",
            border: "none",
            borderRadius: "7px",
            fontSize: "13px",
            fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "⏳ Guardando..." : isEdit ? "💾 Guardar cambios" : isCallerConfigurador ? "➕ Pre-registrar" : "➕ Crear usuario"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: "8px 14px",
            background: "#f3f4f6",
            color: "#374151",
            border: "1px solid #e5e7eb",
            borderRadius: "7px",
            fontSize: "13px",
            cursor: "pointer",
          }}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

function UserManagementPanel({ onBack, currentUser }) {
  const hasRole = (u, r) => (u?.roles || (u?.role ? [u.role] : [])).includes(r);
  const isConfigurador = hasRole(currentUser, "configurador") && !hasRole(currentUser, "admin");
  const [users, setUsers] = useState([]);
  const [pendingUsers, setPendingUsers] = useState([]);
  const [approvingPending, setApprovingPending] = useState(null); // { id, role }
  const [selectedUser, setSelectedUser] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [projectNodes, setProjectNodes] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [roleModal, setRoleModal] = useState(null); // null | "admin" | "configurador" | "responsable"

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [usersData, projectsData, procsData, pendingData] = await Promise.all([
        getUsers(),
        getProjects().catch(() => ({ projects: [] })),
        getProcesses().catch(() => []),
        getPendingUsers().catch(() => []),
      ]);
      setUsers(usersData);
      setPendingUsers(Array.isArray(pendingData) ? pendingData : []);
      const roots = projectsData?.projects || [];
      setProjectNodes(roots.flatMap((r) => collectProjectNodes(r)));
      setProcesses(Array.isArray(procsData) ? procsData : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = (saved) => {
    setUsers((prev) => {
      const exists = prev.find((u) => u.id === saved.id);
      return exists ? prev.map((u) => (u.id === saved.id ? saved : u)) : [...prev, saved];
    });
    setSelectedUser(null);
    setShowCreateForm(false);
  };

  const handleDelete = async (userId) => {
    try {
      await deleteUser(userId);
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      if (selectedUser?.id === userId) setSelectedUser(null);
    } catch (err) {
      alert(err.response?.data?.detail || "Error al eliminar usuario");
    } finally {
      setDeleteConfirm(null);
    }
  };

  const cardStyle = {
    background: "white",
    border: "1px solid #e5e7eb",
    borderRadius: "12px",
    padding: "20px",
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0",
        height: "100%",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          marginBottom: "16px",
          paddingBottom: "12px",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <button
          onClick={onBack}
          style={{
            padding: "6px 12px",
            background: "#f3f4f6",
            border: "1px solid #e5e7eb",
            borderRadius: "6px",
            fontSize: "13px",
            cursor: "pointer",
          }}
        >
          ← Volver
        </button>
        <span style={{ fontSize: "20px" }}>👥</span>
        <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "#111827" }}>
          {isConfigurador ? "Asignar responsables" : "Gestión de usuarios"}
        </h2>
      </div>

      {/* Main split layout */}
      <div style={{ display: "flex", gap: "16px", flex: 1, minHeight: 0 }}>
        {/* Left: user list */}
        <div
          style={{
            width: "240px",
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
        {!isConfigurador && (
          <button
            onClick={() => { setShowCreateForm(true); setSelectedUser(null); }}
            style={{
              padding: "8px 12px",
              background: "#1d4ed8",
              color: "white",
              border: "none",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              width: "100%",
            }}
          >
            ➕ Nuevo usuario
          </button>
        )}

        {isConfigurador && (
          <button
            onClick={() => { setShowCreateForm(true); setSelectedUser(null); }}
            style={{
              padding: "8px 12px",
              background: "#0f766e",
              color: "white",
              border: "none",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              width: "100%",
            }}
          >
            ⌚ Pre-registrar responsable
          </button>
        )}

          {/* Pending requests */}
          {!isConfigurador && pendingUsers.length > 0 && (
            <div
              style={{
                background: "#fffbeb",
                border: "1px solid #fcd34d",
                borderRadius: "10px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "8px 12px",
                  background: "#fef3c7",
                  borderBottom: "1px solid #fcd34d",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#92400e",
                }}
              >
                ⏳ Solicitudes pendientes
                <span
                  style={{
                    background: "#f59e0b",
                    color: "white",
                    borderRadius: "999px",
                    fontSize: "10px",
                    fontWeight: 700,
                    padding: "1px 6px",
                    marginLeft: "auto",
                  }}
                >
                  {pendingUsers.length}
                </span>
              </div>
              {pendingUsers.map((p) => (
                <div
                  key={p.id}
                  style={{
                    padding: "10px 12px",
                    borderBottom: "1px solid #fde68a",
                  }}
                >
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "#111827", marginBottom: "3px", wordBreak: "break-all" }}>
                    📧 {p.email}
                  </div>
                  <div style={{ fontSize: "10px", color: "#6b7280", marginBottom: "8px" }}>
                    {new Date(p.requested_at).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </div>

                  {approvingPending?.id === p.id ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <select
                        value={approvingPending.role}
                        onChange={(e) => setApprovingPending((prev) => ({ ...prev, role: e.target.value }))}
                        style={{
                          padding: "5px 8px",
                          border: "1px solid #d1d5db",
                          borderRadius: "6px",
                          fontSize: "12px",
                          background: "white",
                          width: "100%",
                        }}
                      >
                        <option value="configurador">⚙ Configurador</option>
                        <option value="responsable">📋 Responsable</option>
                        <option value="admin">🛡 Admin</option>
                      </select>
                      <div style={{ display: "flex", gap: "5px" }}>
                        <button
                          onClick={async () => {
                            try {
                              const newUser = await approvePendingUser(p.id, { role: approvingPending.role, assigned_project_ids: [] });
                              setUsers((prev) => [...prev, newUser]);
                              setPendingUsers((prev) => prev.filter((x) => x.id !== p.id));
                              setApprovingPending(null);
                            } catch (err) {
                              alert(err.response?.data?.detail || "Error al aprobar");
                            }
                          }}
                          style={{
                            flex: 1,
                            padding: "5px 0",
                            background: "#16a34a",
                            color: "white",
                            border: "none",
                            borderRadius: "6px",
                            fontSize: "11px",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          ✓ Confirmar
                        </button>
                        <button
                          onClick={() => setApprovingPending(null)}
                          style={{
                            padding: "5px 8px",
                            background: "#f3f4f6",
                            color: "#374151",
                            border: "1px solid #e5e7eb",
                            borderRadius: "6px",
                            fontSize: "11px",
                            cursor: "pointer",
                          }}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: "5px" }}>
                      <button
                        onClick={() => setApprovingPending({ id: p.id, role: "configurador" })}
                        style={{
                          flex: 1,
                          padding: "5px 0",
                          background: "#dcfce7",
                          color: "#166534",
                          border: "1px solid #bbf7d0",
                          borderRadius: "6px",
                          fontSize: "11px",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Aprobar
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await rejectPendingUser(p.id);
                            setPendingUsers((prev) => prev.filter((x) => x.id !== p.id));
                          } catch {}
                        }}
                        style={{
                          padding: "5px 8px",
                          background: "#fee2e2",
                          color: "#dc2626",
                          border: "1px solid #fecaca",
                          borderRadius: "6px",
                          fontSize: "11px",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {loading ? (
            <div style={{ fontSize: "13px", color: "#9ca3af", padding: "12px 0" }}>Cargando...</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {Object.entries(ROLE_META)
                .filter(([roleKey]) => !isConfigurador || roleKey === "responsable")
                .map(([roleKey, m]) => {
                const count = users.filter((u) => (u.roles || [u.role]).includes(roleKey)).length;
                return (
                  <button
                    key={roleKey}
                    onClick={() => setRoleModal(roleKey)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "12px 14px",
                      background: "white",
                      border: "1px solid #e5e7eb",
                      borderRadius: "10px",
                      cursor: "pointer",
                      textAlign: "left",
                      width: "100%",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
                  >
                    <span style={{ fontSize: "22px" }}>{m.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: m.color }}>{m.label}</div>
                      <div style={{ fontSize: "11px", color: "#9ca3af" }}>{count} usuario{count !== 1 ? "s" : ""}</div>
                    </div>
                    <span
                      style={{
                        background: m.bg,
                        color: m.color,
                        borderRadius: "999px",
                        padding: "2px 9px",
                        fontSize: "12px",
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: detail / form */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {showCreateForm ? (
            <div style={cardStyle}>
              <UserForm
                user={null}
                onSave={handleSave}
                onCancel={() => setShowCreateForm(false)}
                projectNodes={projectNodes}
                processes={processes}
                callerRole={currentUser?.role}
              />
            </div>
          ) : selectedUser ? (
            <div style={cardStyle}>
              {deleteConfirm === selectedUser.id ? (
                <div>
                  <div style={{ marginBottom: "14px", fontSize: "14px", color: "#111827" }}>
                    ¿Eliminar al usuario <strong>{selectedUser.username}</strong>? Esta acción no se puede deshacer.
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={() => handleDelete(selectedUser.id)}
                      style={{ padding: "8px 16px", background: "#dc2626", color: "white", border: "none", borderRadius: "7px", fontWeight: 600, cursor: "pointer", fontSize: "13px" }}
                    >
                      Eliminar
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      style={{ padding: "8px 14px", background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb", borderRadius: "7px", cursor: "pointer", fontSize: "13px" }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
                    <div>
                      <div style={{ fontSize: "18px", fontWeight: 700, color: "#111827", marginBottom: "6px" }}>
                        {ROLE_META[selectedUser.role]?.icon} {selectedUser.username}
                      </div>
                      <RoleBadge roles={selectedUser.roles} role={selectedUser.role} />
                    </div>
                    {!isConfigurador && (
                      <button
                        onClick={() => setDeleteConfirm(selectedUser.id)}
                        style={{ padding: "6px 12px", background: "#fee2e2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: "7px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
                      >
                        🗑 Eliminar
                      </button>
                    )}
                  </div>
                  <UserForm
                    user={selectedUser}
                    onSave={handleSave}
                    onCancel={() => setSelectedUser(null)}
                    projectNodes={projectNodes}
                    processes={processes}
                    callerRole={currentUser?.role}
                  />
                </>
              )}
            </div>
          ) : (
            <div
              style={{
                ...cardStyle,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                minHeight: "220px",
                color: "#9ca3af",
                gap: "10px",
              }}
            >
              <div style={{ fontSize: "2.5rem" }}>👥</div>
              <div style={{ fontSize: "14px", fontWeight: 500 }}>
                Selecciona un usuario para editar o crea uno nuevo
              </div>
              <div style={{ fontSize: "12px" }}>
                {users.length} usuario(s) en el sistema
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Role users modal */}
      {roleModal && (() => {
        const m = ROLE_META[roleModal];
        const roleUsers = users.filter((u) => (u.roles || (u.role ? [u.role] : [])).includes(roleModal));
        return (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(17,24,39,0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1500,
            }}
            onClick={() => setRoleModal(null)}
          >
            <div
              style={{
                background: "white",
                borderRadius: "14px",
                width: "340px",
                maxHeight: "70vh",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal header */}
              <div
                style={{
                  padding: "14px 18px",
                  borderBottom: "1px solid #e5e7eb",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: m.bg,
                }}
              >
                <div style={{ fontSize: "15px", fontWeight: 700, color: m.color }}>
                  {m.icon} {m.label}s
                  <span style={{ fontSize: "12px", fontWeight: 400, marginLeft: "8px", color: m.color, opacity: 0.7 }}>
                    {roleUsers.length} usuario{roleUsers.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <button
                  onClick={() => setRoleModal(null)}
                  style={{
                    background: "rgba(0,0,0,0.08)",
                    border: "none",
                    borderRadius: "6px",
                    width: "26px",
                    height: "26px",
                    cursor: "pointer",
                    fontSize: "14px",
                    color: m.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Modal user list */}
              <div style={{ overflowY: "auto", flex: 1 }}>
                {roleUsers.length === 0 ? (
                  <div style={{ padding: "24px", textAlign: "center", fontSize: "13px", color: "#9ca3af" }}>
                    No hay usuarios con este rol
                  </div>
                ) : (
                  roleUsers.map((u) => (
                    <div
                      key={u.id}
                      onClick={() => { setSelectedUser(u); setShowCreateForm(false); setRoleModal(null); }}
                      style={{
                        padding: "12px 18px",
                        borderBottom: "1px solid #f3f4f6",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        background: selectedUser?.id === u.id ? "#eff6ff" : "white",
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={(e) => { if (selectedUser?.id !== u.id) e.currentTarget.style.background = "#f9fafb"; }}
                      onMouseLeave={(e) => { if (selectedUser?.id !== u.id) e.currentTarget.style.background = "white"; }}
                    >
                      <span style={{ fontSize: "20px" }}>{m.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {u.username}
                        </div>
                        {u.preregistered && (
                          <span style={{ fontSize: "10px", background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0", borderRadius: "999px", padding: "1px 6px", fontWeight: 600 }}>
                            ⌚ Pendiente ingreso
                          </span>
                        )}
                        {!u.preregistered && (u.roles || [u.role]).includes("responsable") && u.assigned_project_ids?.length > 0 && (
                          <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>
                            {u.assigned_project_ids.length} elemento(s) asignado(s)
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize: "11px", color: "#9ca3af" }}>✏ Editar</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default UserManagementPanel;
