import { useEffect, useMemo, useRef, useState } from "react";

const DAY_MINUTES = 24 * 60;
const STEP_MINUTES = 5;
const MIN_RANGE_MINUTES = 10;

const pad2 = (n) => String(n).padStart(2, "0");

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm || "00:00").split(":").map((v) => Number(v) || 0);
  return (h * 60) + m;
};

const toHHMM = (minutes) => {
  const safe = Math.max(0, Math.min(DAY_MINUTES, minutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${pad2(h)}:${pad2(m)}`;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const snap = (value) => Math.round(value / STEP_MINUTES) * STEP_MINUTES;

const normalizeRanges = (ranges) => {
  const normalized = (Array.isArray(ranges) ? ranges : [])
    .map((r) => ({
      hora_inicio: toHHMM(toMinutes(r?.hora_inicio || "00:00")),
      hora_fin: toHHMM(toMinutes(r?.hora_fin || "00:00")),
    }))
    .filter((r) => toMinutes(r.hora_fin) > toMinutes(r.hora_inicio))
    .sort((a, b) => toMinutes(a.hora_inicio) - toMinutes(b.hora_inicio));

  return normalized;
};

const getNeighborBounds = (sortedRanges, index) => {
  const prev = sortedRanges[index - 1];
  const next = sortedRanges[index + 1];
  return {
    minStart: prev ? toMinutes(prev.hora_fin) : 0,
    maxEnd: next ? toMinutes(next.hora_inicio) : DAY_MINUTES,
  };
};

const findFirstGap = (sortedRanges, minSize) => {
  let cursor = 0;
  for (const r of sortedRanges) {
    const start = toMinutes(r.hora_inicio);
    if (start - cursor >= minSize) {
      return { start: cursor, end: start };
    }
    cursor = Math.max(cursor, toMinutes(r.hora_fin));
  }
  if (DAY_MINUTES - cursor >= minSize) {
    return { start: cursor, end: DAY_MINUTES };
  }
  return null;
};

export default function ScheduleRangeEditor({
  ranges,
  onChange,
  addButtonLabel = "+ Agregar nuevo rango",
  accent = "#7c3aed",
}) {
  const trackRef = useRef(null);
  const [drag, setDrag] = useState(null);

  const safeRanges = useMemo(() => normalizeRanges(ranges), [ranges]);

  const updateRanges = (nextRanges) => {
    const normalized = normalizeRanges(nextRanges);
    if (normalized.length === 0) return;
    onChange?.(normalized);
  };

  const addRange = () => {
    const normalized = normalizeRanges(safeRanges);
    const gap = findFirstGap(normalized, MIN_RANGE_MINUTES);
    if (!gap) return;

    const gapSize = gap.end - gap.start;
    const duration = clamp(120, MIN_RANGE_MINUTES, gapSize);
    const start = gap.start;
    const end = start + duration;

    updateRanges([...normalized, { hora_inicio: toHHMM(start), hora_fin: toHHMM(end) }]);
  };

  const removeRange = (index) => {
    if (safeRanges.length <= 1) return;
    updateRanges(safeRanges.filter((_, i) => i !== index));
  };

  const startDrag = (event, index, mode) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = event.clientX;
    const target = safeRanges[index];
    if (!target) return;

    setDrag({
      mode,
      index,
      startX: x,
      width: rect.width || 1,
      startMin: toMinutes(target.hora_inicio),
      endMin: toMinutes(target.hora_fin),
    });

    event.preventDefault();
    event.stopPropagation();
  };

  useEffect(() => {
    if (!drag) return undefined;

    const onMove = (event) => {
      const dx = event.clientX - drag.startX;
      const deltaMinutes = snap((dx / drag.width) * DAY_MINUTES);
      const next = safeRanges.map((r) => ({ ...r }));
      const current = next[drag.index];
      if (!current) return;
      const { minStart, maxEnd } = getNeighborBounds(safeRanges, drag.index);

      if (drag.mode === "move") {
        const duration = drag.endMin - drag.startMin;
        let start = clamp(drag.startMin + deltaMinutes, minStart, maxEnd - duration);
        let end = start + duration;
        current.hora_inicio = toHHMM(start);
        current.hora_fin = toHHMM(end);
      } else if (drag.mode === "start") {
        const maxStart = drag.endMin - MIN_RANGE_MINUTES;
        const start = clamp(drag.startMin + deltaMinutes, minStart, maxStart);
        current.hora_inicio = toHHMM(start);
      } else if (drag.mode === "end") {
        const minEnd = drag.startMin + MIN_RANGE_MINUTES;
        const end = clamp(drag.endMin + deltaMinutes, minEnd, maxEnd);
        current.hora_fin = toHHMM(end);
      }

      onChange?.(normalizeRanges(next));
    };

    const onUp = () => setDrag(null);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, onChange, safeRanges]);

  const toPct = (minutes) => `${(minutes / DAY_MINUTES) * 100}%`;

  return (
    <div style={{ border: "1px dashed #c4b5fd", borderRadius: "8px", background: "white", padding: "8px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
        <div style={{ fontSize: "10px", color: "#6b7280" }}>Arrastra el bloque para moverlo y sus extremos para expandir/reducir</div>
        <button
          type="button"
          onClick={addRange}
          style={{ border: "1px solid #c4b5fd", background: "#ede9fe", color: "#6d28d9", borderRadius: "999px", padding: "2px 9px", fontSize: "10px", fontWeight: 700, cursor: "pointer" }}
        >
          {addButtonLabel}
        </button>
      </div>

      <div ref={trackRef} style={{ position: "relative", height: "36px", borderRadius: "8px", background: "#f3f4f6", overflow: "hidden" }}>
        {safeRanges.map((r, idx) => {
          const startMin = toMinutes(r.hora_inicio);
          const endMin = toMinutes(r.hora_fin);
          return (
            <div
              key={`r-${idx}`}
              title={`${r.hora_inicio} - ${r.hora_fin}`}
              style={{
                position: "absolute",
                left: toPct(startMin),
                width: toPct(Math.max(endMin - startMin, MIN_RANGE_MINUTES)),
                top: "4px",
                bottom: "4px",
                background: "rgba(124,58,237,0.28)",
                border: `1px solid ${accent}`,
                borderRadius: "7px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                boxSizing: "border-box",
              }}
            >
              <span
                onMouseDown={(e) => startDrag(e, idx, "start")}
                style={{ width: "8px", height: "100%", cursor: "ew-resize", background: "rgba(124,58,237,0.35)", borderTopLeftRadius: "6px", borderBottomLeftRadius: "6px", flexShrink: 0 }}
              />

              <span
                onMouseDown={(e) => startDrag(e, idx, "move")}
                style={{
                  flex: 1,
                  minWidth: 0,
                  textAlign: "center",
                  fontSize: "10px",
                  color: "#4c1d95",
                  fontWeight: 700,
                  cursor: "grab",
                  userSelect: "none",
                  whiteSpace: "nowrap",
                  padding: "0 4px",
                }}
              >
                R{idx + 1}
              </span>

              <button
                type="button"
                onClick={() => removeRange(idx)}
                title="Eliminar rango"
                disabled={safeRanges.length <= 1}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#6d28d9",
                  width: "16px",
                  height: "100%",
                  cursor: safeRanges.length <= 1 ? "not-allowed" : "pointer",
                  opacity: safeRanges.length <= 1 ? 0.5 : 1,
                  fontSize: "11px",
                  lineHeight: 1,
                  padding: 0,
                  flexShrink: 0,
                }}
              >
                ×
              </button>

              <span
                onMouseDown={(e) => startDrag(e, idx, "end")}
                style={{ width: "8px", height: "100%", cursor: "ew-resize", background: "rgba(124,58,237,0.35)", borderTopRightRadius: "6px", borderBottomRightRadius: "6px", flexShrink: 0 }}
              />
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "5px", fontSize: "9px", color: "#9ca3af" }}>
        <span>00:00</span>
        <span>12:00</span>
        <span>23:59</span>
      </div>

      <div style={{ marginTop: "8px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: "6px" }}>
        {safeRanges.map((r, idx) => {
          const mins = toMinutes(r.hora_fin) - toMinutes(r.hora_inicio);
          const durH = Math.floor(mins / 60);
          const durM = mins % 60;
          return (
            <div key={`legend-${idx}`} style={{ border: "1px solid #e9d5ff", background: "#faf5ff", borderRadius: "7px", padding: "6px 8px" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, color: "#6d28d9", marginBottom: "2px" }}>Rango {idx + 1}</div>
              <div style={{ fontSize: "11px", color: "#374151" }}><strong>Inicio:</strong> {r.hora_inicio}</div>
              <div style={{ fontSize: "11px", color: "#374151" }}><strong>Fin:</strong> {r.hora_fin}</div>
              <div style={{ fontSize: "10px", color: "#6b7280" }}>Duración: {durH}h {durM}m</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
