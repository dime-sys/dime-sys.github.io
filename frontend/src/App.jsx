import { useState, useEffect, useMemo } from "react";
import { uploadFileToProject, getProjects, getMe, logout } from "./services/api";
import "./App.css";
import AdminPanel from "./components/AdminPanel";
import ProjectSetupWizard from "./components/ProjectSetupWizard";
import ProjectTree from "./components/ProjectTree";
import FilesTable from "./components/FilesTable";
import ExcelViewer from "./components/ExcelViewer";
import Executions from "./components/Executions";
import ResultTable from "./components/ResultTable";
import LoginPage from "./components/LoginPage";
import UserManagementPanel from "./components/UserManagementPanel";
import DimeLogo from "./components/DimeLogo";
import ScheduleRangeEditor from "./components/ScheduleRangeEditor";

const DEFAULT_SCHEDULE_RANGE = { hora_inicio: "08:00", hora_fin: "10:00" };

const createEmptySchedule = () => ({
  activo: false,
  tipo: "diario",
  dias: [],
  hora_inicio: "08:00",
  hora_fin: "10:00",
  rangos: [{ ...DEFAULT_SCHEDULE_RANGE }],
});

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm || "00:00").split(":").map((v) => Number(v) || 0);
  return (h * 60) + m;
};

const formatHHMM = (hhmm) => {
  const [h, m] = String(hhmm || "00:00").split(":").map((v) => Number(v) || 0);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

const getScheduleRanges = (schedule) => {
  const src = Array.isArray(schedule?.rangos) && schedule.rangos.length
    ? schedule.rangos
    : [{ hora_inicio: schedule?.hora_inicio || "08:00", hora_fin: schedule?.hora_fin || "10:00" }];

  return src
    .map((r) => ({
      hora_inicio: formatHHMM(r?.hora_inicio || "00:00"),
      hora_fin: formatHHMM(r?.hora_fin || "00:00"),
    }))
    .filter((r) => toMinutes(r.hora_fin) > toMinutes(r.hora_inicio))
    .sort((a, b) => toMinutes(a.hora_inicio) - toMinutes(b.hora_inicio));
};

const normalizeSchedule = (schedule) => {
  const base = schedule || createEmptySchedule();
  const rangos = getScheduleRanges(base);
  const safeRanges = rangos.length ? rangos : [{ ...DEFAULT_SCHEDULE_RANGE }];
  return {
    ...base,
    rangos: safeRanges,
    hora_inicio: safeRanges[0].hora_inicio,
    hora_fin: safeRanges[safeRanges.length - 1].hora_fin,
  };
};

const scheduleToPayload = (schedule) => {
  const normalized = normalizeSchedule(schedule);
  return {
    ...normalized,
    rangos: normalized.rangos,
    hora_inicio: normalized.rangos[0].hora_inicio,
    hora_fin: normalized.rangos[normalized.rangos.length - 1].hora_fin,
  };
};

const formatScheduleRanges = (schedule) => {
  const ranges = getScheduleRanges(schedule);
  if (!ranges.length) return "—";
  return ranges.map((r) => `${r.hora_inicio} – ${r.hora_fin}`).join(" · ");
};

const normalizeName = (value) => String(value || "").trim().toLowerCase();

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [projects, setProjects] = useState([]);
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [setupComplete, setSetupComplete] = useState(false);

  const [view, setView] = useState("home");
  const [step, setStep] = useState(1);

  const [data, setData] = useState(null);
  const [currentFile, setCurrentFile] = useState(null);
  const [selectedSheet, setSelectedSheet] = useState(null);
  const [enabledSheets, setEnabledSheets] = useState([]);
  const [pendingRulesBySheet, setPendingRulesBySheet] = useState({});
  const [previewRows, setPreviewRows] = useState(50);

  const [executions, setExecutions] = useState([]);
  const [ruleHistory, setRuleHistory] = useState([]);
  const [commitmentHistory, setCommitmentHistory] = useState({ history: [], current: null, set_at: null });
  const [selectedExecution, setSelectedExecution] = useState(null);

  const [selectedFile, setSelectedFile] = useState(null);
  const [nombreProceso, setNombreProceso] = useState("");
  const [commitmentSchedule, setCommitmentSchedule] = useState({
    ...createEmptySchedule()
  });
  const [isUploading, setIsUploading] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [projectTreeRefreshKey, setProjectTreeRefreshKey] = useState(0);
  const [projectProcessNames, setProjectProcessNames] = useState([]);

  const [metadata, setMetadata] = useState({
    responsable: "",
    area: "",
    nombre_negocio: "",
    descripcion_carga: "",
    frecuencia: "",
    origen: "",
    tipo_dato: "",
    criticidad: ""
  });

  // Validate stored token on mount
  useEffect(() => {
    const token = localStorage.getItem("authToken");
    if (!token) {
      setAuthChecked(true);
      return;
    }
    getMe()
      .then((user) => {
        setCurrentUser(user);
        setAuthChecked(true);
      })
      .catch(() => {
        localStorage.removeItem("authToken");
        setAuthChecked(true);
      });
  }, []);

  const handleLogout = async () => {
    try { await logout(); } catch (_) {}
    localStorage.removeItem("authToken");
    setCurrentUser(null);
    setView("home");
  };

  // Cargar proyectos al montar componente
  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const data = await getProjects();
      setProjects(data.projects || []);
    } catch (error) {
      console.error('Error loading projects:', error);
    }
  };

  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId) {
      setProjectProcessNames([]);
      return;
    }

    const token = localStorage.getItem("authToken");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    fetch(`http://localhost:8000/upload/?project_id=${encodeURIComponent(projectId)}`, { headers })
      .then((r) => r.json())
      .then((list) => {
        const names = Array.isArray(list)
          ? list.map((p) => p.process_name || p.file_name).filter(Boolean)
          : [];
        setProjectProcessNames(names);
      })
      .catch(() => setProjectProcessNames([]));
  }, [selectedProject?.id, projectTreeRefreshKey]);

  const processNameConflict = useMemo(() => {
    const target = normalizeName(nombreProceso);
    if (!target || !selectedProject?.id) return false;
    return projectProcessNames.some((n) => normalizeName(n) === target);
  }, [nombreProceso, projectProcessNames, selectedProject?.id]);

  // Solo el admin ve el wizard cuando no hay proyectos y ya sabemos quién es
  useEffect(() => {
    if (!authChecked) return;
    if (currentUser?.role === 'admin' && projects.length === 0 && !setupComplete) {
      setShowSetupWizard(true);
    } else {
      setShowSetupWizard(false);
    }
  }, [authChecked, currentUser, projects, setupComplete]);

  const handleSetupComplete = (result) => {
    setShowSetupWizard(false);
    setSetupComplete(true);
    loadProjects();
  };

  const loadFileData = async (processOrId, sheetName = null, rowCount = previewRows) => {
    const processId = typeof processOrId === "string" ? processOrId : processOrId?.id;
    if (!processId) return;

    const params = new URLSearchParams();
    if (sheetName) params.set("sheet_name", sheetName);
    params.set("preview_rows", String(rowCount));
    const url = `http://localhost:8000/upload/${processId}?${params.toString()}`;
    const res = await fetch(url);
    const data = await res.json();

    setData(data);

    setCurrentFile({
      id: data.process_id || data.file_id,
      file_name: data.process_name || data.file_name,
      latest_input_name: data.latest_input_name,
    });
    setSelectedSheet(data.current_sheet_name || data.sheet_names?.[0] || null);
    setEnabledSheets(data.enabled_sheet_names || data.sheet_names || []);

    setView("rule");
  };

  const handleUpload = async () => {
    if (!selectedFile) return alert("Debes seleccionar un archivo");
    if (!selectedProject?.id) return alert("Debes seleccionar una carpeta o proyecto antes de subir el archivo");
    if (!nombreProceso.trim()) return alert("Debes ingresar un nombre del proceso");
    if (processNameConflict) return alert("Ya existe un proceso con ese nombre en la carpeta seleccionada");

    if (isUploading) return;

    setIsUploading(true);

    try {
      const res = await uploadFileToProject(
        selectedFile,
        metadata,
        selectedProject.id,
        nombreProceso.trim(),
        commitmentSchedule.activo ? scheduleToPayload(commitmentSchedule) : null
      );
      const backendData = res.data;

      // Obtener los datos completos del archivo (incluye preview)
      const fileDataRes = await fetch(`http://localhost:8000/upload/${backendData.file_id}`);
      const fileData = await fileDataRes.json();

      setData(fileData);

      setCurrentFile({
        id: backendData.process_id || backendData.file_id,
        file_name: backendData.file_name,
        latest_input_name: backendData.latest_input_name,
      });
      setSelectedSheet(fileData.current_sheet_name || fileData.sheet_names?.[0] || null);
      setEnabledSheets(fileData.enabled_sheet_names || fileData.sheet_names || []);
      setPendingRulesBySheet({});

      setStep(1);
      setSelectedFile(null);
      setNombreProceso("");
      setCommitmentSchedule(createEmptySchedule());
      setProjectTreeRefreshKey((current) => current + 1);
      setView("rule");

    } catch (error) {
      console.error(error);
      const backendMessage = error?.response?.data?.detail || error?.response?.data?.error || error.message;
      alert(`Error al subir archivo: ${backendMessage}`);
    } finally {
      setIsUploading(false);
    }
  };

  const saveRule = async (rule, options = {}) => {
    if (!currentFile?.id) {
      alert("No hay archivo seleccionado");
      return;
    }

    if (!selectedSheet) {
      alert("Selecciona una hoja para guardar la regla");
      return;
    }

    setPendingRulesBySheet((prev) => {
      const currentRule = prev[selectedSheet] || { tables: [] };
      const currentTables = Array.isArray(currentRule.tables) ? currentRule.tables : [];
      if (rule.extraction_mode === "raw_only") {
        return {
          ...prev,
          [selectedSheet]: {
            tables: [{ ...rule, table_name: rule.table_name || "raw_file" }],
          },
        };
      }
      const tableName = rule.table_name || `tabla_${currentTables.length + 1}`;
      const withoutSameName = currentTables.filter((t) => t.table_name !== tableName);
      return {
        ...prev,
        [selectedSheet]: {
          tables: [...withoutSameName, { ...rule, table_name: tableName }],
        },
      };
    });
    if (!options.silent) {
      if (rule.extraction_mode === "raw_only") {
        alert(`✅ Hoja ${selectedSheet} configurada como 'Mover archivo crudo'.`);
      } else {
        alert(`✅ Tabla '${rule.table_name || "tabla"}' agregada para hoja ${selectedSheet}.`);
      }
    }
  };

  const saveAllSheetRules = async () => {
    if (!currentFile?.id) {
      alert("No hay proceso seleccionado");
      return;
    }

    const targetSheetsFromState = Array.isArray(enabledSheets) ? enabledSheets : [];
    const targetSheetsFromData = Array.isArray(data?.enabled_sheet_names) ? data.enabled_sheet_names : [];
    const targetSheets = targetSheetsFromState.length
      ? targetSheetsFromState
      : targetSheetsFromData.length
        ? targetSheetsFromData
        : selectedSheet
          ? [selectedSheet]
          : (data?.sheet_names || []);
    const missingSheets = targetSheets.filter(
      (sheet) => !pendingRulesBySheet[sheet] || !(pendingRulesBySheet[sheet].tables || []).length
    );
    if (missingSheets.length > 0) {
      alert(`Faltan reglas en hojas habilitadas: ${missingSheets.join(", ")}`);
      return;
    }

    try {
      const token = localStorage.getItem("authToken");
      const res = await fetch("http://localhost:8000/rules/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          file_id: currentFile.id,
          rules_by_sheet: pendingRulesBySheet,
        }),
      });

      const data = await res.json();

      if (data.error) {
        alert("❌ Error: " + data.error);
        return;
      }

      if (data.status === "partial") {
        const errorMsg = (data.errors || [])
          .map((e) => `${e.sheet_name}: ${e.error}`)
          .join("\n");
        alert(`⚠ Se guardaron ${data.saved_count} reglas, con errores:\n${errorMsg}`);
      } else {
        alert(`✅ Reglas guardadas correctamente (${data.saved_count})`);
      }

      setPendingRulesBySheet({});
      await loadHistory(currentFile.id, selectedSheet);
    } catch (err) {
      console.error("Error:", err);
      alert("❌ Error al guardar reglas: " + err.message);
    }
  };

  const loadHistory = async (processOrId, sheetName = null) => {
    const processId = typeof processOrId === "string" ? processOrId : processOrId?.id;
    if (!processId) return;

    const [executionsRes, ruleHistoryRes, processRes] = await Promise.all([
      fetch(`http://localhost:8000/rules/executions/${processId}`),
      fetch(`http://localhost:8000/rules/rule-history/${processId}`),
      fetch(`http://localhost:8000/upload/${processId}`),
    ]);

    const [executionsData, ruleHistoryData, processData] = await Promise.all([
      executionsRes.json(),
      ruleHistoryRes.json(),
      processRes.json(),
    ]);

    setExecutions(Array.isArray(executionsData) ? executionsData : []);
    setRuleHistory(Array.isArray(ruleHistoryData) ? ruleHistoryData : []);
    setCommitmentHistory({
      history: processData.commitment_history || [],
      current: processData.commitment_schedule || null,
      set_at: processData.commitment_schedule_set_at || null,
    });
    setSelectedExecution(null);
    setCurrentFile({
      id: processData.process_id || processData.file_id || processId,
      file_name: processData.process_name || processData.file_name,
      latest_input_name: processData.latest_input_name,
    });
    setSelectedSheet(processData.current_sheet_name || processData.sheet_names?.[0] || null);
    setEnabledSheets(processData.enabled_sheet_names || processData.sheet_names || []);
    setView("history");
  };

  const updateEnabledSheets = async (sheetNames) => {
    if (!currentFile?.id) return;
    const res = await fetch(`http://localhost:8000/upload/${currentFile.id}/sheet-selection`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled_sheet_names: sheetNames }),
    });
    const responseData = await res.json();
    if (!res.ok) {
      throw new Error(responseData?.detail || "No se pudo actualizar la seleccion de hojas");
    }
    setEnabledSheets(responseData.enabled_sheet_names || sheetNames);
    if (responseData.current_sheet_name) {
      setSelectedSheet(responseData.current_sheet_name);
      await loadFileData(currentFile.id, responseData.current_sheet_name);
    }
  };

  const clearHistory = async () => {
    await fetch("http://localhost:8000/rules/executions", {
      method: "DELETE",
    });

    setExecutions([]);
    setSelectedExecution(null);
  };

  const formatDateTime = (value) => {
    if (!value) return "Sin fecha";
    return new Date(value).toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Auth gate
  if (!authChecked) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f9fafb" }}>
        <div style={{ fontSize: "14px", color: "#9ca3af" }}>Cargando...</div>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginPage onLogin={setCurrentUser} />;
  }

  // Mostrar wizard si es necesario
  if (showSetupWizard && !setupComplete) {
    return <ProjectSetupWizard onSetupComplete={handleSetupComplete} onCancel={() => {}} />;
  }

  const infoPill = {
    display: "inline-flex", alignItems: "center",
    padding: "3px 10px", background: "#f3f4f6", color: "#374151",
    borderRadius: "999px", fontSize: "12px", fontWeight: 500,
    border: "1px solid #e5e7eb",
  };

  const compactInput = {
    width: "100%", padding: "6px 10px",
    border: "1px solid #e5e7eb", borderRadius: "6px",
    fontSize: "12px", background: "white", color: "#111827",
    outline: "none", boxSizing: "border-box",
  };

  const ROLE_META = {
    admin: { label: "Admin", bg: "#dbeafe", color: "#1e40af" },
    configurador: { label: "Configurador", bg: "#dcfce7", color: "#166534" },
    responsable: { label: "Responsable", bg: "#fef9c3", color: "#854d0e" },
  };

  const roleMeta = ROLE_META[currentUser?.role] || { label: currentUser?.role, bg: "#f3f4f6", color: "#374151" };

  // Responsable can only upload to their assigned project nodes
  const canUploadToSelectedProject =
    !currentUser ||
    currentUser.role !== "responsable" ||
    (currentUser.assigned_project_ids || []).includes(selectedProject?.id);

  return (
    <div className="app-container">
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid #e5e7eb" }}>
        <span style={{ fontSize: "20px" }}>📊</span>
        <h1 style={{ flex: 1, margin: 0, fontSize: "inherit", textAlign: "left", color: "inherit", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <DimeLogo size="1.4rem" />
          <span style={{ fontWeight: 400, fontSize: "0.65rem", opacity: 0.6, fontFamily: "inherit" }}>Data Intake Management Ecosystem</span>
        </h1>

        {/* Role-based nav buttons */}
        {(currentUser?.role === "admin" || currentUser?.role === "configurador") && (
          <button
            onClick={() => setView(view === "users" ? "home" : "users")}
            style={{
              padding: "6px 14px",
              background: view === "users" ? "#7c3aed" : "#f3f4f6",
              color: view === "users" ? "white" : "#374151",
              border: "1px solid #e5e7eb",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
            }}
          >
            👥 Usuarios
          </button>
        )}
        {currentUser?.role === "admin" && (
          <>
            <button
              onClick={() => setView(view === "admin" ? "home" : "admin")}
              style={{
                padding: "6px 16px",
                background: view === "admin" ? "#3b82f6" : "#f3f4f6",
                color: view === "admin" ? "white" : "#374151",
                border: "1px solid #e5e7eb",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: 600,
              }}
            >
              ⚙ Admin
            </button>
          </>
        )}

        {/* Current user info */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 10px", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
          <span style={{ fontSize: "14px" }}>
            {currentUser?.role === "admin" ? "🛡" : currentUser?.role === "configurador" ? "⚙" : "📋"}
          </span>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "#374151" }}>{currentUser?.username}</span>
          <span style={{ display: "inline-block", background: roleMeta.bg, color: roleMeta.color, borderRadius: "999px", padding: "1px 7px", fontSize: "10px", fontWeight: 700 }}>
            {roleMeta.label}
          </span>
        </div>

        <button
          onClick={handleLogout}
          style={{
            padding: "6px 12px",
            background: "#f3f4f6",
            color: "#6b7280",
            border: "1px solid #e5e7eb",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          Salir
        </button>
      </div>

      <div className="app-layout">
        <div className="sidebar">
          <ProjectTree
            onSelectProject={(project) => {
              setSelectedProject(project);
              setView("home");
            }}
            selectedProjectId={selectedProject?.id}
            refreshKey={projectTreeRefreshKey}
            currentUser={currentUser}
          />
        </div>

        <div className="main-content">
          {view === "users" && (currentUser?.role === "admin" || currentUser?.role === "configurador") && (
            <UserManagementPanel currentUser={currentUser} onBack={() => setView("home")} />
          )}

          {view === "admin" && currentUser?.role === "admin" && (
            <AdminPanel onBack={() => setView("home")} />
          )}

          {view !== "admin" && view !== "users" && view === "home" && (
            <>
              {step === 1 && (
                <div style={{ padding: "0.75rem 0" }}>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
                    <span style={infoPill}>
                      🏷 {selectedProject ? (selectedProject.levelName || `Nivel ${selectedProject.level}`) : "—"}
                    </span>
                    <span style={{ ...infoPill, background: selectedProject ? "#dcfce7" : "#f3f4f6", color: selectedProject ? "#166534" : "#9ca3af" }}>
                      {selectedProject ? "✓ Permite archivos" : "Selecciona una carpeta"}
                    </span>
                  </div>

                  {currentUser?.role === "responsable" ? (
                    <div style={{ padding: "1.75rem", border: "1.5px dashed #d1d5db", borderRadius: "10px", backgroundColor: "#f9fafb", textAlign: "center", color: "#6b7280" }}>
                      <div style={{ fontSize: "1.75rem", marginBottom: "8px" }}>📋</div>
                      <p style={{ fontSize: "13px", fontWeight: 600, color: "#374151", margin: "0 0 4px" }}>Solo puedes cargar instancias a procesos existentes</p>
                      <p style={{ fontSize: "11px", color: "#9ca3af", margin: 0 }}>Usa el botón ⬆ en la lista de procesos de abajo para cargar un nuevo archivo</p>
                    </div>
                  ) : (
                    <label style={{ cursor: "pointer", display: "block" }}>
                      <input
                        type="file"
                        onChange={(e) => { const f = e.target.files[0]; setSelectedFile(f); if (f) setNombreProceso(f.name.replace(/\.[^.]+$/, "")); setStep(2); }}
                        style={{ display: "none" }}
                      />
                      <div
                        style={{ padding: "1.75rem", border: "1.5px dashed #d1d5db", borderRadius: "10px", backgroundColor: "#f9fafb", cursor: "pointer", textAlign: "center", transition: "border-color 0.2s, background 0.2s" }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = "#6b7280"; e.currentTarget.style.background = "#f3f4f6"; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = "#d1d5db"; e.currentTarget.style.background = "#f9fafb"; }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; setSelectedFile(f); if (f) setNombreProceso(f.name.replace(/\.[^.]+$/, "")); setStep(2); }}
                      >
                        <div style={{ fontSize: "1.75rem", marginBottom: "6px" }}>📁</div>
                        <p style={{ fontSize: "13px", fontWeight: 600, color: "#374151", margin: "0 0 3px" }}>Arrastra tu archivo aquí o haz clic</p>
                        <p style={{ fontSize: "11px", color: "#9ca3af", margin: 0 }}>Soporta archivos Excel (.xlsx, .xls)</p>
                      </div>
                    </label>
                  )}
                </div>
              )}

              {step === 2 && selectedFile && currentUser?.role !== "responsable" && (
                <>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "14px", paddingTop: "1.25rem" }}>
                    <span style={infoPill}>📊 {selectedFile.name}</span>
                    <span style={infoPill}>💾 {(selectedFile.size / 1024).toFixed(1)} KB</span>
                    <span style={{ ...infoPill, background: "#dcfce7", color: "#166534" }}>📂 {selectedProject?.name || "Sin carpeta"}</span>
                  </div>

                  <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "16px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>
                      Información del cargue
                    </div>
                    {/* Nombre del proceso — campo obligatorio prominente */}
                    <div style={{ marginBottom: "12px", padding: "12px", background: "#eff6ff", border: "1.5px solid #bfdbfe", borderRadius: "8px" }}>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#1d4ed8", marginBottom: "4px" }}>
                        Nombre del proceso <span style={{ color: "#dc2626" }}>*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="Ej: Nómina mensual RR.HH."
                        value={nombreProceso}
                        onChange={(e) => setNombreProceso(e.target.value)}
                        style={{ ...compactInput, borderColor: processNameConflict ? "#fca5a5" : (nombreProceso.trim() ? "#93c5fd" : "#fca5a5"), background: "white", fontWeight: 600 }}
                      />
                      {processNameConflict && (
                        <div style={{ fontSize: "10px", color: "#b91c1c", marginTop: "4px", fontWeight: 600 }}>
                          Ya existe un proceso con ese nombre en esta carpeta.
                        </div>
                      )}
                      <div style={{ fontSize: "10px", color: "#6b7280", marginTop: "4px" }}>
                        Este nombre identifica el proceso en historial, reportes y asignaciones. El nombre del archivo puede cambiar entre cargas.
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px" }}>
                      {[
                        { key: "responsable", label: "Responsable", placeholder: "Nombre del responsable" },
                        { key: "area", label: "Área", placeholder: "Área o departamento" },
                        { key: "nombre_negocio", label: "Nombre del negocio", placeholder: "Nombre del proyecto" },
                        { key: "frecuencia", label: "Frecuencia", placeholder: "Ej: Diaria, Semanal" },
                        { key: "origen", label: "Origen", placeholder: "Sistema o fuente" },
                        { key: "tipo_dato", label: "Tipo de dato", placeholder: "Tipo de información" },
                      ].map(({ key, label, placeholder }) => (
                        <div key={key}>
                          <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#6b7280", marginBottom: "4px" }}>{label}</label>
                          <input type="text" placeholder={placeholder} value={metadata[key]} onChange={(e) => setMetadata({ ...metadata, [key]: e.target.value })} style={compactInput} />
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: "10px" }}>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#6b7280", marginBottom: "4px" }}>Descripción de carga</label>
                      <textarea placeholder="Describe brevemente el contenido y propósito del archivo" value={metadata.descripcion_carga} onChange={(e) => setMetadata({ ...metadata, descripcion_carga: e.target.value })} style={{ ...compactInput, minHeight: "64px", resize: "vertical" }} />
                    </div>
                    <div style={{ marginTop: "10px" }}>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#6b7280", marginBottom: "4px" }}>Criticidad</label>
                      <select value={metadata.criticidad} onChange={(e) => setMetadata({ ...metadata, criticidad: e.target.value })} style={compactInput}>
                        <option value="">Selecciona nivel</option>
                        <option value="Baja">Baja</option>
                        <option value="Media">Media</option>
                        <option value="Alta">Alta</option>
                        <option value="Crítica">Crítica</option>
                      </select>
                    </div>

                    {/* Compromiso de carga */}
                    <div style={{ marginTop: "12px", border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: commitmentSchedule.activo ? "#faf5ff" : "#f9fafb", borderBottom: commitmentSchedule.activo ? "1px solid #e9d5ff" : "none", cursor: "pointer" }} onClick={() => setCommitmentSchedule(s => ({ ...s, activo: !s.activo }))}>
                        <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "11px", fontWeight: 700, color: commitmentSchedule.activo ? "#7c3aed" : "#374151" }} onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={commitmentSchedule.activo} onChange={(e) => setCommitmentSchedule(s => ({ ...s, activo: e.target.checked }))} />
                          🕐 Compromiso de carga
                        </label>
                        <span style={{ fontSize: "10px", color: "#9ca3af" }}>Define cuándo se espera esta carga</span>
                      </div>
                      {commitmentSchedule.activo && (
                        <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "10px", background: "#fdf4ff" }}>
                          <div>
                            <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#6b7280", marginBottom: "4px" }}>Recurrencia</label>
                            <select value={commitmentSchedule.tipo} onChange={(e) => setCommitmentSchedule(s => ({ ...s, tipo: e.target.value, dias: [] }))} style={compactInput}>
                              <option value="diario">Diario (todos los días)</option>
                              <option value="semanal">Días específicos de la semana</option>
                            </select>
                          </div>
                          {commitmentSchedule.tipo !== "diario" && (
                            <div>
                              <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#6b7280", marginBottom: "6px" }}>Días</label>
                              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                                {[["lunes","Lun"],["martes","Mar"],["miercoles","Mié"],["jueves","Jue"],["viernes","Vie"],["sabado","Sáb"],["domingo","Dom"]].map(([val, label]) => {
                                  const sel = commitmentSchedule.dias.includes(val);
                                  return (
                                    <label key={val} style={{ display: "flex", alignItems: "center", gap: "3px", padding: "4px 8px", borderRadius: "6px", border: `1px solid ${sel ? "#7c3aed" : "#d1d5db"}`, background: sel ? "#ede9fe" : "white", fontSize: "11px", fontWeight: 600, color: sel ? "#5b21b6" : "#374151", cursor: "pointer" }}>
                                      <input type="checkbox" style={{ display: "none" }} checked={sel} onChange={() => setCommitmentSchedule(s => ({ ...s, dias: sel ? s.dias.filter(d => d !== val) : [...s.dias, val] }))} />
                                      {label}
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          <div>
                            <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#6b7280", marginBottom: "6px" }}>Rangos habilitados (arrastrables)</label>
                            <ScheduleRangeEditor
                              ranges={getScheduleRanges(commitmentSchedule)}
                              onChange={(nextRanges) => setCommitmentSchedule((s) => normalizeSchedule({ ...s, rangos: nextRanges }))}
                              addButtonLabel="+ Agregar nuevo rango"
                            />
                          </div>
                          <div style={{ fontSize: "10px", color: "#7c3aed", background: "#ede9fe", borderRadius: "6px", padding: "6px 10px" }}>
                            Si no existe ninguna carga dentro de los rangos habilitados del día, el semáforo mostrará 🟣 <strong>Compromiso vencido</strong>.
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                    <button
                      onClick={handleUpload}
                      disabled={isUploading || !canUploadToSelectedProject || processNameConflict}
                      title={
                        !canUploadToSelectedProject
                          ? "No tienes permiso para cargar archivos en esta carpeta"
                          : (processNameConflict ? "Nombre de proceso duplicado en esta carpeta" : "")
                      }
                      style={{
                        padding: "8px 18px",
                        background: (!canUploadToSelectedProject || processNameConflict) ? "#d1d5db" : "#1d4ed8",
                        color: "white",
                        border: "none",
                        borderRadius: "7px",
                        fontSize: "13px",
                        fontWeight: 600,
                        cursor: isUploading || !canUploadToSelectedProject || processNameConflict ? "not-allowed" : "pointer",
                        opacity: isUploading ? 0.7 : 1,
                      }}
                    >
                      {isUploading ? "⏳ Subiendo..." : "🚀 Subir archivo"}
                    </button>
                    <button onClick={() => { setStep(1); setSelectedFile(null); setNombreProceso(""); setCommitmentSchedule(createEmptySchedule()); }} style={{ padding: "8px 14px", background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb", borderRadius: "7px", fontSize: "13px", fontWeight: 500, cursor: "pointer" }}>
                      Cancelar
                    </button>
                  </div>
                </>
              )}

              <FilesTable
                onSelectFile={(file) => loadFileData(file)}
                onViewHistory={(file) => loadHistory(file)}
                selectedProjectId={selectedProject?.id || null}
                selectedProjectName={selectedProject?.name || null}
                currentUser={currentUser}
              />
            </>
          )}

          {view === "rule" && data && currentUser?.role !== "responsable" && (
            <div className="workspace-shell">
              <div className="workspace-topbar">
                <div className="workspace-actions">
                  <button className="btn-secondary section-btn" onClick={() => setView("home")}>← Volver</button>
                  <button className="btn-primary section-btn" onClick={saveAllSheetRules}>💾 Guardar configuración de reglas</button>
                </div>
                <div className="workspace-pills">
                  <span className="context-pill">⚙️ {currentFile?.file_name}</span>
                  <span className="context-pill">Hoja: {selectedSheet || "-"}</span>
                  <span className="context-pill">Tablas hoja: {(pendingRulesBySheet[selectedSheet]?.tables || []).length}</span>
                  <span className="context-pill">Reglas en memoria: {Object.keys(pendingRulesBySheet).length}</span>
                  <span className="context-pill">Modo: rango, horizontal, vertical o crudo</span>
                </div>
              </div>

              <div className="workspace-card module-header-card">
                <div className="module-header-kicker">Reglas</div>
                <div className="module-header-title">Configuración de regla</div>
                <p className="module-header-subtitle">
                  Define extracción por rango o encabezados, configura columnas y guarda la regla.
                </p>
              </div>

              <div className="workspace-card rule-workspace">
                <div className="workspace-title">Editor de reglas</div>
                <ExcelViewer
                  data={data}
                  onSaveRule={saveRule}
                  selectedSheet={selectedSheet}
                  enabledSheets={enabledSheets}
                  pendingSheetRule={pendingRulesBySheet[selectedSheet] || { tables: [] }}
                  onSheetChange={(sheet) => {
                    setSelectedSheet(sheet);
                    loadFileData(currentFile?.id, sheet);
                  }}
                  onEnabledSheetsChange={updateEnabledSheets}
                  previewRows={previewRows}
                  onPreviewRowsChange={(n) => {
                    setPreviewRows(n);
                    loadFileData(currentFile?.id, selectedSheet, n);
                  }}
                />
              </div>
            </div>
          )}

          {view === "history" && (
            <div className="workspace-shell">
              <div className="workspace-topbar">
                <div className="workspace-actions">
                  <button className="btn-secondary section-btn" onClick={() => setView("home")}>← Volver</button>
                  <button className="btn-danger section-btn" onClick={clearHistory}>🗑 Borrar ejecuciones</button>
                </div>
                <div className="workspace-pills">
                  <span className="context-pill">Proceso · {currentFile?.file_name || "Sin proceso"}</span>
                  <span className="context-pill">Hoja · {selectedSheet || "Todas"}</span>
                  <span className="context-pill">Reglas {ruleHistory.length}</span>
                  <span className="context-pill">Ejecuciones {executions.length}</span>
                </div>
              </div>

              <div className="workspace-card module-header-card">
                <div className="module-header-kicker">Historial</div>
                <div className="module-header-title">Reglas y ejecuciones del proceso</div>
                <p className="module-header-subtitle">
                  Consulta las versiones de regla aplicadas y las instancias procesadas sobre este intake.
                </p>
              </div>

              <div className="history-grid">
                {/* Commitment schedule history card */}
                {(commitmentHistory.current || commitmentHistory.history.length > 0) && (
                  <div className="workspace-card history-list-card" style={{ gridColumn: "1 / -1" }}>
                    <div className="workspace-title">Historial de compromisos de carga</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
                      {/* Current schedule (latest) */}
                      {commitmentHistory.current && (() => {
                        const s = commitmentHistory.current;
                        const dias = s.tipo === "diario" ? "Todos los días" : (s.dias || []).map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(", ") || "—";
                        const desde = commitmentHistory.set_at
                          ? new Date(commitmentHistory.set_at).toLocaleString("es-ES", { timeZone: "America/Santiago", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
                          : "—";
                        return (
                          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", background: s.activo ? "#f5f3ff" : "#f9fafb", border: `1px solid ${s.activo ? "#8b5cf6" : "#e5e7eb"}`, borderRadius: "8px" }}>
                            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: s.activo ? "#8b5cf6" : "#d1d5db", flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: "12px", fontWeight: 700, color: s.activo ? "#6d28d9" : "#6b7280" }}>
                                {s.activo ? "✓ Activo" : "Desactivado"} · {formatScheduleRanges(s)} · {dias}
                              </div>
                              <div style={{ fontSize: "10px", color: "#9ca3af", marginTop: "2px" }}>Configurado el {desde} · Vigente actualmente</div>
                            </div>
                            <span style={{ fontSize: "10px", fontWeight: 600, background: "#ede9fe", color: "#6d28d9", borderRadius: "999px", padding: "2px 8px" }}>Actual</span>
                          </div>
                        );
                      })()}
                      {/* Past schedules sorted newest first */}
                      {[...commitmentHistory.history].reverse().map((h, i) => {
                        const s = h.schedule || {};
                        const dias = s.tipo === "diario" ? "Todos los días" : (s.dias || []).map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(", ") || "—";
                        const hasta = new Date(h.valid_until).toLocaleString("es-ES", { timeZone: "America/Santiago", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
                        const prevUntil = i < commitmentHistory.history.length - 1
                          ? new Date(commitmentHistory.history[commitmentHistory.history.length - 2 - i]?.valid_until).toLocaleString("es-ES", { timeZone: "America/Santiago", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
                          : (commitmentHistory.set_at
                              ? new Date(commitmentHistory.set_at).toLocaleString("es-ES", { timeZone: "America/Santiago", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
                              : "—");
                        return (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "8px", opacity: 0.85 }}>
                            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#d1d5db", flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: "12px", fontWeight: 600, color: "#4b5563" }}>
                                {s.activo ? `${formatScheduleRanges(s)} · ${dias}` : "Desactivado"}
                              </div>
                              <div style={{ fontSize: "10px", color: "#9ca3af", marginTop: "2px" }}>Vigente hasta {hasta}</div>
                            </div>
                            <span style={{ fontSize: "10px", color: "#9ca3af" }}>Anterior</span>
                          </div>
                        );
                      })}
                      {commitmentHistory.history.length === 0 && !commitmentHistory.current && (
                        <div style={{ fontSize: "12px", color: "#9ca3af", padding: "8px 0" }}>Sin compromisos configurados</div>
                      )}
                    </div>
                  </div>
                )}

                <div className="workspace-card history-list-card">
                  <div className="workspace-title">Historial de reglas</div>
                  {ruleHistory.length === 0 ? (
                    <div className="empty-state compact-empty-state">
                      <div className="empty-state-icon">🧩</div>
                      <h3>Sin reglas versionadas</h3>
                    </div>
                  ) : (
                    <div className="rule-history-list">
                      {ruleHistory
                        .slice()
                        .reverse()
                        .map((item) => {
                          const sheetEntries = item.rules_by_sheet
                            ? Object.entries(item.rules_by_sheet)
                            : [];
                          const allTableModes = sheetEntries.flatMap(([, cfg]) =>
                            Array.isArray(cfg?.tables)
                              ? cfg.tables.map((t) => t?.extraction_mode || "range")
                              : [cfg?.extraction_mode || "range"]
                          );
                          const allRawOnly = allTableModes.length > 0 && allTableModes.every((m) => m === "raw_only");
                          const mixedModes = new Set(allTableModes).size > 1;
                          const primaryMode = allRawOnly
                            ? "Mover archivo completo (crudo)"
                            : mixedModes
                              ? "Mixta"
                              : (allTableModes[0] === "headers_horizontal"
                                  ? "Encabezados horizontal"
                                  : allTableModes[0] === "headers_vertical"
                                    ? "Encabezados vertical"
                                    : allTableModes[0] === "range"
                                      ? "Rango"
                                      : (allTableModes[0] || "Rango"));

                          return (
                          <div key={item.id} className="rule-history-item">
                            <div className="rule-history-main">
                              <div className="rule-history-title-row">
                                <span className="rule-history-version">Versión {item.version}</span>
                                {item.is_active ? <span className="rule-history-badge">Activa</span> : null}
                              </div>
                              <div className="rule-history-meta">{formatDateTime(item.created_at)}</div>
                              <div style={{ marginTop: "6px", marginBottom: "6px" }}>
                                <span style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  borderRadius: "999px",
                                  padding: "2px 10px",
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  background: allRawOnly ? "#e0f2fe" : "#f3f4f6",
                                  color: allRawOnly ? "#075985" : "#374151",
                                  border: `1px solid ${allRawOnly ? "#bae6fd" : "#e5e7eb"}`,
                                }}>
                                  Tipo de regla: {primaryMode}
                                </span>
                              </div>
                              <div className="rule-history-summary">
                                {(item.rules_by_sheet
                                  ? `Hojas configuradas: ${Object.keys(item.rules_by_sheet).length}`
                                  : `Hoja ${item.sheet_name || "-"} · Filas ${item.rule?.start_row ?? 0} a ${item.rule?.end_row ?? 0} · Columnas ${(item.rule?.columns || []).length}`)}
                              </div>
                              <details className="rule-history-details">
                                <summary>{item.rules_by_sheet ? "Ver reglas por hoja" : "Ver regla configurada"}</summary>
                                {item.rules_by_sheet ? (
                                  <div className="rule-sheet-grid">
                                    {Object.entries(item.rules_by_sheet).map(([sheetName, ruleConfig]) => (
                                      <div key={`${item.id}-${sheetName}`} className="rule-sheet-card">
                                        <div className="rule-sheet-name">{sheetName}</div>
                                        {Array.isArray(ruleConfig?.tables) ? (
                                          <>
                                            <div className="rule-sheet-line">Tablas: {ruleConfig.tables.length}</div>
                                            {ruleConfig.tables.map((table, idx) => (
                                              <div key={`${sheetName}-table-${idx}`} className="rule-sheet-table-pill" title={(table?.columns || []).join(", ")}>
                                                {table?.table_name || `tabla_${idx + 1}`} · {(table?.extraction_mode || "range") === "raw_only" ? "Mover crudo" : (table?.extraction_mode || "range")} · cols {(table?.columns || []).length}
                                              </div>
                                            ))}
                                          </>
                                        ) : (
                                          <>
                                            <div className="rule-sheet-line">Modo: {ruleConfig?.extraction_mode || "range"}</div>
                                            {(ruleConfig?.extraction_mode || "range") === "range" && (
                                              <div className="rule-sheet-line">
                                                Filas {ruleConfig?.start_row ?? 0} a {ruleConfig?.end_row ?? 0}
                                              </div>
                                            )}
                                            <div className="rule-sheet-line">
                                              Columnas {(ruleConfig?.columns || []).length}
                                            </div>
                                            <div className="rule-sheet-line">
                                              Header: {ruleConfig?.header_option || "keep_existing"}
                                            </div>
                                            {(ruleConfig?.columns || []).length > 0 && (
                                              <div className="rule-sheet-columns" title={(ruleConfig?.columns || []).join(", ")}>
                                                {(ruleConfig?.columns || []).join(", ")}
                                              </div>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <pre className="rule-history-json">{JSON.stringify(item.rule || {}, null, 2)}</pre>
                                )}
                              </details>
                            </div>
                          </div>
                        )})}
                    </div>
                  )}
                </div>

                <div className="workspace-card history-list-card">
                  <div className="workspace-title">Ejecuciones</div>
                  {executions.length === 0 ? (
                    <div className="empty-state compact-empty-state">
                      <div className="empty-state-icon">📭</div>
                      <h3>Sin ejecuciones registradas</h3>
                    </div>
                  ) : (
                    <Executions executions={executions} onSelect={(exec) => setSelectedExecution(exec)} />
                  )}
                </div>
              </div>

              {selectedExecution && (
                <div className="workspace-card history-result-card" style={{ marginTop: "2px" }}>
                  <div className="workspace-title" style={{ marginBottom: "8px" }}>
                    Resultado de la ejecución · {selectedExecution.status === "warning" ? "Con errores" : "Correcto"}
                  </div>
                  {Array.isArray(selectedExecution.outputs) && selectedExecution.outputs.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      {selectedExecution.outputs.map((output, idx) => (
                        <div key={`${output.sheet_name || "sheet"}-${idx}`}>
                          <div style={{ fontSize: "11px", fontWeight: 700, color: "#374151", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                            Hoja {output.sheet_name || "-"} · {output.status === "error_formato" || output.status === "error" ? "Error de formato" : "Correcta"}
                          </div>
                          {Array.isArray(output.tables) && output.tables.length > 0 ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                              {output.tables.map((table, tableIdx) => (
                                <div key={`${output.sheet_name || "sheet"}-${table.table_name || tableIdx}`}>
                                  <div style={{ fontSize: "10px", fontWeight: 700, color: "#6b7280", marginBottom: "5px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                    Tabla {table.table_name || tableIdx + 1}
                                  </div>
                                  <ResultTable data={table.result || []} />
                                </div>
                              ))}
                            </div>
                          ) : (
                            <ResultTable data={output.result || []} />
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <ResultTable data={selectedExecution.result} />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .app-layout { display: flex; gap: 18px; align-items: flex-start; }
        .sidebar { width: 320px; flex-shrink: 0; max-height: calc(100vh - 90px); overflow-y: auto; position: sticky; top: 0; }
        .main-content { flex: 1; min-width: 0; }
        @media (max-width: 768px) {
          .app-layout { flex-direction: column; }
          .sidebar { width: 100%; max-height: 260px; position: static; }
        }
      `}</style>
    </div>
  );
}

export default App;