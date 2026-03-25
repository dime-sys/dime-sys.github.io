import { useState, useEffect } from "react";
import { uploadFileToProject, getProjects } from "./services/api";
import "./App.css";
import ProjectSetupWizard from "./components/ProjectSetupWizard";
import ProjectTree from "./components/ProjectTree";
import FilesTable from "./components/FilesTable";
import ExcelViewer from "./components/ExcelViewer";
import Executions from "./components/Executions";
import ResultTable from "./components/ResultTable";

function App() {
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

  const [executions, setExecutions] = useState([]);
  const [ruleHistory, setRuleHistory] = useState([]);
  const [selectedExecution, setSelectedExecution] = useState(null);

  const [selectedFile, setSelectedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [projectTreeRefreshKey, setProjectTreeRefreshKey] = useState(0);

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

  // Cargar proyectos al montar componente
  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const data = await getProjects();
      setProjects(data.projects || []);
      
      // Si no hay proyectos, mostrar wizard
      if (!data.projects || data.projects.length === 0) {
        setShowSetupWizard(true);
      }
    } catch (error) {
      console.error('Error loading projects:', error);
      setShowSetupWizard(true);
    }
  };

  const handleSetupComplete = (result) => {
    setShowSetupWizard(false);
    setSetupComplete(true);
    loadProjects();
  };

  const loadFileData = async (processOrId, sheetName = null) => {
    const processId = typeof processOrId === "string" ? processOrId : processOrId?.id;
    if (!processId) return;

    const url = sheetName
      ? `http://localhost:8000/upload/${processId}?sheet_name=${encodeURIComponent(sheetName)}`
      : `http://localhost:8000/upload/${processId}`;
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

    if (isUploading) return;

    setIsUploading(true);

    try {
      const res = await uploadFileToProject(selectedFile, metadata, selectedProject.id);
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

  const saveRule = async (rule) => {
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
      const tableName = rule.table_name || `tabla_${currentTables.length + 1}`;
      const withoutSameName = currentTables.filter((t) => t.table_name !== tableName);
      return {
        ...prev,
        [selectedSheet]: {
          tables: [...withoutSameName, { ...rule, table_name: tableName }],
        },
      };
    });
    alert(`✅ Tabla '${rule.table_name || "tabla"}' agregada para hoja ${selectedSheet}.`);
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
      const res = await fetch("http://localhost:8000/rules/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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

  return (
    <div className="app-container">
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid #e5e7eb" }}>
        <span style={{ fontSize: "20px" }}>📊</span>
        <h1>Data Intake Management System</h1>
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
          />
        </div>

        <div className="main-content">
          {view === "home" && (
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

                  <label style={{ cursor: "pointer", display: "block" }}>
                    <input
                      type="file"
                      onChange={(e) => { setSelectedFile(e.target.files[0]); setStep(2); }}
                      style={{ display: "none" }}
                    />
                    <div
                      style={{ padding: "1.75rem", border: "1.5px dashed #d1d5db", borderRadius: "10px", backgroundColor: "#f9fafb", cursor: "pointer", textAlign: "center", transition: "border-color 0.2s, background 0.2s" }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = "#6b7280"; e.currentTarget.style.background = "#f3f4f6"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = "#d1d5db"; e.currentTarget.style.background = "#f9fafb"; }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); setSelectedFile(e.dataTransfer.files[0]); setStep(2); }}
                    >
                      <div style={{ fontSize: "1.75rem", marginBottom: "6px" }}>📁</div>
                      <p style={{ fontSize: "13px", fontWeight: 600, color: "#374151", margin: "0 0 3px" }}>Arrastra tu archivo aquí o haz clic</p>
                      <p style={{ fontSize: "11px", color: "#9ca3af", margin: 0 }}>Soporta archivos Excel (.xlsx, .xls)</p>
                    </div>
                  </label>
                </div>
              )}

              {step === 2 && selectedFile && (
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
                  </div>

                  <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                    <button onClick={handleUpload} disabled={isUploading} style={{ padding: "8px 18px", background: "#1d4ed8", color: "white", border: "none", borderRadius: "7px", fontSize: "13px", fontWeight: 600, cursor: isUploading ? "not-allowed" : "pointer", opacity: isUploading ? 0.7 : 1 }}>
                      {isUploading ? "⏳ Subiendo..." : "🚀 Subir archivo"}
                    </button>
                    <button onClick={() => { setStep(1); setSelectedFile(null); }} style={{ padding: "8px 14px", background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb", borderRadius: "7px", fontSize: "13px", fontWeight: 500, cursor: "pointer" }}>
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
              />
            </>
          )}

          {view === "rule" && data && (
            <div className="workspace-shell">
              <div className="workspace-topbar">
                <div className="workspace-actions">
                  <button className="btn-secondary section-btn" onClick={() => setView("home")}>← Volver</button>
                  <button className="btn-primary section-btn" onClick={saveAllSheetRules}>💾 Guardar reglas de hojas</button>
                </div>
                <div className="workspace-pills">
                  <span className="context-pill">⚙️ {currentFile?.file_name}</span>
                  <span className="context-pill">Hoja: {selectedSheet || "-"}</span>
                  <span className="context-pill">Tablas hoja: {(pendingRulesBySheet[selectedSheet]?.tables || []).length}</span>
                  <span className="context-pill">Reglas en memoria: {Object.keys(pendingRulesBySheet).length}</span>
                  <span className="context-pill">Modo: rango, horizontal o vertical</span>
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
                        .map((item) => (
                          <div key={item.id} className="rule-history-item">
                            <div className="rule-history-main">
                              <div className="rule-history-title-row">
                                <span className="rule-history-version">Versión {item.version}</span>
                                {item.is_active ? <span className="rule-history-badge">Activa</span> : null}
                              </div>
                              <div className="rule-history-meta">{formatDateTime(item.created_at)}</div>
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
                                                {table?.table_name || `tabla_${idx + 1}`} · {table?.extraction_mode || "range"} · cols {(table?.columns || []).length}
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
                        ))}
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