import { AgGridReact } from "ag-grid-react";
import { ModuleRegistry, AllCommunityModule } from "ag-grid-community";

import "ag-grid-community/styles/ag-theme-quartz.css";

ModuleRegistry.registerModules([AllCommunityModule]);

export default function ResultTable({ data }) {
  if (!data || data.length === 0) {
    return <div className="result-empty">No hay datos para esta ejecución</div>;
  }

  const columns = Object.keys(data[0]);

  const columnDefs = columns.map((col) => ({
    headerName: col,
    field: col,
    cellDataType: false,
  }));

  return (
    <div className="result-table-shell">
      <div className="ag-theme-quartz" style={{ height: 400 }}>
        <AgGridReact
          rowData={data}
          columnDefs={columnDefs}
          defaultColDef={{ cellDataType: false }}
        />
      </div>
    </div>
  );
}