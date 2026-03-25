export default function Executions({ executions, onSelect }) {
  const formatTimestamp = (timestamp) => {
    try {
      return new Date(timestamp).toLocaleString("es-ES", {
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
        {executions.map((exec, index) => (
          <div key={index} className="execution-item">
            {exec.status === "error_formato" || exec.status === "error" ? (
              <span className="execution-error-corner" title="Error de formato" aria-hidden="true" />
            ) : null}
            <span className="execution-icon">📜</span>
            <div className="execution-main">
              <div className="execution-file">
                {exec.file_name}
              </div>
              <div className="execution-meta">
                <span>{formatTimestamp(exec.timestamp)}</span>
                <span className="execution-divider">•</span>
                <span className="execution-columns" title={(exec.outputs || []).map((o) => `${o.sheet_name}: ${o.status}`).join(" | ")}>
                  {(exec.outputs || []).length > 0 ? `${exec.outputs.length} hojas` : `${exec.rule?.columns?.length || 0} columnas`}
                </span>
                <span className="execution-divider">•</span>
                <span className={`execution-columns ${exec.status === "warning" ? "execution-warning-text" : ""}`}>
                  {exec.status === "warning" ? "Con errores" : "Correcto"}
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
        ))}
      </div>
    </div>
  );
}