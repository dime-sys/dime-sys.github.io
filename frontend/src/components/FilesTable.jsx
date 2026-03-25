import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const metadataLabels = {
  responsable: "Responsable",
  area: "Área",
  nombre_negocio: "Nombre del negocio",
  descripcion_carga: "Descripción de carga",
  frecuencia: "Frecuencia",
  origen: "Origen",
  tipo_dato: "Tipo de dato",
  criticidad: "Criticidad",
};

const getMetadataLabel = (key) =>
  metadataLabels[key] ||
  key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const metadataFieldOrder = [
  "responsable",
  "area",
  "nombre_negocio",
  "descripcion_carga",
  "frecuencia",
  "origen",
  "tipo_dato",
  "criticidad",
];

const btnStyle = (bg, color) => ({
  width: "28px",
  height: "28px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: bg,
  border: "none",
  borderRadius: "6px",
  cursor: "pointer",
  fontSize: "13px",
  transition: "opacity 0.15s",
});

const STATUS_COLOR = {
  success: "#22c55e",
  warning: "#f59e0b",
  error: "#ef4444",
  error_formato: "#ef4444",
  sin_regla: "#d1d5db",
};

const STATUS_LABEL = {
  success: "Exitosa",
  warning: "Con errores",
  error: "Error",
  error_formato: "Error de formato",
  sin_regla: "Sin regla",
};

export default function FilesTable({ onSelectFile, onViewHistory, selectedProjectId = null, selectedProjectName = null }) {
  const [files, setFiles] = useState([]);
  const [selectedMetadata, setSelectedMetadata] = useState(null);
  const [editingFile, setEditingFile] = useState(null);
  const [editForm, setEditForm] = useState({ process_name: "" });
  const [uploadingProcessId, setUploadingProcessId] = useState(null);
  const [uploadFeedback, setUploadFeedback] = useState({});  // { processId: "success" | "error" }

  const buildUploadSummary = (executions = []) => {
    if (!executions.length) {
      return {
        status: "success",
        title: "Carga procesada",
        tooltip: "Estado: Exitosa",
      };
    }

    const errorStatuses = new Set(["error", "error_formato"]);
    const errorExecutions = executions.filter((e) => errorStatuses.has(e.status));
    const errorSheets = Array.from(
      new Set(errorExecutions.map((e) => e.sheet_name).filter(Boolean))
    );

    if (errorExecutions.length > 0) {
      return {
        status: "warning",
        title: "Con errores",
        tooltip: [
          "Estado: Con errores",
          `Hojas con error: ${errorSheets.length ? errorSheets.join(", ") : "No identificadas"}`,
        ].join("\n"),
      };
    }

    return {
      status: "success",
      title: "Exitosa",
      tooltip: "Estado: Exitosa",
    };
  };

  const buildUploadSummaryFromBatch = (execution) => {
    const outputs = execution?.outputs || [];
    if (!outputs.length) {
      return {
        status: execution?.status || "success",
        title: execution?.status === "warning" ? "Con errores" : "Exitosa",
        tooltip: execution?.status === "warning" ? "Estado: Con errores" : "Estado: Exitosa",
      };
    }

    const errorSheets = outputs
      .filter((output) => ["error", "error_formato"].includes(output?.status))
      .map((output) => output?.sheet_name)
      .filter(Boolean);

    if (errorSheets.length > 0) {
      return {
        status: "warning",
        title: "Con errores",
        tooltip: [
          "Estado: Con errores",
          `Hojas con error: ${errorSheets.join(", ")}`,
        ].join("\n"),
      };
    }

    return {
      status: "success",
      title: "Exitosa",
      tooltip: "Estado: Exitosa",
    };
  };

  const buildProcessIndicator = (file) => {
    const executions = file.last_executions || [];
    if (!executions.length) {
      return {
        status: "sin_regla",
        title: "Sin ejecucion",
        tooltip: "Estado: Sin ejecucion",
      };
    }
    const errorStatuses = new Set(["error", "error_formato", "warning"]);
    const errorSheets = [];
    executions.forEach((e) => {
      if (Array.isArray(e.error_sheets)) {
        e.error_sheets.forEach((sheet) => {
          if (sheet) errorSheets.push(sheet);
        });
      }
      if (errorStatuses.has(e.status) && e.sheet_name) {
        errorSheets.push(e.sheet_name);
      }
    });
    const normalizedErrorSheets = Array.from(new Set(errorSheets));

    if (normalizedErrorSheets.length) {
      return {
        status: "warning",
        title: "Con errores",
        tooltip: [
          "Estado: Con errores",
          `Hojas con error: ${normalizedErrorSheets.join(", ")}`,
        ].join("\n"),
      };
    }

    return {
      status: "success",
      title: "OK",
      tooltip: "Estado: Exitosa",
    };
  };

  const loadFiles = async () => {
    try {
      const url = selectedProjectId
        ? `http://localhost:8000/upload/?project_id=${encodeURIComponent(selectedProjectId)}`
        : "http://localhost:8000/upload/";

      const res = await fetch(url);
      const data = await res.json();

      if (Array.isArray(data)) {
        setFiles(data);
      } else {
        console.error("Respuesta inválida:", data);
        setFiles([]);
      }
    } catch (err) {
      console.error(err);
      setFiles([]);
    }
  };

  const deleteFile = async (fileId, fileName) => {
    if (!window.confirm(`¿Estás seguro de que deseas eliminar el proceso "${fileName}"?`)) {
      return;
    }

    try {
      const res = await fetch(`http://localhost:8000/upload/${fileId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        alert("✅ Proceso eliminado correctamente");
        await loadFiles(); // Recarga la lista
      } else {
        const error = await res.json();
        alert("❌ Error al eliminar: " + (error.detail || "Error desconocido"));
      }
    } catch (err) {
      console.error(err);
      alert("❌ Error al eliminar el archivo: " + err.message);
    }
  };

  const handleUploadInstance = async (processId, file) => {
    setUploadingProcessId(processId);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`http://localhost:8000/upload/${processId}/instance`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        alert("\u274C Error al cargar instancia: " + (data.detail || "Error desconocido"));
        setUploadFeedback((prev) => ({
          ...prev,
          [processId]: { status: "warning", title: "Con errores", tooltip: "Estado: Con errores" },
        }));
      } else {
        const summary = data.execution
          ? buildUploadSummaryFromBatch(data.execution)
          : buildUploadSummary(data.executions || []);
        setUploadFeedback((prev) => ({ ...prev, [processId]: summary }));
        await loadFiles();
      }
    } catch (err) {
      console.error(err);
      alert("\u274C Error: " + err.message);
      setUploadFeedback((prev) => ({
        ...prev,
        [processId]: {
          status: "warning",
          title: "Con errores",
          tooltip: "Estado: Con errores",
        },
      }));
    } finally {
      setUploadingProcessId(null);
      setTimeout(() => setUploadFeedback((prev) => { const n = { ...prev }; delete n[processId]; return n; }), 3000);
    }
  };

  useEffect(() => {
    loadFiles();
  }, [selectedProjectId]);

  const selectedMetadataValues = selectedMetadata?.metadata || {};

  const orderedMetadataEntries = metadataFieldOrder
    .filter((key) => Object.prototype.hasOwnProperty.call(selectedMetadataValues, key))
    .map((key) => [key, selectedMetadataValues?.[key]]);

  const extraMetadataEntries = Object.entries(selectedMetadataValues).filter(
    ([key]) => !metadataFieldOrder.includes(key)
  );

  const visibleModalMetadataEntries = [...orderedMetadataEntries, ...extraMetadataEntries].filter(
    ([, value]) => value !== null && value !== undefined && String(value).trim() !== ""
  );

  const editableMetadataKeys = Array.from(
    new Set([...metadataFieldOrder, ...Object.keys(editForm || {})])
  ).filter(
    (key) => key !== "process_name" && Object.prototype.hasOwnProperty.call(editForm || {}, key)
  );

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
        <span style={{ fontSize: "13px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Procesos{selectedProjectName ? ` · ${selectedProjectName}` : ""}
        </span>
        <span style={{ fontSize: "12px", background: "#e5e7eb", color: "#6b7280", borderRadius: "999px", padding: "1px 8px" }}>
          {files.length}
        </span>
      </div>

      {files.length === 0 ? (
        <div style={{ padding: "20px 16px", background: "#f9fafb", border: "1px dashed #d1d5db", borderRadius: "8px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>
          {selectedProjectName ? `Sin procesos en ${selectedProjectName}` : "Selecciona una carpeta"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {files.map((file) => (
            <div key={file.id} style={{ display: "flex", alignItems: "flex-start", gap: "10px", background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "8px 12px", transition: "background 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.background = "#eaecf0"}
              onMouseLeave={e => e.currentTarget.style.background = "#f3f4f6"}
            >
              <span style={{ fontSize: "16px", flexShrink: 0, marginTop: "2px" }}>📊</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {file.process_name || file.file_name}
                </div>
                <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "1px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <span>{new Date(file.timestamp).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  <span>·</span>
                  <span>Reglas {file.rule_versions_count || 0}</span>
                  <span>·</span>
                  <span>Ejecuciones {file.executions_count || 0}</span>
                  <span>·</span>
                  {(() => {
                    const runtimeFeedback = uploadFeedback[file.id];
                    const indicator = runtimeFeedback || buildProcessIndicator(file);
                    const indicatorColor = STATUS_COLOR[indicator.status] || "#d1d5db";
                    return (
                      <span
                        title={indicator.tooltip}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          color: "#6b7280",
                        }}
                      >
                        <span
                          style={{
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            background: indicatorColor,
                            boxShadow: `0 0 0 1px ${indicatorColor}`,
                          }}
                        />
                        <span>{indicator.title}</span>
                      </span>
                    );
                  })()}
                </div>

                {/* Execution status dots — last 10 */}
                {(file.last_executions || []).length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: "5px", marginTop: "6px", flexWrap: "wrap" }}>
                    {(file.last_executions).map((exec, i) => {
                      const isLast = i === file.last_executions.length - 1;
                      const color = STATUS_COLOR[exec.status] || "#d1d5db";
                      const label = STATUS_LABEL[exec.status] || exec.status;
                      const uploadedBy = exec.uploaded_by || "user_x";
                      const ts = exec.timestamp
                        ? new Date(exec.timestamp).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
                        : "";
                      const tooltipText = [
                        `usuario: ${uploadedBy}`,
                        `fecha_carga: ${ts || "sin fecha"}`,
                        `status: ${label}`,
                      ].join("\n");
                      return (
                        <span
                          key={exec.id || i}
                          title={tooltipText}
                          style={{
                            display: "inline-block",
                            width: isLast ? "11px" : "9px",
                            height: isLast ? "11px" : "9px",
                            borderRadius: "50%",
                            background: color,
                            flexShrink: 0,
                            boxShadow: isLast ? `0 0 0 2px #fff, 0 0 0 3px ${color}` : "none",
                            transition: "transform 0.15s",
                          }}
                        />
                      );
                    })}
                    {uploadFeedback[file.id] && (
                      <span style={{
                        fontSize: "10px",
                        fontWeight: 600,
                        color: uploadFeedback[file.id]?.status === "success" ? "#166534"
                          : uploadFeedback[file.id]?.status === "warning" ? "#92400e"
                          : "#374151",
                        background: uploadFeedback[file.id]?.status === "success" ? "#dcfce7"
                          : uploadFeedback[file.id]?.status === "warning" ? "#ffedd5"
                          : "#f3f4f6",
                        borderRadius: "999px",
                        padding: "1px 7px",
                      }}>
                        {uploadFeedback[file.id]?.status === "success" ? "✓ Cargado"
                          : uploadFeedback[file.id]?.status === "warning" ? "⚠ Revisar"
                          : "Sin regla"}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Hidden file input for instance upload */}
              <input
                type="file"
                id={`inst-${file.id}`}
                style={{ display: "none" }}
                accept=".xlsx,.xls,.csv"
                onChange={(e) => {
                  const f = e.target.files[0];
                  if (f) {
                    handleUploadInstance(file.id, f);
                    e.target.value = "";
                  }
                }}
              />

              <div style={{ display: "flex", gap: "4px", flexShrink: 0, marginTop: "2px" }}>
                <button
                  onClick={() => document.getElementById(`inst-${file.id}`).click()}
                  disabled={uploadingProcessId === file.id}
                  title="Cargar nueva instancia"
                  style={{
                    ...btnStyle("#dcfce7", "#15803d"),
                    width: "28px", height: "28px",
                    opacity: uploadingProcessId === file.id ? 0.6 : 1,
                    fontSize: "14px",
                  }}
                >
                  {uploadingProcessId === file.id ? "⏳" : "⬆"}
                </button>
                <button
                  onClick={() => onSelectFile(file)}
                  title="Regla"
                  style={btnStyle("#dbeafe", "#1d4ed8")}
                >📋</button>
                <button
                  onClick={() => onViewHistory(file)}
                  title="Historial"
                  style={btnStyle("#f3e8ff", "#7e22ce")}
                >📜</button>
                <button
                  onClick={() => setSelectedMetadata(file)}
                  title="Metadata"
                  style={btnStyle("#e0f2fe", "#0369a1")}
                >ℹ️</button>
                <button
                  onClick={() => {
                    setEditingFile(file);
                    setEditForm({
                      process_name: file.process_name || file.file_name || "",
                      ...(file.metadata || {}),
                    });
                  }}
                  title="Editar"
                  style={btnStyle("#fef9c3", "#92400e")}
                >✏️</button>
                <button
                  onClick={() => deleteFile(file.id, file.process_name || file.file_name)}
                  title="Eliminar"
                  style={btnStyle("#fee2e2", "#991b1b")}
                >🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal para ver metadata */}
      {selectedMetadata && (
        <MetadataModal
          onClose={() => setSelectedMetadata(null)}
          title={`Metadatos del proceso${selectedMetadata?.process_name ? ` · ${selectedMetadata.process_name}` : ""}`}
        >
          <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "14px" }}>
            {visibleModalMetadataEntries.length === 0 ? (
              <div className="metadata-empty">
                <div className="metadata-empty-icon">🗂️</div>
                <div className="metadata-empty-title">Sin metadata registrada</div>
                <div className="metadata-empty-text">Este archivo aún no tiene campos informativos completados.</div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "10px" }}>
                {visibleModalMetadataEntries.map(([key, value]) => (
                  <div
                    key={key}
                    style={{ minWidth: 0, gridColumn: key === "descripcion_carga" ? "1 / -1" : "auto" }}
                  >
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#6b7280", marginBottom: "4px" }}>
                      {getMetadataLabel(key)}
                    </label>
                    <div
                      style={{
                        minHeight: "34px",
                        padding: "8px 10px",
                        border: "1px solid #e5e7eb",
                        borderRadius: "8px",
                        background: "#ffffff",
                        color: "#111827",
                        fontSize: "12px",
                        lineHeight: 1.4,
                        wordBreak: "break-word",
                      }}
                    >
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </MetadataModal>
      )}

      {/* Modal para editar metadata */}
      {editingFile && (
        <MetadataModal
          onClose={() => setEditingFile(null)}
          title="Editar proceso"
        >
          <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "14px" }}>
            <div style={{ marginBottom: "10px" }}>
              <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#6b7280", marginBottom: "4px" }}>
                Nombre del proceso
              </label>
              <input
                type="text"
                value={editForm.process_name || ""}
                onChange={(e) => setEditForm({ ...editForm, process_name: e.target.value })}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                  fontSize: "12px",
                  background: "#ffffff",
                  color: "#111827",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "10px" }}>
              {editableMetadataKeys.map((key) => (
                <div
                  key={key}
                  style={{ minWidth: 0, gridColumn: key === "descripcion_carga" ? "1 / -1" : "auto" }}
                >
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#6b7280", marginBottom: "4px" }}>
                    {getMetadataLabel(key)}
                  </label>
                  <input
                    type="text"
                    value={editForm[key] || ""}
                    onChange={(e) =>
                      setEditForm({ ...editForm, [key]: e.target.value })
                    }
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                      fontSize: "12px",
                      background: "#ffffff",
                      color: "#111827",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "14px", paddingTop: "12px", borderTop: "1px solid #e5e7eb" }}>
              <button
                className="btn-secondary"
                onClick={() => setEditingFile(null)}
              >
                Cancelar
              </button>
              <button
                className="btn-primary"
                onClick={async () => {
                  try {
                    await fetch(`http://localhost:8000/upload/${editingFile.id}`, {
                      method: "PUT",
                      headers: {
                        "Content-Type": "application/json"
                      },
                      body: JSON.stringify({
                        process_name: editForm.process_name,
                        metadata: Object.fromEntries(
                          Object.entries(editForm).filter(([key]) => key !== "process_name")
                        )
                      })
                    });

                    setEditingFile(null);
                    loadFiles();
                  } catch (err) {
                    console.error(err);
                    alert("Error al guardar metadata");
                  }
                }}
              >
                Guardar
              </button>
            </div>
          </div>
        </MetadataModal>
      )}
    </div>
  );
}

function MetadataModal({ children, onClose, title = "Información", subtitle = "", icon = "" }) {
  if (typeof document === "undefined") {
    return null;
  }

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return createPortal(
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        zIndex: 9999,
        backdropFilter: "blur(3px)",
      }}
    >
      <div
        className="modal-content metadata-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(640px, 100%)",
          maxHeight: "88vh",
          overflowY: "auto",
          background: "#ffffff",
          border: "1px solid #e5e7eb",
          borderRadius: "14px",
          boxShadow: "0 24px 60px rgba(15, 23, 42, 0.22)",
          padding: "18px",
        }}
      >
        <div className="metadata-modal-header">
          <div className="metadata-modal-title-wrap">
            {icon ? <span className="metadata-modal-icon" aria-hidden="true">{icon}</span> : null}
            <div>
              <h3 className="metadata-modal-title">{title}</h3>
              {subtitle ? <p className="metadata-modal-subtitle">{subtitle}</p> : null}
            </div>
          </div>
          <button 
            className="btn-secondary metadata-modal-close" 
            onClick={onClose}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
        <div className="metadata-modal-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}