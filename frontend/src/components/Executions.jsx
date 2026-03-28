const STATUS_COLOR = {
  success: "#22c55e",
  warning: "#f59e0b",
  error: "#ef4444",
  error_formato: "#ef4444",
  sin_regla: "#d1d5db",
  raw_only: "#0ea5e9",
  compromiso_vencido: "#8b5cf6",
};

const STATUS_LABEL = {
  success: "Exitosa",
  warning: "Con errores",
  error: "Error",
  error_formato: "Error de formato",
  sin_regla: "Sin regla",
  raw_only: "Solo mover crudo",
  compromiso_vencido: "Compromiso vencido",
};

export default function Executions({ executions, onSelect }) {
  const formatTimestamp = (timestamp) => {
    try {
      return new Date(timestamp).toLocaleString("es-ES", {
        timeZone: "America/Santiago",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return timestamp;
    }
  };

  return (
    <div className="executions-panel">
      <div className="executions-header">
        <span className="executions-title">Historial de ejecuciones</span>
        <span className="executions-count">{executions.length}</span>
      </div>
      <div className="executions-list">
        {executions.map((exec, index) => {
          const color = STATUS_COLOR[exec.status] || "#d1d5db";
          const label = STATUS_LABEL[exec.status] || exec.status;
          const uploadedBy = exec.uploaded_by || "—";
          const ts = exec.timestamp
            ? new Date(exec.timestamp).toLocaleString("es-ES", { timeZone: "America/Santiago", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
            : "";
          const dotTooltip = [
            `usuario: ${uploadedBy}`,
            `fecha_carga: ${ts || "sin fecha"}`,
            `estado: ${label}`,
          ].join("\n");

          return (
            <div key={index} className="execution-item">
              <span
                title={dotTooltip}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "default",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    background: color,
                    boxShadow: `0 0 0 2px #fff, 0 0 0 3px ${color}`,
                  }}
                />
              </span>
              <div className="execution-main">
                <div className="execution-file">
                  {exec.file_name || exec.latest_input_name}
                </div>
                <div className="execution-meta">
                  <span>{formatTimestamp(exec.timestamp)}</span>
                  <span className="execution-divider">•</span>
                  <span
                    className="execution-columns"
                    title={(exec.outputs || []).map((o) => `${o.sheet_name}: ${o.status}`).join(" | ")}
                  >
                    {(exec.outputs || []).length > 0 ? `${exec.outputs.length} hoja${exec.outputs.length !== 1 ? "s" : ""}` : `${exec.rule?.columns?.length || 0} columnas`}
                  </span>
                </div>
              </div>
              <button
                className="execution-open-btn"
                onClick={() => onSelect(exec)}
                title="Ver resultado"
              >
                Ver
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}