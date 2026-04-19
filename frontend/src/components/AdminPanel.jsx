import { useState, useEffect, useCallback } from "react";

const API = "/api";

const PROVIDERS = ["local", "azure_blob", "gcs", "s3"];
const SCOPE_TYPES = ["global", "folder", "process"];

const getAuthHeaders = () => {
  const token = localStorage.getItem("authToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

function Badge({ color, children }) {
  const colors = {
    green: { background: "#d1fae5", color: "#065f46" },
    yellow: { background: "#fef3c7", color: "#92400e" },
    red: { background: "#fee2e2", color: "#991b1b" },
    gray: { background: "#f3f4f6", color: "#374151" },
    blue: { background: "#dbeafe", color: "#1e40af" },
  };
  return (
    <span
      style={{
        ...colors[color] || colors.gray,
        padding: "2px 8px",
        borderRadius: "999px",
        fontSize: "11px",
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

function SummaryCards({ summary }) {
  const cards = [
    {
      label: "Suscripciones activas",
      value: summary?.subscriptions?.active ?? "—",
      sub: `de ${summary?.subscriptions?.total ?? 0} total`,
      color: "#3b82f6",
    },
    {
      label: "Jobs completados",
      value: summary?.delivery_jobs?.completed ?? "—",
      sub: `${summary?.delivery_jobs?.partial ?? 0} parciales · ${summary?.delivery_jobs?.total ?? 0} total`,
      color: "#10b981",
    },
    {
      label: "Artefactos escritos",
      value: summary?.artifacts?.total ?? "—",
      sub: "archivos Parquet + manifest",
      color: "#8b5cf6",
    },
  ];
  return (
    <div style={{ display: "flex", gap: "12px", marginBottom: "24px", flexWrap: "wrap" }}>
      {cards.map((c) => (
        <div
          key={c.label}
          style={{
            flex: "1 1 180px",
            background: "white",
            border: "1px solid #e5e7eb",
            borderRadius: "10px",
            padding: "16px 20px",
            borderTop: `3px solid ${c.color}`,
          }}
        >
          <div style={{ fontSize: "22px", fontWeight: 700, color: c.color }}>{c.value}</div>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "#111827", marginTop: "2px" }}>{c.label}</div>
          <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

function SubscriptionsTab({ onRefreshSummary }) {
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [processes, setProcesses] = useState([]);
  const [processMap, setProcessMap] = useState({});
  const [folderNodes, setFolderNodes] = useState([]);
  const [folderNodeMap, setFolderNodeMap] = useState({});
  const [levelNames, setLevelNames] = useState([]);   // ["Compañía","Departamento","Proyecto"]
  const [activeLevel, setActiveLevel] = useState("global"); // "global" | levelName | "process"
  const [form, setForm] = useState({
    scope_id: "",
    provider: "local",
    base_path: "",
    active: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/admin/subscriptions`);
      setSubs(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch(`${API}/upload/`)
      .then((r) => r.json())
      .then((list) => {
        if (Array.isArray(list)) {
          setProcesses(list);
          const map = {};
          list.forEach((p) => { map[p.id] = p.process_name || p.file_name || p.id; });
          setProcessMap(map);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${API}/admin/folder-nodes`)
      .then((r) => r.json())
      .then((nodes) => {
        if (Array.isArray(nodes)) {
          setFolderNodes(nodes);
          const map = {};
          nodes.forEach((n) => { map[n.id] = n; });
          setFolderNodeMap(map);
          // Unique level names in ascending level order
          const seen = [];
          nodes.forEach((n) => { if (!seen.includes(n.level_name)) seen.push(n.level_name); });
          setLevelNames(seen);
        }
      })
      .catch(() => {});
  }, []);

  // Derive scope_type from activeLevel
  const activeScopeType = activeLevel === "global" ? "global"
    : activeLevel === "process" ? "process"
    : "folder";

  // Nodes available for current folder level
  const nodesForActiveLevel = folderNodes.filter((n) => n.level_name === activeLevel);

  // Subscriptions visible in the current level
  const visibleSubs = subs.filter((s) => {
    if (activeLevel === "global") return s.scope_type === "global";
    if (activeLevel === "process") return s.scope_type === "process";
    // folder level: must be folder scope AND the node's level_name matches
    return s.scope_type === "folder" && folderNodeMap[s.scope_id]?.level_name === activeLevel;
  });

  const handleLevelChange = (lvl) => {
    setActiveLevel(lvl);
    setShowCreate(false);
    setForm({ scope_id: "", provider: "local", base_path: "", active: true });
  };

  const handleCreate = async () => {
    const config = {};
    if (form.provider === "local" && form.base_path) config.base_path = form.base_path;
    const body = {
      scope_type: activeScopeType,
      scope_id: activeScopeType === "global" ? "" : form.scope_id,
      provider: form.provider,
      config,
      active: form.active,
    };
    await fetch(`${API}/admin/subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setShowCreate(false);
    setForm({ scope_id: "", provider: "local", base_path: "", active: true });
    load();
    onRefreshSummary();
  };

  const handleToggle = async (sub) => {
    await fetch(`${API}/admin/subscriptions/${sub.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !sub.active }),
    });
    load();
    onRefreshSummary();
  };

  const handleDelete = async (id) => {
    if (!window.confirm("¿Eliminar esta suscripción?")) return;
    await fetch(`${API}/admin/subscriptions/${id}`, { method: "DELETE" });
    load();
    onRefreshSummary();
  };

  const inputStyle = {
    padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: "6px",
    fontSize: "13px", background: "white", width: "100%", boxSizing: "border-box",
  };

  // Build level tabs: Global → folder levels → Por Proceso
  const levelTabs = [
    { key: "global", label: "🌐 Global", color: "#8b5cf6" },
    ...levelNames.map((ln) => ({ key: ln, label: `📂 ${ln}`, color: "#3b82f6" })),
    { key: "process", label: "⚙️ Por Proceso", color: "#10b981" },
  ];

  const activeTab = levelTabs.find((t) => t.key === activeLevel) || levelTabs[0];

  // Count subs per tab for badge
  const countForTab = (tabKey) => subs.filter((s) => {
    if (tabKey === "global") return s.scope_type === "global";
    if (tabKey === "process") return s.scope_type === "process";
    return s.scope_type === "folder" && folderNodeMap[s.scope_id]?.level_name === tabKey;
  }).length;

  return (
    <div>
      {/* ── Level selector ── */}
      <div style={{
        display: "flex", gap: "6px", flexWrap: "wrap",
        borderBottom: "2px solid #f3f4f6", paddingBottom: "12px", marginBottom: "16px",
      }}>
        {levelTabs.map((tab) => {
          const isActive = tab.key === activeLevel;
          const count = countForTab(tab.key);
          return (
            <button
              key={tab.key}
              onClick={() => handleLevelChange(tab.key)}
              style={{
                padding: "6px 14px",
                background: isActive ? tab.color : "white",
                color: isActive ? "white" : "#374151",
                border: `1.5px solid ${isActive ? tab.color : "#e5e7eb"}`,
                borderRadius: "999px",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: isActive ? 700 : 500,
                display: "flex", alignItems: "center", gap: "6px",
                transition: "all 0.15s",
              }}
            >
              {tab.label}
              <span style={{
                background: isActive ? "rgba(255,255,255,0.3)" : "#f3f4f6",
                color: isActive ? "white" : "#6b7280",
                borderRadius: "999px", padding: "0 6px", fontSize: "11px", fontWeight: 700,
                minWidth: "18px", textAlign: "center",
              }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Context description + create button ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
        <div>
          <div style={{ fontSize: "14px", fontWeight: 700, color: activeTab.color }}>
            {activeTab.label}
          </div>
          <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>
            {activeLevel === "global" && "Se aplica a todas las ejecuciones sin importar el proceso o carpeta."}
            {activeLevel === "process" && "Se aplica únicamente a un proceso específico."}
            {activeScopeType === "folder" && `Se aplica a todos los procesos bajo cualquier nodo de nivel "${activeLevel}" y sus subniveles.`}
          </div>
        </div>
        <button
          onClick={() => { setShowCreate((v) => !v); setForm({ scope_id: "", provider: "local", base_path: "", active: true }); }}
          style={{
            padding: "6px 14px", background: activeTab.color, color: "white",
            border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          + Nueva suscripción
        </button>
      </div>

      {/* ── Create form (context-aware) ── */}
      {showCreate && (
        <div style={{
          background: "#f9fafb", border: `1px solid ${activeTab.color}40`,
          borderLeft: `3px solid ${activeTab.color}`,
          borderRadius: "8px", padding: "16px", marginBottom: "16px",
        }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#374151", marginBottom: "12px" }}>
            Nueva suscripción — nivel <span style={{ color: activeTab.color }}>{activeTab.label}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", display: "block", marginBottom: "4px" }}>
                Proveedor
              </label>
              <select
                style={inputStyle}
                value={form.provider}
                onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
              >
                {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            {/* scope_id picker — only for folder or process levels */}
            {activeScopeType === "folder" && (
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", display: "block", marginBottom: "4px" }}>
                  Nodo "{activeLevel}"
                </label>
                {nodesForActiveLevel.length > 0 ? (
                  <select
                    style={inputStyle}
                    value={form.scope_id}
                    onChange={(e) => setForm((f) => ({ ...f, scope_id: e.target.value }))}
                  >
                    <option value="">— Selecciona un nodo —</option>
                    {nodesForActiveLevel.map((n) => (
                      <option key={n.id} value={n.id}>{n.full_path}</option>
                    ))}
                  </select>
                ) : (
                  <div style={{ fontSize: "12px", color: "#9ca3af", padding: "6px 0" }}>
                    No hay nodos de nivel "{activeLevel}" creados aún.
                  </div>
                )}
                {form.scope_id && folderNodeMap[form.scope_id] && (
                  <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "4px" }}>
                    ↳ Cubrirá todos los procesos dentro de <strong>{folderNodeMap[form.scope_id].full_path}</strong> y sus subniveles.
                  </div>
                )}
              </div>
            )}

            {activeScopeType === "process" && (
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", display: "block", marginBottom: "4px" }}>
                  Proceso
                </label>
                <select
                  style={inputStyle}
                  value={form.scope_id}
                  onChange={(e) => setForm((f) => ({ ...f, scope_id: e.target.value }))}
                >
                  <option value="">— Selecciona un proceso —</option>
                  {processes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.process_name || p.file_name || p.id} ({p.id.slice(0, 8)}…)
                    </option>
                  ))}
                </select>
              </div>
            )}

            {form.provider === "local" && (
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", display: "block", marginBottom: "4px" }}>
                  Ruta local de salida (opcional)
                </label>
                <input
                  style={inputStyle}
                  placeholder="C:/output_delivery o vacío para usar el default"
                  value={form.base_path}
                  onChange={(e) => setForm((f) => ({ ...f, base_path: e.target.value }))}
                />
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
            <button
              onClick={handleCreate}
              disabled={activeScopeType !== "global" && !form.scope_id}
              style={{
                padding: "7px 18px", background: activeTab.color, color: "white",
                border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 600,
                opacity: (activeScopeType !== "global" && !form.scope_id) ? 0.4 : 1,
              }}
            >
              Guardar
            </button>
            <button
              onClick={() => setShowCreate(false)}
              style={{
                padding: "7px 18px", background: "#f3f4f6", color: "#374151",
                border: "1px solid #e5e7eb", borderRadius: "6px", cursor: "pointer", fontSize: "13px",
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ── Subscription list for this level ── */}
      {loading ? (
        <div style={{ color: "#6b7280", fontSize: "13px" }}>Cargando…</div>
      ) : visibleSubs.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "32px", color: "#9ca3af", fontSize: "13px",
          border: "1px dashed #e5e7eb", borderRadius: "8px",
        }}>
          No hay suscripciones en este nivel. Crea una con el botón de arriba.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {visibleSubs.map((sub) => (
            <div
              key={sub.id}
              style={{
                background: "white", border: "1px solid #e5e7eb", borderRadius: "8px",
                padding: "10px 14px", display: "flex", alignItems: "center", gap: "12px",
                opacity: sub.active ? 1 : 0.55,
                borderLeft: `3px solid ${activeTab.color}`,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "3px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#111827" }}>
                    {sub.provider}
                  </span>
                  <Badge color={sub.active ? "green" : "gray"}>{sub.active ? "activa" : "inactiva"}</Badge>
                  {sub.scope_id && (
                    <span style={{ fontSize: "12px", color: "#374151", fontWeight: 500 }}>
                      {activeScopeType === "process"
                        ? (processMap[sub.scope_id] || sub.scope_id.slice(0, 8) + "…")
                        : activeScopeType === "folder"
                          ? (folderNodeMap[sub.scope_id]?.full_path || sub.scope_id.slice(0, 8) + "…")
                          : null}
                    </span>
                  )}
                </div>
                {sub.config?.base_path && (
                  <div style={{ fontSize: "11px", color: "#9ca3af" }}>📁 {sub.config.base_path}</div>
                )}
                <div style={{ fontSize: "10px", color: "#d1d5db", marginTop: "2px" }}>ID: {sub.id}</div>
              </div>
              <button
                onClick={() => handleToggle(sub)}
                style={{
                  padding: "4px 10px", background: sub.active ? "#fef3c7" : "#d1fae5",
                  color: sub.active ? "#92400e" : "#065f46",
                  border: "1px solid transparent", borderRadius: "6px", cursor: "pointer", fontSize: "12px",
                  whiteSpace: "nowrap",
                }}
              >
                {sub.active ? "Desactivar" : "Activar"}
              </button>
              <button
                onClick={() => handleDelete(sub.id)}
                style={{
                  padding: "4px 10px", background: "#fee2e2", color: "#991b1b",
                  border: "1px solid transparent", borderRadius: "6px", cursor: "pointer", fontSize: "12px",
                  whiteSpace: "nowrap",
                }}
              >
                Eliminar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DeliveryJobsTab() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const [artifacts, setArtifacts] = useState([]);

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/admin/delivery-jobs?limit=100`)
      .then((r) => r.json())
      .then((d) => { setJobs(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const loadArtifacts = async (job) => {
    setSelectedJob(job);
    const res = await fetch(`${API}/admin/artifacts?delivery_job_id=${job.id}`);
    setArtifacts(await res.json());
  };

  const statusColor = (s) => s === "completed" ? "green" : s === "partial" ? "yellow" : s === "running" ? "blue" : "red";

  return (
    <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "14px", fontWeight: 600, color: "#111827", marginBottom: "10px" }}>
          Jobs de entrega ({jobs.length})
        </div>
        {loading ? (
          <div style={{ color: "#6b7280", fontSize: "13px" }}>Cargando…</div>
        ) : jobs.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px", color: "#9ca3af", fontSize: "13px" }}>
            Aún no hay jobs. Los jobs se crean automáticamente tras cada ejecución cuando hay suscripciones activas.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {jobs.map((job) => (
              <div
                key={job.id}
                onClick={() => loadArtifacts(job)}
                style={{
                  background: selectedJob?.id === job.id ? "#eff6ff" : "white",
                  border: `1px solid ${selectedJob?.id === job.id ? "#bfdbfe" : "#e5e7eb"}`,
                  borderRadius: "8px", padding: "10px 14px", cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px" }}>
                  <Badge color={statusColor(job.status)}>{job.status}</Badge>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "#111827" }}>
                    {job.table_name || "—"} · {job.sheet_name || "—"}
                  </span>
                </div>
                <div style={{ fontSize: "11px", color: "#6b7280" }}>
                  {job.subscription_count} sink(s) · {job.error_count} error(s) ·{" "}
                  {job.started_at ? new Date(job.started_at).toLocaleString("es-ES") : "—"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedJob && (
        <div style={{
          width: "360px", background: "#f9fafb", border: "1px solid #e5e7eb",
          borderRadius: "10px", padding: "14px",
        }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#374151", marginBottom: "10px" }}>
            Artefactos — {selectedJob.table_name}
          </div>
          {artifacts.length === 0 ? (
            <div style={{ color: "#9ca3af", fontSize: "12px" }}>Sin artefactos</div>
          ) : (
            artifacts.map((a) => (
              <div
                key={a.id}
                style={{
                  background: "white", border: "1px solid #e5e7eb", borderRadius: "6px",
                  padding: "8px 12px", marginBottom: "6px",
                }}
              >
                <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "4px" }}>
                  <Badge color={a.status === "ok" ? "green" : "red"}>{a.status}</Badge>
                  <span style={{ fontSize: "12px", fontWeight: 600 }}>{a.sink_provider}</span>
                </div>
                {a.uri && (
                  <div style={{ fontSize: "10px", color: "#6b7280", wordBreak: "break-all", marginBottom: "2px" }}>
                    📄 {a.uri}
                  </div>
                )}
                <div style={{ fontSize: "10px", color: "#9ca3af" }}>
                  {a.row_count} filas · MD5: {a.checksum?.slice(0, 8) || "—"}
                </div>
                {a.error && (
                  <div style={{ fontSize: "10px", color: "#ef4444", marginTop: "2px" }}>{a.error}</div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function DebugTab() {
  const [processId, setProcessId] = useState("");
  const [executionId, setExecutionId] = useState("");
  const [matchResult, setMatchResult] = useState(null);
  const [redispatchResult, setRedispatchResult] = useState(null);
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [processes, setProcesses] = useState([]);
  const [executions, setExecutions] = useState([]);

  useEffect(() => {
    fetch(`${API}/upload/`)
      .then((r) => r.json())
      .then((list) => setProcesses(Array.isArray(list) ? list : []))
      .catch(() => {});
    fetch(`${API}/admin/debug/errors`)
      .then((r) => r.json())
      .then(setErrors)
      .catch(() => {});
  }, []);

  const loadExecutions = async (pid) => {
    setProcessId(pid);
    setExecutionId("");
    setMatchResult(null);
    setRedispatchResult(null);
    if (!pid) { setExecutions([]); return; }
    const res = await fetch(`${API}/rules/executions/${pid}`);
    setExecutions(await res.json());
  };

  const checkMatch = async () => {
    if (!processId) return;
    setLoading(true);
    const res = await fetch(`${API}/admin/debug/match/${processId}`);
    setMatchResult(await res.json());
    setLoading(false);
  };

  const redispatch = async () => {
    if (!executionId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/admin/debug/redispatch/${executionId}`, { method: "POST" });
      const data = await res.json();
      setRedispatchResult(data);
      // Refresh errors after redispatch
      const errs = await fetch(`${API}/admin/debug/errors`).then((r) => r.json());
      setErrors(errs);
    } catch (e) {
      setRedispatchResult({ error: e.message });
    }
    setLoading(false);
  };

  const inputStyle = {
    padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: "6px",
    fontSize: "13px", background: "white", width: "100%", boxSizing: "border-box",
  };

  const pre = (obj) => (
    <pre style={{
      fontSize: "11px", background: "#111827", color: "#d1fae5",
      padding: "10px", borderRadius: "6px", overflowX: "auto", margin: "8px 0",
      maxHeight: "260px", overflowY: "auto",
    }}>
      {JSON.stringify(obj, null, 2)}
    </pre>
  );

  return (
    <div>
      <div style={{ fontSize: "14px", fontWeight: 700, color: "#111827", marginBottom: "16px" }}>
        Diagnóstico de entrega
      </div>

      {/* Step 1 — check match */}
      <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "14px", marginBottom: "12px" }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "10px" }}>
          1. ¿Qué suscripciones matchean este proceso?
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <select
            style={{ ...inputStyle, flex: 1 }}
            value={processId}
            onChange={(e) => loadExecutions(e.target.value)}
          >
            <option value="">— Selecciona un proceso —</option>
            {processes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.process_name || p.file_name || p.id}
              </option>
            ))}
          </select>
          <button
            onClick={checkMatch}
            disabled={!processId || loading}
            style={{
              padding: "6px 16px", background: "#3b82f6", color: "white",
              border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 600,
              opacity: !processId ? 0.5 : 1,
            }}
          >
            Verificar
          </button>
        </div>
        {matchResult && (
          <div style={{ marginTop: "10px" }}>
            <div style={{ fontSize: "12px", fontWeight: 600, color: matchResult.matched_count > 0 ? "#065f46" : "#991b1b", marginBottom: "4px" }}>
              {matchResult.matched_count > 0
                ? `✅ ${matchResult.matched_count} suscripción(es) activa(s) matchean este proceso`
                : "❌ Ninguna suscripción matchea — verifica que el scope_id sea el ID correcto del proceso"}
            </div>
            {pre(matchResult)}
          </div>
        )}
      </div>

      {/* Step 2 — redispatch */}
      <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "14px", marginBottom: "12px" }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "10px" }}>
          2. Re-disparar entrega para una ejecución pasada
        </div>
        {processId && executions.length > 0 ? (
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <select
              style={{ ...inputStyle, flex: 1 }}
              value={executionId}
              onChange={(e) => setExecutionId(e.target.value)}
            >
              <option value="">— Selecciona una ejecución —</option>
              {executions.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.sheet_name} · {new Date(e.timestamp).toLocaleString("es-ES")} · {e.id.slice(0, 8)}…
                </option>
              ))}
            </select>
            <button
              onClick={redispatch}
              disabled={!executionId || loading}
              style={{
                padding: "6px 16px", background: "#10b981", color: "white",
                border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 600,
                opacity: !executionId ? 0.5 : 1,
              }}
            >
              Re-disparar
            </button>
          </div>
        ) : (
          <div style={{ fontSize: "12px", color: "#9ca3af" }}>
            {processId ? "No hay ejecuciones para este proceso" : "Selecciona un proceso arriba primero"}
          </div>
        )}
        {redispatchResult && (
          <div style={{ marginTop: "10px" }}>
            {redispatchResult.error ? (
              <div style={{ color: "#ef4444", fontSize: "12px" }}>❌ {redispatchResult.error}</div>
            ) : (
              <div style={{ fontSize: "12px", fontWeight: 600, color: "#065f46", marginBottom: "4px" }}>
                ✅ Redispatch ejecutado — revisa Jobs de entrega para ver el resultado
              </div>
            )}
            {pre(redispatchResult)}
          </div>
        )}
      </div>

      {/* Error log */}
      <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "14px" }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "8px" }}>
          3. Errores recientes del motor de entrega ({errors.length})
        </div>
        {errors.length === 0 ? (
          <div style={{ fontSize: "12px", color: "#6b7280" }}>Sin errores registrados (buena señal).</div>
        ) : (
          errors.map((e, i) => (
            <div key={i} style={{ marginBottom: "8px", borderLeft: "3px solid #ef4444", paddingLeft: "10px" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#374151" }}>{e.ts} — {e.context}</div>
              <div style={{ fontSize: "11px", color: "#ef4444", marginTop: "2px" }}>{e.error}</div>
              <details>
                <summary style={{ fontSize: "10px", color: "#9ca3af", cursor: "pointer" }}>Traceback</summary>
                <pre style={{ fontSize: "10px", color: "#374151", whiteSpace: "pre-wrap", margin: "4px 0" }}>{e.traceback}</pre>
              </details>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function CommitmentMonitorTab() {
  const [nodes, setNodes] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ totals: {}, items: [], top_users: { on_time: [], late: [] } });
  const [userPopup, setUserPopup] = useState({ open: false, title: "", users: [] });
  const [noncompliancePopup, setNoncompliancePopup] = useState({ open: false, late_dates: [], missed_dates: [] });
  const [filters, setFilters] = useState({
    scope_id: "",
    process_id: "",
    status: "",
    user: "",
    include_without_schedule: true,
  });

  useEffect(() => {
    fetch(`${API}/admin/folder-nodes`)
      .then((r) => r.json())
      .then((list) => setNodes(Array.isArray(list) ? list : []))
      .catch(() => {});
    fetch(`${API}/upload/`)
      .then((r) => r.json())
      .then((list) => setProcesses(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.scope_id) params.set("scope_id", filters.scope_id);
      if (filters.process_id) params.set("process_id", filters.process_id);
      if (filters.status) params.set("status", filters.status);
      if (filters.user.trim()) params.set("user", filters.user.trim());
      params.set("include_without_schedule", String(filters.include_without_schedule));
      const res = await fetch(`${API}/admin/commitment-monitor?${params.toString()}`);
      const body = await res.json();
      setData({
        totals: body?.totals || {},
        items: body?.items || [],
        top_users: body?.top_users || { on_time: [], late: [] },
      });
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const statusBadge = (status) => {
    if (status === "cumplido") return <Badge color="green">Cumplido</Badge>;
    if (status === "proximo") return <Badge color="yellow">Próximo</Badge>;
    if (status === "atrasado") return <Badge color="red">Atrasado</Badge>;
    return <Badge color="gray">Sin compromiso</Badge>;
  };

  const toLocal = (iso) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("es-ES", {
      timeZone: "America/Santiago",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const inputStyle = {
    padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: "6px",
    fontSize: "13px", background: "white", width: "100%", boxSizing: "border-box",
  };

  const openUsersPopup = (title, users) => {
    setUserPopup({
      open: true,
      title,
      users: Array.isArray(users) ? users : [],
    });
  };

  const closeUsersPopup = () => setUserPopup({ open: false, title: "", users: [] });
  const openNoncompliancePopup = (late_dates, missed_dates) => {
    setNoncompliancePopup({ open: true, late_dates, missed_dates });
  };
  const closeNoncompliancePopup = () => setNoncompliancePopup({ open: false, late_dates: [], missed_dates: [] });

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(120px, 1fr))", gap: "8px", marginBottom: "12px" }}>
        <select
          style={inputStyle}
          value={filters.scope_id}
          onChange={(e) => setFilters((f) => ({ ...f, scope_id: e.target.value }))}
        >
          <option value="">Todas las carpetas</option>
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>{n.full_path}</option>
          ))}
        </select>

        <select
          style={inputStyle}
          value={filters.process_id}
          onChange={(e) => setFilters((f) => ({ ...f, process_id: e.target.value }))}
        >
          <option value="">Todos los procesos</option>
          {processes.map((p) => (
            <option key={p.id} value={p.id}>{p.process_name || p.file_name || p.id}</option>
          ))}
        </select>

        <select
          style={inputStyle}
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
        >
          <option value="">Todos los estados</option>
          <option value="cumplido">Cumplido</option>
          <option value="proximo">Próximo</option>
          <option value="atrasado">Atrasado</option>
          <option value="sin_compromiso">Sin compromiso</option>
        </select>

        <input
          style={inputStyle}
          placeholder="Filtrar por usuario"
          value={filters.user}
          onChange={(e) => setFilters((f) => ({ ...f, user: e.target.value }))}
        />

        <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#374151", background: "white", border: "1px solid #e5e7eb", borderRadius: "6px", padding: "0 10px" }}>
          <input
            type="checkbox"
            checked={filters.include_without_schedule}
            onChange={(e) => setFilters((f) => ({ ...f, include_without_schedule: e.target.checked }))}
          />
          Incluir sin compromiso
        </label>
      </div>

      <div style={{ display: "flex", gap: "12px", marginBottom: "14px", flexWrap: "wrap" }}>
        <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "10px 12px" }}>
          <div style={{ fontSize: "11px", color: "#6b7280" }}>Cumplidos</div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: "#10b981" }}>{data.totals?.cumplido ?? 0}</div>
        </div>
        <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "10px 12px" }}>
          <div style={{ fontSize: "11px", color: "#6b7280" }}>Próximos</div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: "#d97706" }}>{data.totals?.proximo ?? 0}</div>
        </div>
        <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "10px 12px" }}>
          <div style={{ fontSize: "11px", color: "#6b7280" }}>Atrasados</div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: "#dc2626" }}>{data.totals?.atrasado ?? 0}</div>
        </div>
        <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "10px 12px" }}>
          <div style={{ fontSize: "11px", color: "#6b7280" }}>Sin compromiso</div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: "#6b7280" }}>{data.totals?.sin_compromiso ?? 0}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "14px" }}>
        <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "10px 12px" }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#065f46", marginBottom: "6px" }}>Top cumplimiento usuario</div>
          {(data.top_users?.on_time || []).slice(0, 5).map((u) => (
            <div key={`ok-${u.user}`} style={{ fontSize: "12px", color: "#374151", display: "flex", justifyContent: "space-between" }}>
              <span>{u.user}</span>
              <strong>{u.count}</strong>
            </div>
          ))}
          {(data.top_users?.on_time || []).length === 0 && <div style={{ fontSize: "12px", color: "#9ca3af" }}>Sin datos</div>}
        </div>

        <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "10px 12px" }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#991b1b", marginBottom: "6px" }}>Top fuera de tiempo usuario</div>
          {(data.top_users?.late || []).slice(0, 5).map((u) => (
            <div key={`late-${u.user}`} style={{ fontSize: "12px", color: "#374151", display: "flex", justifyContent: "space-between" }}>
              <span>{u.user}</span>
              <strong>{u.count}</strong>
            </div>
          ))}
          {(data.top_users?.late || []).length === 0 && <div style={{ fontSize: "12px", color: "#9ca3af" }}>Sin datos</div>}
        </div>
      </div>

      {loading ? (
        <div style={{ color: "#6b7280", fontSize: "13px" }}>Cargando monitoreo…</div>
      ) : data.items.length === 0 ? (
        <div style={{ textAlign: "center", padding: "32px", color: "#9ca3af", fontSize: "13px", border: "1px dashed #e5e7eb", borderRadius: "8px" }}>
          No hay procesos para los filtros seleccionados.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", background: "white", border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
            <thead>
              <tr style={{ background: "#f9fafb", color: "#374151", textAlign: "left" }}>
                <th style={{ padding: "8px", borderBottom: "1px solid #e5e7eb" }}>Estado</th>
                <th style={{ padding: "8px", borderBottom: "1px solid #e5e7eb" }}>Proceso</th>
                <th style={{ padding: "8px", borderBottom: "1px solid #e5e7eb" }}>Carpeta</th>
                <th style={{ padding: "8px", borderBottom: "1px solid #e5e7eb" }}>Próximo vencimiento</th>
                <th style={{ padding: "8px", borderBottom: "1px solid #e5e7eb" }}>Última carga</th>
                <th style={{ padding: "8px", borderBottom: "1px solid #e5e7eb" }}>usuarios_relevantes</th>
                <th style={{ padding: "8px", borderBottom: "1px solid #e5e7eb" }}>Cumplimiento histórico</th>
                <th style={{ padding: "8px", borderBottom: "1px solid #e5e7eb" }}>Incumplimientos</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.process_id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "8px", verticalAlign: "top" }}>{statusBadge(item.monitor_status)}</td>
                  <td style={{ padding: "8px", verticalAlign: "top" }}>
                    <div style={{ fontWeight: 700, color: "#111827" }}>{item.process_name}</div>
                    <div style={{ fontSize: "10px", color: "#9ca3af" }}>{item.process_id}</div>
                  </td>
                  <td style={{ padding: "8px", verticalAlign: "top", color: "#374151" }}>{(item.folder_path || []).join(" / ") || "—"}</td>
                  <td style={{ padding: "8px", verticalAlign: "top", color: "#374151" }}>{toLocal(item.next_due_at)}</td>
                  <td style={{ padding: "8px", verticalAlign: "top", color: "#374151" }}>{toLocal(item.last_execution?.timestamp)}</td>
                  <td style={{ padding: "8px", verticalAlign: "top", color: "#374151" }}>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => openUsersPopup("Configurador del proceso", item.configuradores || [])}
                        style={{
                          border: "1px solid #16a34a",
                          background: "#f0fdf4",
                          color: "#166534",
                          fontSize: "11px",
                          fontWeight: 700,
                          borderRadius: "999px",
                          padding: "3px 8px",
                          cursor: "pointer",
                        }}
                      >
                        [Configurador]
                      </button>
                      <button
                        type="button"
                        onClick={() => openUsersPopup("Responsables del proceso", item.responsables || [])}
                        style={{
                          border: "1px solid #2563eb",
                          background: "#eff6ff",
                          color: "#1d4ed8",
                          fontSize: "11px",
                          fontWeight: 700,
                          borderRadius: "999px",
                          padding: "3px 8px",
                          cursor: "pointer",
                        }}
                      >
                        [Responsables]
                      </button>
                    </div>
                  </td>
                  <td style={{ padding: "8px", verticalAlign: "top", color: "#374151" }}>
                    {item.stats?.compliance_rate == null ? "—" : `${item.stats.compliance_rate}%`} ({item.stats?.on_time_days ?? 0}/{item.stats?.due_days ?? 0})
                  </td>
                  <td style={{ padding: "8px", verticalAlign: "top", color: "#991b1b", fontWeight: 600 }}>
                    <button
                      onClick={() => openNoncompliancePopup(item.stats?.late_dates || [], item.stats?.missed_dates || [])}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#991b1b",
                        fontWeight: 600,
                        cursor: "pointer",
                        textDecoration: "underline",
                      }}
                    >
                      {(() => {
                        const late = item.stats?.late_days ?? 0;
                        const missed = item.stats?.missed_days ?? 0;
                        return `${late + missed} (${late} tardías, ${missed} faltantes)`;
                      })()}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {userPopup.open && (
        <div
          onClick={closeUsersPopup}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(17, 24, 39, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
            padding: "16px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(460px, 95vw)",
              background: "white",
              borderRadius: "10px",
              border: "1px solid #e5e7eb",
              boxShadow: "0 20px 45px rgba(0, 0, 0, 0.2)",
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid #e5e7eb" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>{userPopup.title}</div>
              <button
                type="button"
                onClick={closeUsersPopup}
                style={{ border: "none", background: "transparent", color: "#6b7280", fontSize: "20px", lineHeight: 1, cursor: "pointer" }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: "12px", maxHeight: "52vh", overflowY: "auto" }}>
              {userPopup.users.length === 0 ? (
                <div style={{ fontSize: "13px", color: "#9ca3af" }}>Sin usuarios registrados.</div>
              ) : (
                userPopup.users.map((u) => (
                  <div key={u} style={{ fontSize: "13px", color: "#374151", padding: "6px 0", borderBottom: "1px solid #f3f4f6" }}>
                    {u}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {noncompliancePopup.open && (
        <div
          onClick={closeNoncompliancePopup}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(17, 24, 39, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
            padding: "16px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(460px, 95vw)",
              background: "white",
              borderRadius: "10px",
              border: "1px solid #e5e7eb",
              boxShadow: "0 20px 45px rgba(0, 0, 0, 0.2)",
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid #e5e7eb" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>Detalles de Incumplimientos</div>
              <button
                type="button"
                onClick={closeNoncompliancePopup}
                style={{ border: "none", background: "transparent", color: "#6b7280", fontSize: "20px", lineHeight: 1, cursor: "pointer" }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: "12px", maxHeight: "52vh", overflowY: "auto" }}>
              {noncompliancePopup.late_dates.length === 0 && noncompliancePopup.missed_dates.length === 0 ? (
                <div style={{ fontSize: "13px", color: "#9ca3af" }}>Sin incumplimientos.</div>
              ) : (
                <div>
                  {noncompliancePopup.late_dates.length > 0 && (
                    <div style={{ marginBottom: "12px" }}>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "#dc2626", marginBottom: "6px" }}>Cargas tardías:</div>
                      {noncompliancePopup.late_dates.map((item, i) => {
                        const date = typeof item === "string" ? item : item.date;
                        const ranges = typeof item === "object" ? (item.ranges || []) : [];
                        const dateLabel = new Date(date + "T12:00:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
                        return (
                          <div key={i} style={{ fontSize: "12px", color: "#374151", padding: "4px 0", display: "flex", alignItems: "center", gap: "8px" }}>
                            <span>{dateLabel}</span>
                            {ranges.length > 0 && (
                              <span style={{ fontSize: "11px", color: "#6b7280", background: "#f3f4f6", borderRadius: "4px", padding: "1px 6px" }}>
                                {ranges.map(r => `${r.hora_inicio}–${r.hora_fin}`).join(", ")}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {noncompliancePopup.missed_dates.length > 0 && (
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "#8b5cf6", marginBottom: "6px" }}>Cargas faltantes:</div>
                      {noncompliancePopup.missed_dates.map((item, i) => {
                        const date = typeof item === "string" ? item : item.date;
                        const ranges = typeof item === "object" ? (item.ranges || []) : [];
                        const dateLabel = new Date(date + "T12:00:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
                        return (
                          <div key={i} style={{ fontSize: "12px", color: "#374151", padding: "4px 0", display: "flex", alignItems: "center", gap: "8px" }}>
                            <span>{dateLabel}</span>
                            {ranges.length > 0 && (
                              <span style={{ fontSize: "11px", color: "#6b7280", background: "#f3f4f6", borderRadius: "4px", padding: "1px 6px" }}>
                                {ranges.map(r => `${r.hora_inicio}–${r.hora_fin}`).join(", ")}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RoleTraceabilityTab() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ folders: [], folder_aggregate: [], processes: [], users: [] });
  const [allUsers, setAllUsers] = useState([]);
  const [filters, setFilters] = useState({ scope_id: "", process_id: "", role: "", user: "" });
  const [assignDraft, setAssignDraft] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.scope_id) params.set("scope_id", filters.scope_id);
      if (filters.process_id) params.set("process_id", filters.process_id);
      if (filters.role) params.set("role", filters.role);
      if (filters.user.trim()) params.set("user", filters.user.trim());

      const [traceRes, usersRes] = await Promise.all([
        fetch(`${API}/admin/role-traceability?${params.toString()}`, { headers: getAuthHeaders() }),
        fetch(`${API}/users/`, { headers: getAuthHeaders() }),
      ]);

      const trace = await traceRes.json();
      const users = await usersRes.json();

      setData({
        folders: trace?.folders || [],
        folder_aggregate: trace?.folder_aggregate || [],
        processes: trace?.processes || [],
        users: trace?.users || [],
      });
      setAllUsers(Array.isArray(users) ? users : []);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const inputStyle = {
    padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: "6px",
    fontSize: "13px", background: "white", width: "100%", boxSizing: "border-box",
  };

  const usersForRole = (roleName) => allUsers.filter((u) => u.role === roleName);

  const setDraft = (processId, roleName, value) => {
    setAssignDraft((d) => ({ ...d, [`${processId}:${roleName}`]: value }));
  };

  const assignToProcess = async (processId, roleName) => {
    const key = `${processId}:${roleName}`;
    const userId = assignDraft[key];
    if (!userId) return;
    const target = allUsers.find((u) => u.id === userId);
    if (!target) return;

    const currentIds = target.assigned_project_ids || [];
    if (!currentIds.includes(processId)) {
      await fetch(`${API}/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ assigned_project_ids: [...currentIds, processId] }),
      });
    }
    setDraft(processId, roleName, "");
    load();
  };

  const unassignFromProcess = async (processId, userObj) => {
    const currentIds = userObj.assigned_project_ids || [];
    if (!currentIds.includes(processId)) return;
    await fetch(`${API}/users/${userObj.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ assigned_project_ids: currentIds.filter((x) => x !== processId) }),
    });
    load();
  };

  const roleColor = (r) => {
    if (r === "admin") return "blue";
    if (r === "configurador") return "green";
    return "yellow";
  };

  const userChip = (u, processId, roleName) => {
    const direct = (u.assigned_project_ids || []).includes(processId);
    return (
      <span
        key={`${processId}-${roleName}-${u.id}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "2px 8px",
          borderRadius: "999px",
          fontSize: "11px",
          border: `1px solid ${direct ? "#d1d5db" : "#bfdbfe"}`,
          background: direct ? "#ffffff" : "#eff6ff",
          color: "#374151",
          marginRight: "6px",
          marginBottom: "4px",
        }}
        title={direct ? "Asignación directa al proceso" : "Asignación heredada por carpeta"}
      >
        {u.username}
        {!direct && <span style={{ fontSize: "10px", color: "#1d4ed8" }}>heredado</span>}
        {direct && (
          <button
            onClick={() => unassignFromProcess(processId, u)}
            style={{
              border: "none",
              background: "transparent",
              color: "#991b1b",
              cursor: "pointer",
              fontSize: "11px",
              padding: 0,
            }}
            title="Quitar asignación directa"
          >
            ×
          </button>
        )}
      </span>
    );
  };

  const roleBlock = (process, roleName) => {
    const roleUsers = process.roles?.[roleName] || [];
    const key = `${process.process_id}:${roleName}`;
    return (
      <div style={{ marginBottom: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
          <Badge color={roleColor(roleName)}>{roleName}</Badge>
          <span style={{ fontSize: "11px", color: "#6b7280" }}>{roleUsers.length} usuario(s)</span>
        </div>
        <div style={{ marginBottom: "6px" }}>
          {roleUsers.length === 0
            ? <span style={{ fontSize: "11px", color: "#9ca3af" }}>Sin usuarios</span>
            : roleUsers.map((u) => userChip(u, process.process_id, roleName))}
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          <select
            style={inputStyle}
            value={assignDraft[key] || ""}
            onChange={(e) => setDraft(process.process_id, roleName, e.target.value)}
          >
            <option value="">Asignar {roleName}…</option>
            {usersForRole(roleName).map((u) => (
              <option key={u.id} value={u.id}>{u.username}</option>
            ))}
          </select>
          <button
            onClick={() => assignToProcess(process.process_id, roleName)}
            style={{
              padding: "6px 10px",
              borderRadius: "6px",
              border: "1px solid #e5e7eb",
              background: "#f3f4f6",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            Asignar
          </button>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(140px, 1fr))", gap: "8px", marginBottom: "12px" }}>
        <select
          style={inputStyle}
          value={filters.scope_id}
          onChange={(e) => setFilters((f) => ({ ...f, scope_id: e.target.value }))}
        >
          <option value="">Todas las carpetas</option>
          {data.folders.map((n) => (
            <option key={n.id} value={n.id}>{n.full_path}</option>
          ))}
        </select>

        <select
          style={inputStyle}
          value={filters.process_id}
          onChange={(e) => setFilters((f) => ({ ...f, process_id: e.target.value }))}
        >
          <option value="">Todos los procesos</option>
          {data.processes.map((p) => (
            <option key={p.process_id} value={p.process_id}>{p.process_name}</option>
          ))}
        </select>

        <select
          style={inputStyle}
          value={filters.role}
          onChange={(e) => setFilters((f) => ({ ...f, role: e.target.value }))}
        >
          <option value="">Todos los roles</option>
          <option value="admin">admin</option>
          <option value="configurador">configurador</option>
          <option value="responsable">responsable</option>
        </select>

        <input
          style={inputStyle}
          placeholder="Filtrar por usuario"
          value={filters.user}
          onChange={(e) => setFilters((f) => ({ ...f, user: e.target.value }))}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "12px" }}>
        <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "10px 12px", maxHeight: "540px", overflowY: "auto" }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#374151", marginBottom: "8px" }}>
            Cobertura por carpeta
          </div>
          {(data.folder_aggregate || []).map((f) => (
            <div key={f.id} style={{ borderBottom: "1px solid #f3f4f6", padding: "8px 0" }}>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "#111827" }}>{f.full_path}</div>
              <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                {f.process_count} procesos · admins {f.user_counts?.admin ?? 0} · configuradores {f.user_counts?.configurador ?? 0} · responsables {f.user_counts?.responsable ?? 0}
              </div>
            </div>
          ))}
          {(data.folder_aggregate || []).length === 0 && <div style={{ fontSize: "12px", color: "#9ca3af" }}>Sin carpetas visibles para el alcance actual.</div>}
        </div>

        <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "10px 12px", maxHeight: "540px", overflowY: "auto" }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#374151", marginBottom: "8px" }}>
            Trazabilidad por proceso (gestionable)
          </div>

          {loading ? (
            <div style={{ fontSize: "12px", color: "#6b7280" }}>Cargando trazabilidad…</div>
          ) : data.processes.length === 0 ? (
            <div style={{ fontSize: "12px", color: "#9ca3af" }}>No hay procesos para estos filtros.</div>
          ) : (
            data.processes.map((p) => (
              <div key={p.process_id} style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "10px", marginBottom: "10px", background: "#fafafa" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#111827" }}>{p.process_name}</div>
                <div style={{ fontSize: "11px", color: "#6b7280", marginBottom: "8px" }}>
                  {(p.folder_path || []).join(" / ") || "Sin carpeta"}
                </div>

                {roleBlock(p, "admin")}
                {roleBlock(p, "configurador")}
                {roleBlock(p, "responsable")}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ResetTab({ onReset }) {
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const token = localStorage.getItem("authToken");
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(`${API}/upload/`, { headers });
        const data = await res.json();
        const projectIds = [...new Set(data.map((p) => p.project_id).filter(Boolean))];
        setProjects(projectIds);
      } catch (e) {
        console.error("Error loading projects:", e);
      }
    };
    fetchProjects();
  }, []);

  const handleResetProject = async () => {
    if (!selectedProjectId) {
      setMessage("Por favor selecciona un proyecto");
      return;
    }
    setResetConfirmation("project");
  };

  const handleResetAll = () => {
    setResetConfirmation("all");
  };

  const confirmReset = async () => {
    setLoading(true);
    setMessage("");
    try {
      const token = localStorage.getItem("authToken");
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      if (resetConfirmation === "project") {
        const res = await fetch(`${API}/admin/reset-project/${selectedProjectId}`, {
          method: "DELETE",
          headers,
        });
        const data = await res.json();
        if (res.ok) {
          setMessage(`✓ Proyecto "${selectedProjectId}" eliminado exitosamente`);
          setSelectedProjectId("");
          setResetConfirmation(null);
          if (onReset) onReset();
        } else {
          setMessage(`Error: ${data.message || "Ocurrió un error"}`);
        }
      } else if (resetConfirmation === "all") {
        const res = await fetch(`${API}/admin/reset-all`, {
          method: "DELETE",
          headers,
        });
        const data = await res.json();
        if (res.ok) {
          setMessage("✓ Toda la aplicación ha sido reiniciada exitosamente");
          setResetConfirmation(null);
          if (onReset) onReset();
        } else {
          setMessage(`Error: ${data.message || "Ocurrió un error"}`);
        }
      }
    } catch (e) {
      setMessage(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const cancelReset = () => {
    setResetConfirmation(null);
  };

  const buttonStyle = {
    padding: "8px 16px",
    borderRadius: "6px",
    border: "1px solid #e5e7eb",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 500,
  };

  const selectStyle = {
    padding: "8px 12px",
    borderRadius: "6px",
    border: "1px solid #e5e7eb",
    fontSize: "13px",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div>
      <div style={{ color: "#111827", marginBottom: "20px" }}>
        <h3 style={{ margin: "0 0 8px 0", fontSize: "14px", fontWeight: 700 }}>
          Reiniciar Proyecto
        </h3>
        <p style={{ margin: "0 0 12px 0", fontSize: "12px", color: "#6b7280" }}>
          Elimina todos los datos asociados a un proyecto específico.
        </p>
        <div style={{ display: "flex", gap: "8px" }}>
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            style={selectStyle}
          >
            <option value="">— Selecciona un proyecto —</option>
            {projects.map((pid) => (
              <option key={pid} value={pid}>
                {pid}
              </option>
            ))}
          </select>
          <button
            onClick={handleResetProject}
            disabled={loading || !selectedProjectId}
            style={{
              ...buttonStyle,
              background: "#fee2e2",
              color: "#991b1b",
              border: "1px solid #fecaca",
              opacity: loading || !selectedProjectId ? 0.6 : 1,
              cursor: loading || !selectedProjectId ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Eliminando..." : "Eliminar"}
          </button>
        </div>
      </div>

      <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "20px", marginTop: "20px" }}>
        <h3 style={{ margin: "0 0 8px 0", fontSize: "14px", fontWeight: 700, color: "#111827" }}>
          Reiniciar Aplicación Completa
        </h3>
        <p style={{ margin: "0 0 12px 0", fontSize: "12px", color: "#6b7280" }}>
          Elimina TODOS los datos de la aplicación (proyectos, archivos, ejecuciones, etc).
          Esta acción no se puede deshacer.
        </p>
        <button
          onClick={handleResetAll}
          disabled={loading}
          style={{
            ...buttonStyle,
            background: "#dc2626",
            color: "white",
            border: "1px solid #991b1b",
            opacity: loading ? 0.6 : 1,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Eliminando..." : "🔴 Eliminar TODO"}
        </button>
      </div>

      {/* Confirmation Modal */}
      {resetConfirmation && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: "8px",
              padding: "24px",
              maxWidth: "400px",
              boxShadow: "0 20px 25px rgba(0,0,0,0.15)",
            }}
          >
            <h3 style={{ margin: "0 0 12px 0", color: "#dc2626", fontSize: "16px", fontWeight: 700 }}>
              ⚠️ Confirmar eliminación
            </h3>
            <p style={{ margin: "0 0 20px 0", fontSize: "13px", color: "#374151", lineHeight: "1.5" }}>
              {resetConfirmation === "project"
                ? `¿Estás seguro de que deseas eliminar todos los datos del proyecto "${selectedProjectId}"? Esta acción no se puede deshacer.`
                : "¿Estás seguro de que deseas eliminar TODOS los datos de la aplicación? Esta acción no se puede deshacer y perderás todos los proyectos, archivos, ejecuciones y suscripciones."}
            </p>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                onClick={cancelReset}
                disabled={loading}
                style={{
                  ...buttonStyle,
                  background: "#f3f4f6",
                  color: "#374151",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={confirmReset}
                disabled={loading}
                style={{
                  ...buttonStyle,
                  background: "#dc2626",
                  color: "white",
                  border: "1px solid #991b1b",
                }}
              >
                {loading ? "Procesando..." : "Sí, eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {message && (
        <div
          style={{
            marginTop: "16px",
            padding: "12px 16px",
            borderRadius: "6px",
            fontSize: "13px",
            background: message.includes("✓") ? "#d1fae5" : "#fee2e2",
            color: message.includes("✓") ? "#065f46" : "#991b1b",
            border: `1px solid ${message.includes("✓") ? "#86efac" : "#fecaca"}`,
          }}
        >
          {message}
        </div>
      )}
    </div>
  );
}

export default function AdminPanel({ onBack }) {
  const [activeSection, setActiveSection] = useState("roles");
  const [activeTab, setActiveTab] = useState("monitor");
  const [summary, setSummary] = useState(null);

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetch(`${API}/admin/summary`);
      setSummary(await res.json());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const sections = [
    {
      id: "roles",
      label: "Monitoreo y Trazabilidad de Roles",
      tabs: [
        { id: "monitor", label: "Monitoreo cumplimiento" },
        { id: "traceability", label: "Trazabilidad roles" },
      ],
    },
    {
      id: "delivery",
      label: "Data Delivery",
      tabs: [
        { id: "subscriptions", label: "Suscripciones" },
        { id: "jobs", label: "Jobs de entrega" },
        { id: "debug", label: "🔍 Debug" },
      ],
    },
    {
      id: "maintenance",
      label: "Mantenimiento",
      tabs: [
        { id: "reset", label: "🔄 Reiniciar" },
      ],
    },
  ];

  const currentSection = sections.find((s) => s.id === activeSection) || sections[0];
  const visibleTabs = currentSection.tabs;

  const handleSectionChange = (sectionId) => {
    const target = sections.find((s) => s.id === sectionId);
    if (!target) return;
    setActiveSection(sectionId);
    if (!target.tabs.some((t) => t.id === activeTab)) {
      setActiveTab(target.tabs[0].id);
    }
  };

  return (
    <div style={{ padding: "8px 0" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
        <button
          onClick={onBack}
          style={{
            padding: "5px 12px", background: "#f3f4f6", color: "#374151",
            border: "1px solid #e5e7eb", borderRadius: "6px", cursor: "pointer", fontSize: "13px",
          }}
        >
          ← Volver
        </button>
        <div>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "#111827" }}>
            Panel de Administración
          </h2>
          <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>
            Monitoreo, trazabilidad de roles y data delivery
          </div>
        </div>
      </div>

      <SummaryCards summary={summary} />

      {/* Sections */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "10px", flexWrap: "wrap" }}>
        {sections.map((section) => (
          <button
            key={section.id}
            onClick={() => handleSectionChange(section.id)}
            style={{
              padding: "7px 14px",
              borderRadius: "999px",
              border: `1px solid ${activeSection === section.id ? "#3b82f6" : "#e5e7eb"}`,
              background: activeSection === section.id ? "#eff6ff" : "white",
              color: activeSection === section.id ? "#1d4ed8" : "#6b7280",
              fontWeight: activeSection === section.id ? 700 : 500,
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            {section.label}
          </button>
        ))}
      </div>

      {/* Subtabs */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "16px", borderBottom: "1px solid #e5e7eb", paddingBottom: "0" }}>
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "8px 18px",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === tab.id ? "2px solid #3b82f6" : "2px solid transparent",
              color: activeTab === tab.id ? "#3b82f6" : "#6b7280",
              fontWeight: activeTab === tab.id ? 700 : 400,
              cursor: "pointer",
              fontSize: "13px",
              marginBottom: "-1px",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "20px" }}>
        {activeTab === "subscriptions" && <SubscriptionsTab onRefreshSummary={loadSummary} />}
        {activeTab === "monitor" && <CommitmentMonitorTab />}
        {activeTab === "traceability" && <RoleTraceabilityTab />}
        {activeTab === "jobs" && <DeliveryJobsTab />}
        {activeTab === "debug" && <DebugTab />}
        {activeTab === "reset" && <ResetTab onReset={loadSummary} />}
      </div>
    </div>
  );
}
