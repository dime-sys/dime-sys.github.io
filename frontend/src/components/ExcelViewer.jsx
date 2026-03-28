import { useRef, useState, useMemo, useEffect } from "react";
import { AgGridReact } from "ag-grid-react";
import { ModuleRegistry, AllCommunityModule } from "ag-grid-community";

import "ag-grid-community/styles/ag-theme-quartz.css";

ModuleRegistry.registerModules([AllCommunityModule]);

export default function ExcelViewer({ data, onSaveRule, selectedSheet, onSheetChange, enabledSheets = [], onEnabledSheetsChange, pendingSheetRule = { tables: [] }, previewRows = 50, onPreviewRowsChange }) {
  const gridRef = useRef();

  const [startCell, setStartCell] = useState(null);
  const [endCell, setEndCell] = useState(null);
  const [extractionMode, setExtractionMode] = useState("range");
  const [isRawOnlyMode, setIsRawOnlyMode] = useState(false);
  const [showHeaderModal, setShowHeaderModal] = useState(false);
  const [headerOption, setHeaderOption] = useState("keep_existing");
  const [customHeaders, setCustomHeaders] = useState([]);
  const [pendingEnabledSheets, setPendingEnabledSheets] = useState(enabledSheets || []);
  const [tableName, setTableName] = useState("");
  const [nullStrategy, setNullStrategy] = useState("none");
  const [autoCastTypes, setAutoCastTypes] = useState(true);
  const [shapeMode, setShapeMode] = useState("none");
  const [unpivotIdColumns, setUnpivotIdColumns] = useState("");
  const [unpivotValueColumns, setUnpivotValueColumns] = useState("");
  const [pivotIndexColumns, setPivotIndexColumns] = useState("");
  const [pivotColumn, setPivotColumn] = useState("");
  const [pivotValueColumn, setPivotValueColumn] = useState("");

  useEffect(() => {
    setPendingEnabledSheets(enabledSheets || []);
  }, [enabledSheets]);

  useEffect(() => {
    if (extractionMode === "headers_vertical" && headerOption === "first_row") {
      setHeaderOption("keep_existing");
      setCustomHeaders([]);
    }
  }, [extractionMode, headerOption]);

  if (!data) {
    return <div>Cargando archivo...</div>;
  }

  const columns = data.columns || [];
  const rows = data.preview || [];

  const normalizedColumns = useMemo(
    () => columns.filter((col) => col !== "_row").map((col) => String(col)),
    [columns]
  );

  const normalizedRows = useMemo(
    () =>
      rows.map((row) => {
        const newRow = {};
        Object.keys(row).forEach((key) => {
          newRow[String(key)] = row[key];
        });
        return newRow;
      }),
    [rows]
  );

  const columnDefs = useMemo(
    () => {
      const rowNumCol = {
        headerName: "#",
        field: "_row",
        width: 52,
        minWidth: 52,
        maxWidth: 52,
        pinned: "left",
        suppressMovable: true,
        sortable: false,
        filter: false,
        cellStyle: { color: "#9ca3af", fontWeight: 500, fontSize: "11px", background: "#f9fafb", textAlign: "right", paddingRight: "8px" },
        headerClass: "row-num-header",
      };
      return [
        rowNumCol,
        ...normalizedColumns.map((col) => ({
          headerName: col,
          field: col,
          cellClass: (params) => getCellClass(params),
        })),
      ];
    },
    [normalizedColumns, startCell, endCell]
  );

  const onCellClicked = (params) => {
    if (isRawOnlyMode) return;
    if (params.colDef.field === "_row") return;
    if (!startCell) {
      setStartCell({ row: params.rowIndex, col: params.colDef.field });
    } else if (!endCell) {
      setEndCell({ row: params.rowIndex, col: params.colDef.field });
    } else {
      setStartCell({ row: params.rowIndex, col: params.colDef.field });
      setEndCell(null);
    }
  };

  const buildRawOnlyRule = () => ({
    table_name: tableName?.trim() || "raw_file",
    extraction_mode: "raw_only",
    start_row: 0,
    end_row: 0,
    columns: [],
    horizontal_anchor_row: null,
    horizontal_start_column: null,
    horizontal_end_column: null,
    vertical_header_column: null,
    vertical_start_row: null,
    vertical_end_row: null,
    header_option: "keep_existing",
    null_strategy: "none",
    auto_cast_types: false,
    shape_transform: { mode: "none" },
    custom_headers: null,
  });

  const getColumnRange = () => {
    const startIndex = normalizedColumns.indexOf(startCell.col);
    const endIndex = normalizedColumns.indexOf(endCell.col);
    return normalizedColumns.slice(
      Math.min(startIndex, endIndex),
      Math.max(startIndex, endIndex) + 1
    );
  };

  const getColumnsBetween = (startCol, endCol) => {
    const startIndex = normalizedColumns.indexOf(startCol);
    const endIndex = normalizedColumns.indexOf(endCol);
    if (startIndex === -1 || endIndex === -1) return [];
    return normalizedColumns.slice(
      Math.min(startIndex, endIndex),
      Math.max(startIndex, endIndex) + 1
    );
  };

  const getSelectedColumnsForConfig = () => {
    if (!startCell || !endCell) return [];

    if (extractionMode === "range") {
      return getColumnRange();
    }
    if (extractionMode === "headers_horizontal") {
      return getColumnsBetween(startCell.col, endCell.col);
    }
    if (extractionMode === "headers_vertical") {
      const startCol = startCell.col;
      const rowMin = Math.min(startCell.row, endCell.row);
      const rowMax = Math.max(startCell.row, endCell.row);
      const startColIndex = normalizedColumns.indexOf(startCol);
      if (startColIndex === -1) return [];

      const candidateColumns = normalizedColumns.slice(startColIndex);
      const selected = [];
      let foundData = false;

      for (const col of candidateColumns) {
        let hasDataInBlock = false;
        for (let rowIdx = rowMin; rowIdx <= rowMax; rowIdx++) {
          const rowData = normalizedRows[rowIdx] || {};
          const value = rowData[col];
          if (value !== null && value !== undefined && String(value).trim() !== "") {
            hasDataInBlock = true;
            break;
          }
        }

        if (!foundData && hasDataInBlock) {
          foundData = true;
        }
        if (foundData && !hasDataInBlock) {
          break;
        }
        if (hasDataInBlock) {
          selected.push(col);
        }
      }

      return selected;
    }
    return [];
  };

  const getVerticalHeaderCandidates = () => {
    if (extractionMode !== "headers_vertical" || !startCell || !endCell) return [];
    if (startCell.col !== endCell.col) return [];

    const rowMin = Math.min(startCell.row, endCell.row);
    const rowMax = Math.max(startCell.row, endCell.row);
    const keyColumn = startCell.col;
    const labels = [];

    for (let rowIdx = rowMin; rowIdx <= rowMax; rowIdx++) {
      const rowData = normalizedRows[rowIdx] || {};
      const value = rowData[keyColumn];
      const text = value === null || value === undefined ? "" : String(value).trim();
      if (text) {
        labels.push(text);
      }
    }

    return labels;
  };

  const getCellClass = (params) => {
    if (!startCell || !endCell) return "";
    const rowMin = Math.min(startCell.row, endCell.row);
    const rowMax = Math.max(startCell.row, endCell.row);
    const colIndex = normalizedColumns.indexOf(params.colDef.field);
    const startCol = normalizedColumns.indexOf(startCell.col);
    const endCol = normalizedColumns.indexOf(endCell.col);
    const colMin = Math.min(startCol, endCol);
    const colMax = Math.max(startCol, endCol);
    if (
      params.rowIndex >= rowMin &&
      params.rowIndex <= rowMax &&
      colIndex >= colMin &&
      colIndex <= colMax
    ) {
      return "selected-cell";
    }
    return "";
  };

  const handleSave = () => {
    if (isRawOnlyMode) {
      const rule = buildRawOnlyRule();
      onSaveRule(rule);
      setStartCell(null);
      setEndCell(null);
      setShowHeaderModal(false);
      setHeaderOption("keep_existing");
      setCustomHeaders([]);
      setTableName("");
      setNullStrategy("none");
      setAutoCastTypes(true);
      setShapeMode("none");
      setUnpivotIdColumns("");
      setUnpivotValueColumns("");
      setPivotIndexColumns("");
      setPivotColumn("");
      setPivotValueColumn("");
      return;
    }

    if (!startCell || !endCell) {
      alert("Selecciona celda inicio y celda fin");
      return;
    }

    if (extractionMode === "headers_horizontal" && startCell.row !== endCell.row) {
      alert("En encabezados horizontal, inicio y fin deben estar en la misma fila");
      return;
    }

    if (extractionMode === "headers_vertical" && startCell.col !== endCell.col) {
      alert("En encabezados vertical, inicio y fin deben estar en la misma columna");
      return;
    }

    if (!showHeaderModal) {
      setHeaderOption("keep_existing");
      setShowHeaderModal(true);
      return;
    }

    const selectedColumns = getSelectedColumnsForConfig();
    if (!selectedColumns.length) {
      alert("No se pudieron determinar columnas para la regla");
      return;
    }

    const rowMin = Math.min(startCell.row, endCell.row);
    const rowMax = Math.max(startCell.row, endCell.row);
    const startRow = extractionMode === "range" ? rowMin : 0;
    const endRow = extractionMode === "range" ? rowMax + 1 : 0;

    const rule = {
      table_name: tableName?.trim() || `tabla_${(pendingSheetRule?.tables || []).length + 1}`,
      extraction_mode: extractionMode,
      start_row: startRow,
      end_row: endRow,
      columns: selectedColumns,
      horizontal_anchor_row: extractionMode === "headers_horizontal" ? rowMin : null,
      horizontal_start_column: extractionMode === "headers_horizontal" ? startCell.col : null,
      horizontal_end_column: extractionMode === "headers_horizontal" ? endCell.col : null,
      vertical_header_column: extractionMode === "headers_vertical" ? startCell.col : null,
      vertical_start_row: extractionMode === "headers_vertical" ? rowMin : null,
      vertical_end_row: extractionMode === "headers_vertical" ? rowMax + 1 : null,
      header_option: headerOption,
      null_strategy: nullStrategy,
      auto_cast_types: extractionMode === "headers_vertical" ? false : autoCastTypes,
      shape_transform:
        extractionMode === "headers_vertical"
          ? { mode: "none" }
          : shapeMode === "unpivot"
          ? {
              mode: "unpivot",
              id_columns: unpivotIdColumns.split(",").map((c) => c.trim()).filter(Boolean),
              value_columns: unpivotValueColumns.split(",").map((c) => c.trim()).filter(Boolean),
            }
          : shapeMode === "pivot"
            ? {
                mode: "pivot",
                index_columns: pivotIndexColumns.split(",").map((c) => c.trim()).filter(Boolean),
                pivot_column: pivotColumn.trim(),
                value_column: pivotValueColumn.trim(),
                aggfunc: "first",
              }
            : { mode: "none" },
      custom_headers:
        headerOption === "manual"
          ? customHeaders.slice(
              0,
              extractionMode === "headers_vertical"
                ? getVerticalHeaderCandidates().length
                : selectedColumns.length
            )
          : null,
    };

    onSaveRule(rule);
    setStartCell(null);
    setEndCell(null);
    setShowHeaderModal(false);
    setHeaderOption("keep_existing");
    setCustomHeaders([]);
    setTableName("");
    setNullStrategy("none");
    setAutoCastTypes(true);
    setShapeMode("none");
    setUnpivotIdColumns("");
    setUnpivotValueColumns("");
    setPivotIndexColumns("");
    setPivotColumn("");
    setPivotValueColumn("");
  };

  const handleHeaderOptionChange = (option) => {
    setHeaderOption(option);
    if (option === "first_row") {
      setCustomHeaders([]);
    } else if (option === "manual") {
      const targetItems = extractionMode === "headers_vertical"
        ? getVerticalHeaderCandidates()
        : getSelectedColumnsForConfig();
      setCustomHeaders(Array(targetItems.length).fill(""));
    }
  };

  const closeModal = () => {
    setShowHeaderModal(false);
    setHeaderOption("keep_existing");
    setCustomHeaders([]);
  };

  return (
    <div className="excel-viewer">
      <div className="excel-toolbar">
        <div style={{ marginBottom: "8px" }}>
          <button
            type="button"
            onClick={() => {
              setIsRawOnlyMode((prev) => {
                const next = !prev;
                if (next) {
                  onSaveRule(buildRawOnlyRule(), { silent: true });
                }
                return next;
              });
              setStartCell(null);
              setEndCell(null);
              setShowHeaderModal(false);
              setHeaderOption("keep_existing");
              setCustomHeaders([]);
            }}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "10px",
              padding: "10px 12px",
              borderRadius: "8px",
              border: `1.5px solid ${isRawOnlyMode ? "#0284c7" : "#d1d5db"}`,
              background: isRawOnlyMode ? "#e0f2fe" : "#ffffff",
              color: isRawOnlyMode ? "#075985" : "#374151",
              cursor: "pointer",
            }}
            title="Regla especial: mover el archivo completo sin aplicar extracción"
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontWeight: 700, fontSize: "12px" }}>
              <span style={{ fontSize: "14px" }}>🧱</span>
              Mover archivo completo (crudo)
            </span>
            <span style={{ fontSize: "11px", fontWeight: 700 }}>
              {isRawOnlyMode ? "ACTIVO" : "INACTIVO"}
            </span>
          </button>
          <div style={{ marginTop: "5px", fontSize: "11px", color: "#6b7280" }}>
            Si activas esta regla, no necesitas seleccionar rangos ni encabezados. La instancia solo moverá el archivo crudo.
          </div>
        </div>

        <div className="excel-toolbar-row">
          <span className="section-kicker" style={{ margin: 0 }}>Acciones de regla</span>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <label style={{ fontSize: "11px", color: "#6b7280", fontWeight: 600 }}>Hoja</label>
            <select
              value={selectedSheet || data.current_sheet_name || ""}
              onChange={(e) => !isRawOnlyMode && onSheetChange && onSheetChange(e.target.value)}
              disabled={isRawOnlyMode}
              style={{
                minWidth: "150px",
                padding: "5px 8px",
                border: "1px solid #d1d5db",
                borderRadius: "7px",
                background: isRawOnlyMode ? "#f3f4f6" : "#fff",
                color: isRawOnlyMode ? "#9ca3af" : "#111827",
                fontSize: "12px",
                cursor: isRawOnlyMode ? "not-allowed" : "pointer",
              }}
            >
              {(data.sheet_names || []).map((sheet) => (
                <option key={sheet} value={sheet}>{sheet}</option>
              ))}
            </select>
          </div>
          <div className="excel-actions">
            <button
              className="btn-primary section-btn"
              onClick={handleSave}
              disabled={isRawOnlyMode}
              style={{ opacity: isRawOnlyMode ? 0.5 : 1, cursor: isRawOnlyMode ? "not-allowed" : "pointer" }}
              title={isRawOnlyMode ? "En modo crudo, la regla se define con el botón superior" : "Guardar reglas de hoja"}
            >
              Guardar reglas de hoja
            </button>
            <button
              className="btn-secondary section-btn"
              disabled={isRawOnlyMode}
              onClick={() => {
                setStartCell(null);
                setEndCell(null);
                setShowHeaderModal(false);
                setHeaderOption("keep_existing");
                setCustomHeaders([]);
              }}
              style={{ opacity: isRawOnlyMode ? 0.5 : 1, cursor: isRawOnlyMode ? "not-allowed" : "pointer" }}
              title={isRawOnlyMode ? "No aplica en modo crudo" : "Limpiar selección"}
            >
              Limpiar seleccion
            </button>
          </div>
        </div>

        <div style={{ marginTop: "8px", padding: "10px", border: "1px solid #e5e7eb", borderRadius: "8px", background: "#f9fafb", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "8px", opacity: isRawOnlyMode ? 0.45 : 1, pointerEvents: isRawOnlyMode ? "none" : "auto" }}>
          <div>
            <label style={{ fontSize: "10px", fontWeight: 600, color: "#6b7280", marginBottom: "4px", display: "block" }}>Modo extraccion</label>
            <select value={extractionMode} onChange={(e) => { setExtractionMode(e.target.value); setIsRawOnlyMode(false); }} style={{ width: "100%", padding: "5px 7px", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "12px" }}>
              <option value="range">Rango (inicio-fin)</option>
              <option value="headers_horizontal">Encabezados horizontal</option>
              <option value="headers_vertical">Encabezados vertical</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: "10px", fontWeight: 600, color: "#6b7280", marginBottom: "4px", display: "block" }}>Nombre tabla output</label>
            <input value={tableName} onChange={(e) => setTableName(e.target.value)} placeholder={`tabla_${(pendingSheetRule?.tables || []).length + 1}`} style={{ width: "100%", padding: "5px 7px", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "12px" }} />
          </div>
          <div>
            <label style={{ fontSize: "10px", fontWeight: 600, color: "#6b7280", marginBottom: "4px", display: "block" }}>
              Nulos
              <span
                title="Define como rellenar celdas vacias de la tabla seleccionada"
                style={{ marginLeft: "5px", color: "#9ca3af", cursor: "help" }}
              >
                ( ? )
              </span>
            </label>
            <select value={nullStrategy} onChange={(e) => setNullStrategy(e.target.value)} style={{ width: "100%", padding: "5px 7px", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "12px" }}>
              <option value="none">Sin cambio</option>
              <option value="forward_fill">Arrastre abajo (ffill)</option>
              <option value="backward_fill">Arrastre arriba (bfill)</option>
              <option value="zero">Rellenar con 0</option>
              <option value="empty_string">Rellenar vacío</option>
            </select>
            <div style={{ marginTop: "4px", fontSize: "10px", color: "#9ca3af", lineHeight: 1.35 }}>
              ffill/bfill copia el valor vecino para completar celdas vacías.
            </div>
          </div>
          <div>
            <label style={{ fontSize: "10px", fontWeight: 600, color: "#6b7280", marginBottom: "4px", display: "block" }}>Shape</label>
            <select
              value={shapeMode}
              onChange={(e) => setShapeMode(e.target.value)}
              disabled={extractionMode === "headers_vertical" || isRawOnlyMode}
              style={{ width: "100%", padding: "5px 7px", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "12px", opacity: extractionMode === "headers_vertical" || isRawOnlyMode ? 0.6 : 1 }}
            >
              <option value="none">Sin cambio</option>
              <option value="unpivot">Unpivot</option>
              <option value="pivot">Pivot</option>
            </select>
            {(extractionMode === "headers_vertical" || isRawOnlyMode) && (
              <div style={{ marginTop: "4px", fontSize: "10px", color: "#9ca3af", lineHeight: 1.35 }}>
                {isRawOnlyMode ? "En modo crudo no se aplica transformación." : "En modo vertical, shape no aplica."}
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <label
              title="Intenta convertir texto a numero o fecha cuando la mayoria de valores coincide con ese tipo"
              style={{ fontSize: "11px", color: "#6b7280", display: "inline-flex", alignItems: "center", gap: "6px", cursor: "help" }}
            >
              <input
                type="checkbox"
                checked={extractionMode === "headers_vertical" || isRawOnlyMode ? false : autoCastTypes}
                disabled={extractionMode === "headers_vertical" || isRawOnlyMode}
                onChange={(e) => setAutoCastTypes(e.target.checked)}
              />
              Auto tipado
            </label>
          </div>
          {!isRawOnlyMode && extractionMode !== "headers_vertical" && shapeMode === "unpivot" && (
            <>
              <div>
                <label style={{ fontSize: "10px", fontWeight: 600, color: "#6b7280", marginBottom: "4px", display: "block" }}>Unpivot id_columns</label>
                <input value={unpivotIdColumns} onChange={(e) => setUnpivotIdColumns(e.target.value)} placeholder="colA,colB" style={{ width: "100%", padding: "5px 7px", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "12px" }} />
              </div>
              <div>
                <label style={{ fontSize: "10px", fontWeight: 600, color: "#6b7280", marginBottom: "4px", display: "block" }}>Unpivot value_columns</label>
                <input value={unpivotValueColumns} onChange={(e) => setUnpivotValueColumns(e.target.value)} placeholder="colC,colD" style={{ width: "100%", padding: "5px 7px", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "12px" }} />
              </div>
            </>
          )}
          {!isRawOnlyMode && extractionMode !== "headers_vertical" && shapeMode === "pivot" && (
            <>
              <div>
                <label style={{ fontSize: "10px", fontWeight: 600, color: "#6b7280", marginBottom: "4px", display: "block" }}>Pivot index_columns</label>
                <input value={pivotIndexColumns} onChange={(e) => setPivotIndexColumns(e.target.value)} placeholder="id,fecha" style={{ width: "100%", padding: "5px 7px", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "12px" }} />
              </div>
              <div>
                <label style={{ fontSize: "10px", fontWeight: 600, color: "#6b7280", marginBottom: "4px", display: "block" }}>Pivot column</label>
                <input value={pivotColumn} onChange={(e) => setPivotColumn(e.target.value)} placeholder="categoria" style={{ width: "100%", padding: "5px 7px", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "12px" }} />
              </div>
              <div>
                <label style={{ fontSize: "10px", fontWeight: 600, color: "#6b7280", marginBottom: "4px", display: "block" }}>Pivot value_column</label>
                <input value={pivotValueColumn} onChange={(e) => setPivotValueColumn(e.target.value)} placeholder="valor" style={{ width: "100%", padding: "5px 7px", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "12px" }} />
              </div>
            </>
          )}

        </div>

        {(pendingSheetRule?.tables || []).length > 0 && (
          <div style={{ marginTop: "8px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {(pendingSheetRule.tables || []).map((table, idx) => (
              <span key={`${table.table_name || idx}`} style={{ fontSize: "10px", background: "#e5e7eb", color: "#374151", border: "1px solid #d1d5db", borderRadius: "999px", padding: "2px 8px" }}>
                {table.table_name || `tabla_${idx + 1}`}
              </span>
            ))}
          </div>
        )}

        {(data.sheet_names || []).length > 1 && ([
          <div key="sheet-selector" style={{ marginTop: "8px", padding: "10px", border: "1px solid #e5e7eb", borderRadius: "8px", background: "#f9fafb" }}>
            {/* Header row with title + select-all controls */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280" }}>
                Hojas a configurar y procesar
                <span style={{ marginLeft: "6px", fontWeight: 400, color: "#9ca3af" }}>
                  ({(pendingEnabledSheets || []).length}/{(data.sheet_names || []).length} seleccionadas)
                </span>
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  type="button"
                  onClick={() => setPendingEnabledSheets([...(data.sheet_names || [])])}
                  style={{ fontSize: "10px", padding: "3px 8px", background: "white", border: "1px solid #d1d5db", borderRadius: "5px", cursor: "pointer", color: "#374151", fontWeight: 600 }}
                >
                  ✓ Todas
                </button>
                <button
                  type="button"
                  onClick={() => setPendingEnabledSheets([])}
                  style={{ fontSize: "10px", padding: "3px 8px", background: "white", border: "1px solid #d1d5db", borderRadius: "5px", cursor: "pointer", color: "#374151", fontWeight: 600 }}
                >
                  ✕ Ninguna
                </button>
              </div>
            </div>

            {/* Compact scrollable grid — 2 columns, max 5 rows visible */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: "4px 16px",
              maxHeight: (data.sheet_names || []).length > 10 ? "150px" : undefined,
              overflowY: (data.sheet_names || []).length > 10 ? "auto" : undefined,
              paddingRight: (data.sheet_names || []).length > 10 ? "4px" : undefined,
              marginBottom: "8px",
            }}>
              {(data.sheet_names || []).map((sheet) => (
                <label key={sheet} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12px",
                  color: (pendingEnabledSheets || []).includes(sheet) ? "#1d4ed8" : "#374151",
                  padding: "4px 6px",
                  borderRadius: "5px",
                  background: (pendingEnabledSheets || []).includes(sheet) ? "#eff6ff" : "transparent",
                  cursor: "pointer",
                  border: `1px solid ${(pendingEnabledSheets || []).includes(sheet) ? "#bfdbfe" : "transparent"}`,
                  userSelect: "none",
                }}>
                  <input
                    type="checkbox"
                    checked={(pendingEnabledSheets || []).includes(sheet)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setPendingEnabledSheets((prev) => Array.from(new Set([...(prev || []), sheet])));
                      } else {
                        setPendingEnabledSheets((prev) => (prev || []).filter((s) => s !== sheet));
                      }
                    }}
                    style={{ accentColor: "#1d4ed8" }}
                  />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sheet}</span>
                </label>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                className="btn-secondary"
                onClick={async () => {
                  if (!pendingEnabledSheets.length) {
                    alert("Debes dejar al menos una hoja habilitada");
                    return;
                  }
                  try {
                    if (onEnabledSheetsChange) {
                      await onEnabledSheetsChange(pendingEnabledSheets);
                    }
                  } catch (err) {
                    alert("No se pudo actualizar la seleccion de hojas");
                  }
                }}
                style={{ minHeight: "30px", fontSize: "11px" }}
              >
                Aplicar seleccion de hojas
              </button>
            </div>
          </div>
        ])}

        {(startCell || endCell) && (
          <div className="excel-range-pills">
            {startCell && (
              <span className="range-pill range-start">
                Inicio: f{startCell.row} - {startCell.col}
              </span>
            )}
            {endCell && (
              <span className="range-pill range-end">
                Fin: f{endCell.row} - {endCell.col}
              </span>
            )}
          </div>
        )}

        {extractionMode === "headers_horizontal" && startCell && endCell && (
          <div className="excel-range-pills">
            <span className="range-pill range-start">Fila encabezado: {startCell.row}</span>
            <span className="range-pill range-end">Columnas: {startCell.col} a {endCell.col}</span>
          </div>
        )}

        {extractionMode === "headers_vertical" && startCell && endCell && (
          <div className="excel-range-pills">
            <span className="range-pill range-start">Columna encabezado: {startCell.col}</span>
            <span className="range-pill range-end">Filas: {Math.min(startCell.row, endCell.row)} a {Math.max(startCell.row, endCell.row)}</span>
          </div>
        )}
      </div>

      {showHeaderModal && (
        <div className="modal-overlay" onClick={() => {}}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#111827" }}>Nombres de columnas</span>
              <button
                onClick={closeModal}
                style={{ width: "26px", height: "26px", background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: "6px", cursor: "pointer", fontSize: "12px", display: "flex", alignItems: "center", justifyContent: "center" }}
              >X</button>
            </div>

            <p style={{ fontSize: "12px", color: "#6b7280", marginBottom: "12px" }}>
              Elige como configurar los nombres de las columnas seleccionadas:
            </p>

            {[
              {
                value: "keep_existing",
                label: extractionMode === "headers_vertical" ? "Usar encabezados verticales detectados" : "Mantener encabezado actual",
                desc: extractionMode === "headers_vertical" ? "Toma los nombres desde la columna vertical seleccionada." : "Conserva los nombres de columnas detectados del archivo.",
              },
              ...(extractionMode === "headers_vertical"
                ? []
                : [{ value: "first_row", label: "Usar primera fila como cabecera", desc: "Los valores de la primera fila seran los nombres de columnas." }]),
              {
                value: "manual",
                label: "Ingresar nombres manualmente",
                desc: extractionMode === "headers_vertical" ? "Renombra los encabezados detectados desde el eje vertical." : "Define el nombre de cada columna.",
              },
            ].map(({ value, label, desc }) => (
              <label
                key={value}
                htmlFor={value}
                style={{
                  display: "flex", gap: "10px", alignItems: "flex-start",
                  padding: "10px 12px",
                  border: `1px solid ${headerOption === value ? "#9ca3af" : "#e5e7eb"}`,
                  borderRadius: "8px",
                  marginBottom: "6px",
                  background: headerOption === value ? "#f3f4f6" : "white",
                  cursor: "pointer",
                  transition: "border-color 0.15s, background 0.15s",
                }}
              >
                <input
                  type="radio"
                  id={value}
                  name="header-option"
                  value={value}
                  checked={headerOption === value}
                  onChange={() => handleHeaderOptionChange(value)}
                  style={{ marginTop: "2px", cursor: "pointer" }}
                />
                <div>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "#111827" }}>{label}</div>
                  <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>{desc}</div>
                </div>
              </label>
            ))}

            {headerOption === "manual" && (
              <div style={{ marginTop: "10px", padding: "12px", background: "#f9fafb", borderRadius: "8px", border: "1px solid #e5e7eb" }}>
                <div style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "10px" }}>
                  {extractionMode === "headers_vertical" ? "Nombres de encabezados verticales" : "Nombres de columnas"}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "8px" }}>
                  {(extractionMode === "headers_vertical" ? getVerticalHeaderCandidates() : getSelectedColumnsForConfig()).map((col, idx) => (
                    <div key={`col_${idx}`}>
                      <label style={{ fontSize: "10px", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "3px", display: "block" }}>
                        {col}
                      </label>
                      <input
                        type="text"
                        placeholder={`Ej: ${col}`}
                        value={customHeaders[idx] !== undefined ? customHeaders[idx] : ""}
                        onChange={(e) => {
                          const newHeaders = [...customHeaders];
                          newHeaders[idx] = e.target.value;
                          setCustomHeaders(newHeaders);
                        }}
                        onFocus={(e) => e.target.select()}
                        onMouseDown={(e) => e.stopPropagation()}
                        style={{ width: "100%", padding: "5px 8px", border: "1px solid #e5e7eb", borderRadius: "6px", fontSize: "12px", background: "white", boxSizing: "border-box" }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end", marginTop: "14px" }}>
              <button className="btn-secondary" onClick={closeModal}>Cancelar</button>
              <button className="btn-primary" onClick={handleSave}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      <div className="excel-grid-wrapper">
        <div className="ag-theme-quartz excel-grid" style={{ height: 520, marginTop: 10 }}>
          <AgGridReact
            ref={gridRef}
            rowData={normalizedRows}
            columnDefs={columnDefs}
            onCellClicked={onCellClicked}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px", justifyContent: "flex-end" }}>
          <span style={{ fontSize: "11px", color: "#9ca3af" }}>
            Mostrando {normalizedRows.length} fila{normalizedRows.length !== 1 ? "s" : ""}
          </span>
          <span style={{ fontSize: "11px", color: "#9ca3af" }}>·</span>
          <span style={{ fontSize: "11px", color: "#6b7280", fontWeight: 600 }}>Filas del preview:</span>
          {[50, 100, 200, 500].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onPreviewRowsChange && onPreviewRowsChange(n)}
              style={{
                fontSize: "11px",
                padding: "2px 7px",
                borderRadius: "5px",
                border: `1px solid ${previewRows === n ? "#3b82f6" : "#d1d5db"}`,
                background: previewRows === n ? "#eff6ff" : "white",
                color: previewRows === n ? "#1d4ed8" : "#374151",
                fontWeight: previewRows === n ? 700 : 400,
                cursor: "pointer",
              }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <style>
        {`
          .excel-viewer .excel-toolbar {
            margin-bottom: 10px;
          }

          .excel-viewer .excel-toolbar-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            flex-wrap: wrap;
          }

          .excel-viewer .excel-actions {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
          }

          .excel-viewer .excel-range-pills {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
            margin-top: 8px;
          }

          .excel-viewer .range-pill {
            font-size: 11px;
            padding: 3px 8px;
            border-radius: 999px;
            font-weight: 500;
            border: 1px solid #e5e7eb;
            background: #f3f4f6;
            color: #4b5563;
          }

          .excel-viewer .range-start {
            background: #f3f4f6;
            color: #374151;
            border-color: #d1d5db;
          }

          .excel-viewer .range-end {
            background: #e5e7eb;
            color: #1f2937;
            border-color: #d1d5db;
          }

          .excel-viewer .excel-grid {
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            overflow: hidden;
            background: white;
          }

          .selected-cell {
            background-color: rgba(107, 114, 128, 0.28) !important;
          }
        `}
      </style>
    </div>
  );
}
