import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import ScheduleRangeEditor from "./ScheduleRangeEditor";

const API = "/api";

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

// JS Date.getDay(): 0=domingo,1=lunes,...,6=sabado — matches backend _DIAS_MAP values
const DIAS_JS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

const DEFAULT_SCHEDULE_RANGE = { hora_inicio: "08:00", hora_fin: "10:00" };

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm || "00:00").split(":").map((v) => Number(v) || 0);
  return (h * 60) + m;
};

const formatHHMM = (hhmm) => {
  const [h, m] = String(hhmm || "00:00").split(":").map((v) => Number(v) || 0);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

function getScheduleRanges(schedule) {
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
}

function normalizeSchedule(schedule) {
  const base = schedule || { activo: false, tipo: "diario", dias: [] };
  const ranges = getScheduleRanges(base);
  const safeRanges = ranges.length ? ranges : [{ ...DEFAULT_SCHEDULE_RANGE }];
  return {
    ...base,
    rangos: safeRanges,
    hora_inicio: safeRanges[0].hora_inicio,
    hora_fin: safeRanges[safeRanges.length - 1].hora_fin,
  };
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function formatScheduleRanges(schedule) {
  const ranges = getScheduleRanges(schedule);
  if (!ranges.length) return "—";
  return ranges.map((r) => `${r.hora_inicio} - ${r.hora_fin}`).join(" · ");
}

function getNextExpectedLabel(schedule) {
  if (!schedule || !schedule.activo) return null;
  const { tipo, dias } = schedule;
  const ranges = getScheduleRanges(schedule);
  if (!ranges.length) return null;

  const now = new Date();
  const withTime = (d, hhmm) => {
    const [h, m] = (hhmm || "00:00").split(":").map(Number);
    const c = new Date(d);
    c.setHours(h, m, 0, 0);
    return c;
  };
  const fmt = (date) => {
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    const dayName = DIAS_JS[date.getDay()];
    const day = date.getDate();
    const month = date.toLocaleString("es-ES", { month: "short" });
    return `a las ${hh}:${mm} del ${dayName} ${day} de ${month}`;
  };

  const isCommittedDay = (d) => {
    if (tipo === "diario") return true;
    return (dias || []).includes(DIAS_JS[d.getDay()]);
  };

  for (let i = 0; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    if (!isCommittedDay(d)) continue;
    for (const r of ranges) {
      const due = withTime(d, r.hora_fin);
      if (due > now) return fmt(due);
    }
  }
  return null;
}

function scheduleTooltip(schedule) {
  if (!schedule || !schedule.activo) return null;
  const { tipo, dias } = schedule;
  const lines = ["🕐 Compromiso de carga activo"];
  if (tipo === "diario") lines.push("Recurrencia: Diario");
  else lines.push(`Días: ${(dias || []).join(", ") || "–"}`);
  lines.push(`Rangos: ${formatScheduleRanges(schedule)}`);
  return lines.join("\n");
}

// Mirrors backend _check_commitment_alert — recomputed client-side so it's always fresh
// Map English weekday names (from Intl) to Spanish keys used in schedule.dias
const _ENG_TO_SPA_DAY = { sunday: "domingo", monday: "lunes", tuesday: "martes", wednesday: "miercoles", thursday: "jueves", friday: "viernes", saturday: "sabado" };

function _sclWeekdayName(date) {
  const eng = new Intl.DateTimeFormat("en-US", { timeZone: SCL_TZ, weekday: "long" }).format(date).toLowerCase();
  return _ENG_TO_SPA_DAY[eng] || eng;
}

function _sclMinutes(date) {
  // Returns minutes-since-midnight for the given Date interpreted in SCL timezone
  const p = getSCLDateParts(date);
  return p.hour * 60 + p.minute;
}

function _sclDateKey(date) {
  // Returns "YYYY-MM-DD" in SCL timezone for equality checks
  const p = getSCLDateParts(date);
  return `${p.year}-${String(p.month).padStart(2,"0")}-${String(p.day).padStart(2,"0")}`;
}

function computeCommitmentAlert(file) {
  const schedule = file.commitment_schedule;
  if (!schedule || !schedule.activo) return null;
  try {
    const { tipo, dias } = schedule;
    const ranges = getScheduleRanges(schedule);
    if (!ranges.length) return null;

    const now = new Date();
    const todayName = _sclWeekdayName(now);
    if (tipo !== "diario" && !(dias || []).includes(todayName)) return null;

    // All comparisons use minutes-since-midnight in SCL — no browser timezone ambiguity
    const nowMin = _sclMinutes(now);
    const finMin = ranges.reduce((acc, r) => Math.max(acc, toMinutes(r.hora_fin)), 0);

    if (nowMin <= finMin) return null; // window still open

    // If the commitment was configured today AFTER the window already ended,
    // don't penalize — the first real evaluation starts tomorrow.
    const setAtStr = file.commitment_schedule_set_at;
    if (setAtStr) {
      const setAtDate = new Date(setAtStr);
      if (_sclDateKey(setAtDate) === _sclDateKey(now) && _sclMinutes(setAtDate) >= finMin) return null;
    }

    // Window closed — check if any execution was uploaded ON TIME today in SCL
    const todayKey = _sclDateKey(now);
    for (const e of (file.last_executions || []).slice().reverse()) {
      if (!e.timestamp) continue;
      const execDate = new Date(e.timestamp);
      const execMin = _sclMinutes(execDate);
      const inRange = ranges.some((r) => execMin >= toMinutes(r.hora_inicio) && execMin <= toMinutes(r.hora_fin));
      if (_sclDateKey(execDate) === todayKey && inRange && e.status !== "error_formato") return null;
    }
    return "vencido";
  } catch { return null; }
}

const EMPTY_SCHEDULE = normalizeSchedule({ activo: false, tipo: "diario", dias: [], rangos: [{ ...DEFAULT_SCHEDULE_RANGE }] });

const SCL_TZ = "America/Santiago";
function fmtScl(ts, opts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("es-ES", {
    timeZone: SCL_TZ,
    ...(opts || { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
  });
}

function getSCLDateParts(dt) {
  const d = dt instanceof Date ? dt : new Date(dt);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SCL_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(d);
  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: p.hour === "24" ? 0 : +p.hour, minute: +p.minute, second: +p.second };
}

function getScheduleAtTime(commitmentHistory, currentSchedule, isoTs) {
  if (!isoTs) return currentSchedule || null;
  const tsMs = new Date(isoTs).getTime();
  const history = [...(commitmentHistory || [])].sort(
    (a, b) => new Date(a.valid_until).getTime() - new Date(b.valid_until).getTime()
  );
  for (const h of history) {
    if (tsMs < new Date(h.valid_until).getTime()) return h.schedule || null;
  }
  return currentSchedule || null;
}

function ProcessTimeline({ file, feedbackInfo }) {
  const now = new Date();
  const nowMs = now.getTime();
  const hmsToMs = (t) => { if (!t) return 0; const [h, m] = t.split(":").map(Number); return h * 3600000 + m * 60000; };
  const scheduleAt = (isoTs) => getScheduleAtTime(file.commitment_history, file.commitment_schedule, isoTs);

  const checkInStripe = (eTs, sched) => {
    if (!sched?.activo) return false;
    const ep = getSCLDateParts(new Date(eTs));
    const execMsFM = ep.hour * 3600000 + ep.minute * 60000;
    const execSCLDay = new Date(ep.year, ep.month - 1, ep.day).getDay();
    const isCommittedDay = sched.tipo === "diario" || (sched.dias || []).includes(DIAS_JS[execSCLDay]);
    if (!isCommittedDay) return false;
    return getScheduleRanges(sched).some((r) => execMsFM >= hmsToMs(r.hora_inicio) && execMsFM <= hmsToMs(r.hora_fin));
  };

  // Build merged list: one item per past closed committed window (real exec or synthetic vencido)
  const nowParts = getSCLDateParts(now);
  const msFromMidnight = nowParts.hour * 3600000 + nowParts.minute * 60000 + nowParts.second * 1000;
  const todayMidnightMs = nowMs - msFromMidnight;
  const executions = (file.last_executions || []).filter(e => e.timestamp);

  const allItems = []; // { type: "exec"|"vencido", sortMs, ... }

  // Pass 1: real executions → exec items
  executions.forEach(e => {
    const execSched = scheduleAt(e.timestamp);
    const inStripe = checkInStripe(e.timestamp, execSched);
    const hasSched = execSched?.activo;
    const isError = e.status === "error" || e.status === "error_formato";
    const bgColor = isError ? "#ef4444" : e.status === "success" ? "#22c55e" : (STATUS_COLOR[e.status] || "#d1d5db");
    const defaultBorder = STATUS_BORDER_COLOR[e.status] || bgColor;
    const borderColor = hasSched && !inStripe ? "#8b5cf6" : defaultBorder;
    const label = STATUS_LABEL[e.status] || e.status;
    const tooltip = [
      `${e.uploaded_by || "user_x"} · ${fmtScl(e.timestamp)}`,
      `Estado: ${label}`,
      hasSched ? (inStripe ? "✓ Dentro del rango comprometido" : "⚠ Fuera del rango comprometido") : "",
    ].filter(Boolean).join("\n");
    allItems.push({ type: "exec", sortMs: new Date(e.timestamp).getTime(), bgColor, borderColor, tooltip, execId: e.id });
  });

  // Pass 2: iterate over each schedule *period* (history + current) independently.
  // This ensures that changing the schedule never retroactively recalculates past vencidos —
  // each window is always evaluated against the schedule that was explicitly active at that time.
  const scheduleSetMs = file.commitment_schedule_set_at
    ? new Date(file.commitment_schedule_set_at).getTime()
    : executions.length > 0
      ? Math.min(...executions.map(e => new Date(e.timestamp).getTime()))
      : nowMs;
  const scheduleSetParts = getSCLDateParts(new Date(scheduleSetMs));
  const scheduleSetMidnightMs = scheduleSetMs - (scheduleSetParts.hour * 3600000 + scheduleSetParts.minute * 60000 + scheduleSetParts.second * 1000);
  const lookbackStartMs = Math.max(scheduleSetMidnightMs, todayMidnightMs - 60 * 86400000);

  // Build explicit periods: [{schedule, from, until}] sorted ascending
  const sortedHistory = [...(file.commitment_history || [])].sort(
    (a, b) => new Date(a.valid_until).getTime() - new Date(b.valid_until).getTime()
  );
  const periods = [];
  let periodFrom = lookbackStartMs;
  for (const h of sortedHistory) {
    const until = new Date(h.valid_until).getTime();
    if (until <= lookbackStartMs) { periodFrom = until; continue; }
    if (h.schedule?.activo) periods.push({ sched: h.schedule, from: periodFrom, until: Math.min(until, nowMs) });
    periodFrom = until;
  }
  if (file.commitment_schedule?.activo) {
    periods.push({ sched: file.commitment_schedule, from: periodFrom, until: nowMs });
  }

  for (const { sched, from, until } of periods) {
    const { tipo, dias } = sched;
    const ranges = getScheduleRanges(sched);
    if (!ranges.length) continue;
    // Iterate each day whose window could fall within [from, until]
    const periodStartMidnight = (() => {
      const p = getSCLDateParts(new Date(from));
      return from - (p.hour * 3600000 + p.minute * 60000 + p.second * 1000);
    })();
    const daysInPeriod = Math.max(0, Math.round((todayMidnightMs - periodStartMidnight) / 86400000));
    for (let d = daysInPeriod; d >= 0; d--) {
      const dayMs = todayMidnightMs - d * 86400000;
      const dayName = DIAS_JS[new Date(dayMs + 43200000).getDay()];
      if (tipo !== "diario" && !(dias || []).includes(dayName)) continue;
      for (const r of ranges) {
        const windowStartMs = dayMs + hmsToMs(r.hora_inicio);
        const windowEndMs = dayMs + hmsToMs(r.hora_fin);
        // Window must have been *active during this period* and already closed
        if (windowStartMs < from || windowEndMs > until) continue;
        if (windowEndMs >= nowMs) continue;
        const hasOnTimeUpload = executions.some(e => {
          const eMs = new Date(e.timestamp).getTime();
          return eMs >= windowStartMs && eMs <= windowEndMs;
        });
        if (!hasOnTimeUpload) {
          const dateLabel = fmtScl(new Date(windowEndMs).toISOString(), { weekday: "short", day: "numeric", month: "short" });
          allItems.push({
            type: "vencido", sortMs: windowEndMs,
            tooltip: `Sin carga en rango · ${dateLabel}\nRango comprometido: ${r.hora_inicio} – ${r.hora_fin}`,
          });
        }
      }
    }
  }

  // Pass 3: schedule change markers from commitment_history
  (file.commitment_history || []).forEach(h => {
    const changeMs = new Date(h.valid_until).getTime();
    if (changeMs < lookbackStartMs || changeMs > nowMs) return;
    const s = h.schedule || {};
    const dias = s.tipo === "diario" ? "Diario" : (s.dias || []).join(", ") || "—";
    const rango = s.activo ? `${dias} · ${formatScheduleRanges(s)}` : "Desactivado";
    allItems.push({
      type: "change", sortMs: changeMs,
      tooltip: `Cambio de rango comprometido\n${fmtScl(h.valid_until)}\nAntes: ${rango}`,
    });
  });

  // Sort chronologically; last item gets the prominent ring (change markers don't count as "last")
  allItems.sort((a, b) => a.sortMs - b.sortMs);
  const lastDotIdx = allItems.reduce((acc, item, idx) => item.type !== "change" ? idx : acc, -1);

  // 24h forward timeline
  const tomorrowMidnightMs = todayMidnightMs + 86400000;
  const rangeDurMs = 24 * 3600000;
  const toX = (ms) => Math.min(Math.max((ms - nowMs) / rangeDurMs, 0), 1);

  const computeFwdStripe = (dayMs) => {
    const sched = scheduleAt(new Date(dayMs + 43200000).toISOString());
    if (!sched?.activo) return null;
    const { tipo, dias } = sched;
    const ranges = getScheduleRanges(sched);
    if (!ranges.length) return null;
    const dayName = DIAS_JS[new Date(dayMs + 43200000).getDay()];
    if (tipo !== "diario" && !(dias || []).includes(dayName)) return null;
    return ranges
      .map((r) => {
        const clampedStart = Math.max(dayMs + hmsToMs(r.hora_inicio), nowMs);
        const clampedEnd = Math.min(dayMs + hmsToMs(r.hora_fin), nowMs + rangeDurMs);
        if (clampedEnd <= clampedStart) return null;
        return { x1: toX(clampedStart), x2: toX(clampedEnd), hora_inicio: r.hora_inicio, hora_fin: r.hora_fin };
      })
      .filter(Boolean);
  };

  const stripes = [...(computeFwdStripe(todayMidnightMs) || []), ...(computeFwdStripe(tomorrowMidnightMs) || [])];
  const labelNow = fmtScl(now.toISOString(), { hour: "2-digit", minute: "2-digit" });
  const label24h = fmtScl(new Date(nowMs + rangeDurMs).toISOString(), { hour: "2-digit", minute: "2-digit" });

  return (
    <div style={{ marginTop: "8px", userSelect: "none" }}>
      {/* Dots row: one dot per closed committed window + all real executions */}
      {(allItems.length > 0 || feedbackInfo) && (
        <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "6px", flexWrap: "wrap" }}>
          {allItems.map((item, idx) => {
            const isLast = idx === lastDotIdx;
            if (item.type === "change") {
              return (
                <span key={`c-${item.sortMs}`} title={item.tooltip} style={{
                  display: "inline-block", width: "2px", height: "14px",
                  background: "#c4b5fd", borderRadius: "1px", flexShrink: 0,
                  cursor: "default",
                }} />
              );
            }
            if (item.type === "vencido") {
              return (
                <span key={`v-${item.sortMs}`} title={item.tooltip} style={{
                  display: "inline-block",
                  width: isLast ? "11px" : "9px", height: isLast ? "11px" : "9px",
                  borderRadius: "50%", background: "#8b5cf6",
                  border: "2px solid #8b5cf6", boxSizing: "border-box", flexShrink: 0,
                  boxShadow: isLast ? "0 0 0 2px #fff, 0 0 0 3px #8b5cf6" : "none",
                }} />
              );
            }
            return (
              <span key={item.execId || idx} title={item.tooltip} style={{
                display: "inline-block",
                width: isLast ? "11px" : "9px", height: isLast ? "11px" : "9px",
                borderRadius: "50%", background: item.bgColor,
                border: `2px solid ${item.borderColor}`, boxSizing: "border-box", flexShrink: 0,
                boxShadow: isLast ? `0 0 0 2px #fff, 0 0 0 3px ${item.bgColor}` : "none",
              }} />
            );
          })}
          {feedbackInfo && (
            <span style={{
              fontSize: "10px", fontWeight: 600,
              color: feedbackInfo.status === "success" ? "#166534" : "#92400e",
              background: feedbackInfo.status === "success" ? "#dcfce7" : "#ffedd5",
              borderRadius: "999px", padding: "1px 7px",
            }}>
              {feedbackInfo.status === "success" ? "✓ Cargado" : "⚠ Revisar"}
            </span>
          )}
        </div>
      )}
      {/* 24h forward timeline: now → +24h with upcoming committed windows */}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", color: "#9ca3af", marginBottom: "2px" }}>
        <span>Ahora · {labelNow}</span>
        <span>+24h · {label24h}</span>
      </div>
      <div style={{ position: "relative", height: "10px", background: "#e5e7eb", borderRadius: "4px" }}>
        {stripes.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: "8px", color: "#9ca3af" }}>sin ventana comprometida próxima</span>
          </div>
        )}
        {stripes.map((s, i) => (
          <div key={i} title={`Rango comprometido: ${s.hora_inicio} – ${s.hora_fin}`} style={{
            position: "absolute", left: `${s.x1 * 100}%`, width: `${Math.max((s.x2 - s.x1) * 100, 0.8)}%`,
            top: 0, bottom: 0, background: "rgba(139,92,246,0.25)",
            borderLeft: "2px solid #8b5cf6", borderRight: "2px solid #8b5cf6",
          }} />
        ))}
      </div>
    </div>
  );
}

const STATUS_COLOR = {
  success: "#22c55e",
  warning: "#f59e0b",
  error: "#ef4444",
  error_formato: "#ef4444",
  sin_regla: "#ffffff",
  raw_only: "#0ea5e9",
  compromiso_vencido: "#8b5cf6",
};
const STATUS_BORDER_COLOR = {
  sin_regla: "#d1d5db",
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

export default function FilesTable({ onSelectFile, onViewHistory, selectedProjectId = null, selectedProjectName = null, currentUser = null }) {
  const [files, setFiles] = useState([]);
  // Tick every 30 s so time-based indicators (commitment alert, next-expected) stay current
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const [selectedMetadata, setSelectedMetadata] = useState(null);
  const [editingFile, setEditingFile] = useState(null);
  const [showLegend, setShowLegend] = useState(false);
  const [editForm, setEditForm] = useState({ process_name: "" });
  const [uploadingProcessId, setUploadingProcessId] = useState(null);
  const [uploadFeedback, setUploadFeedback] = useState({});  // { processId: "success" | "error" }
  const [editCommitmentSchedule, setEditCommitmentSchedule] = useState(EMPTY_SCHEDULE);

  const editProcessNameConflict = (() => {
    if (!editingFile) return false;
    const target = normalizeName(editForm.process_name);
    if (!target) return false;
    return files.some((f) =>
      f.id !== editingFile.id
      && f.project_id === editingFile.project_id
      && normalizeName(f.process_name || f.file_name) === target
    );
  })();

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
        title: "Sin ejecución",
        tooltip: "Sin ejecuciones registradas",
      };
    }
    // Use only the last execution
    const last = executions[executions.length - 1];
    const isError = last.status === "error" || last.status === "error_formato";
    const isWarning = last.status === "warning";
    const ts = fmtScl(last.timestamp);
    const by = last.uploaded_by || "user_x";
    if (isError || isWarning) {
      const errorSheets = Array.from(new Set([
        ...(Array.isArray(last.error_sheets) ? last.error_sheets.filter(Boolean) : []),
        ...(last.sheet_name && isError ? [last.sheet_name] : []),
      ]));
      return {
        status: last.status === "warning" ? "warning" : "error_formato",
        title: last.status === "warning" ? "Con errores" : "Error formato",
        tooltip: [
          `${by} · ${ts}`,
          `Estado: ${STATUS_LABEL[last.status] || last.status}`,
          errorSheets.length ? `Hojas: ${errorSheets.join(", ")}` : "",
        ].filter(Boolean).join("\n"),
      };
    }
    return {
      status: last.status || "success",
      title: STATUS_LABEL[last.status] || "OK",
      tooltip: [`${by} · ${ts}`, `Estado: ${STATUS_LABEL[last.status] || "Exitosa"}`].join("\n"),
    };
  };

  const loadFiles = async () => {
    try {
      const url = selectedProjectId
        ? `${API}/upload/?project_id=${encodeURIComponent(selectedProjectId)}`
        : `${API}/upload/`;

      const token = localStorage.getItem("authToken");
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(url, { headers });
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
      const res = await fetch(`${API}/upload/${fileId}`, {
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
      const token = localStorage.getItem("authToken");
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API}/upload/${processId}/instance`, {
        method: "POST",
        headers,
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
        <div style={{ marginLeft: "auto", position: "relative" }}>
          <button
            onClick={() => setShowLegend(v => !v)}
            title="Leyenda de semáforos"
            style={{ background: showLegend ? "#ede9fe" : "#f3f4f6", border: "1px solid", borderColor: showLegend ? "#8b5cf6" : "#d1d5db", borderRadius: "6px", padding: "3px 8px", cursor: "pointer", fontSize: "12px", color: showLegend ? "#6d28d9" : "#6b7280", display: "flex", alignItems: "center", gap: "4px", fontWeight: 500 }}
          >
            <span>⬤</span> Leyenda
          </button>
          {showLegend && (
            <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px", boxShadow: "0 4px 16px rgba(0,0,0,0.10)", padding: "14px 16px", zIndex: 100, minWidth: "230px", fontSize: "12px", color: "#374151" }}>
              <div style={{ fontWeight: 700, marginBottom: "10px", fontSize: "12px", color: "#111827", letterSpacing: "0.03em", textTransform: "uppercase" }}>Leyenda de semáforos</div>
              {[
                { dot: { bg: "#22c55e", border: "#22c55e" }, label: "Exitosa · en rango comprometido" },
                { dot: { bg: "#22c55e", border: "#8b5cf6" }, label: "Exitosa · fuera del rango comprometido", borderStyle: true },
                { dot: { bg: "#ef4444", border: "#ef4444" }, label: "Error / Error de formato · en rango" },
                { dot: { bg: "#ef4444", border: "#8b5cf6" }, label: "Error · fuera del rango comprometido", borderStyle: true },
                { dot: { bg: "#f59e0b", border: "#f59e0b" }, label: "Con errores · en rango comprometido" },
                { dot: { bg: "#8b5cf6", border: "#8b5cf6" }, label: "Sin carga en ventana comprometida" },
                { dot: { bg: "#d1d5db", border: "#d1d5db" }, label: "Sin regla configurada" },
              ].map(({ dot, label, borderStyle }, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "7px" }}>
                  <span style={{ width: "11px", height: "11px", borderRadius: "50%", background: dot.bg, border: `2px solid ${dot.border}`, flexShrink: 0, boxSizing: "border-box", ...(borderStyle ? { outline: "1.5px solid #8b5cf6", outlineOffset: "1px" } : {}) }} />
                  <span style={{ color: "#374151", lineHeight: 1.4 }}>{label}</span>
                </div>
              ))}
              <div style={{ borderTop: "1px solid #f3f4f6", marginTop: "6px", paddingTop: "7px", display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ width: "2px", height: "14px", background: "#c4b5fd", borderRadius: "1px", flexShrink: 0 }} />
                <span style={{ color: "#374151", lineHeight: 1.4 }}>Cambio de horario comprometido</span>
              </div>
            </div>
          )}
        </div>
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
                  <span>{new Date(file.timestamp).toLocaleDateString("es-ES", { timeZone: SCL_TZ, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
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

                {/* Execution history: timeline if commitment active, else simple dots */}
                {file.commitment_schedule?.activo ? (
                  <ProcessTimeline file={file} feedbackInfo={uploadFeedback[file.id]} />
                ) : (
                  (file.last_executions || []).length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: "5px", marginTop: "6px", flexWrap: "wrap" }}>
                      {(file.last_executions).map((exec, i) => {
                        const isLast = i === file.last_executions.length - 1;
                        const color = STATUS_COLOR[exec.status] || "#d1d5db";
                        const label = STATUS_LABEL[exec.status] || exec.status;
                        const uploadedBy = exec.uploaded_by || "user_x";
                        const ts = fmtScl(exec.timestamp);
                        const tooltipText = [`usuario: ${uploadedBy}`, `fecha_carga: ${ts || "sin fecha"}`, `status: ${label}`].join("\n");
                        return (
                          <span key={exec.id || i} title={tooltipText} style={{
                            display: "inline-block", width: isLast ? "11px" : "9px", height: isLast ? "11px" : "9px",
                            borderRadius: "50%", background: color, flexShrink: 0,
                            boxShadow: isLast ? `0 0 0 2px #fff, 0 0 0 3px ${color}` : "none",
                          }} />
                        );
                      })}
                      {uploadFeedback[file.id] && (
                        <span style={{
                          fontSize: "10px", fontWeight: 600,
                          color: uploadFeedback[file.id]?.status === "success" ? "#166534" : "#92400e",
                          background: uploadFeedback[file.id]?.status === "success" ? "#dcfce7" : "#ffedd5",
                          borderRadius: "999px", padding: "1px 7px",
                        }}>
                          {uploadFeedback[file.id]?.status === "success" ? "✓ Cargado" : "⚠ Revisar"}
                        </span>
                      )}
                    </div>
                  )
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

              <div style={{ display: "grid", gridTemplateRows: "auto auto", gap: "4px", flexShrink: 0, marginTop: "2px", justifyItems: "end", alignItems: "center" }}>
                {/* Row 1: main action buttons + delete */}
                <div style={{ display: "flex", gap: "4px", justifyContent: "flex-end", alignItems: "center", flexWrap: "nowrap" }}>
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
                  {currentUser?.role !== "responsable" && (
                    <button
                      onClick={() => onSelectFile(file)}
                      title="Regla"
                      style={btnStyle("#dbeafe", "#1d4ed8")}
                    >📋</button>
                  )}
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
                  {currentUser?.role !== "responsable" && (
                    <button
                      onClick={() => deleteFile(file.id, file.process_name || file.file_name)}
                      title="Eliminar"
                      style={btnStyle("#fee2e2", "#991b1b")}
                    >🗑</button>
                  )}
                </div>
                {/* Row 2: commitment info + edit */}
                {(file.commitment_schedule?.activo || currentUser?.role !== "responsable") && (
                  <div style={{ display: "flex", gap: "4px", justifyContent: "flex-end", alignItems: "center", flexWrap: "nowrap" }}>
                    {file.commitment_schedule?.activo && (
                      <button
                        title={scheduleTooltip(file.commitment_schedule)}
                        style={btnStyle("#ede9fe", "#7c3aed")}
                      >🕐</button>
                    )}
                    {file.commitment_schedule?.activo && (() => {
                      const nextLabel = getNextExpectedLabel(file.commitment_schedule);
                      return nextLabel ? (
                        <button
                          title={`Próximo archivo esperado ${nextLabel}`}
                          style={{ ...btnStyle("#f3f4f6", "#6b7280"), width: "auto", minWidth: "166px", maxWidth: "182px", padding: "0 8px", fontSize: "10px", fontWeight: 700, color: "#6b7280", display: "flex", alignItems: "center", justifyContent: "flex-start", gap: "3px", height: "28px" }}
                        >📅 <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nextLabel}</span></button>
                      ) : null;
                    })()}
                    {currentUser?.role !== "responsable" && (
                      <button
                        onClick={() => {
                          setEditingFile(file);
                          setEditForm({
                            process_name: file.process_name || file.file_name || "",
                            ...(file.metadata || {}),
                          });
                          setEditCommitmentSchedule(normalizeSchedule(file.commitment_schedule || EMPTY_SCHEDULE));
                        }}
                        title="Editar"
                        style={btnStyle("#fef9c3", "#92400e")}
                      >✏️</button>
                    )}
                  </div>
                )}
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
                  border: `1px solid ${editProcessNameConflict ? "#fca5a5" : "#e5e7eb"}`,
                  borderRadius: "8px",
                  fontSize: "12px",
                  background: "#ffffff",
                  color: "#111827",
                  boxSizing: "border-box",
                }}
              />
              {editProcessNameConflict && (
                <div style={{ fontSize: "10px", color: "#b91c1c", marginTop: "4px", fontWeight: 600 }}>
                  Ya existe un proceso con ese nombre en la misma carpeta.
                </div>
              )}
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

            {/* Compromiso de carga */}
            <div style={{ marginTop: "14px", border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: editCommitmentSchedule.activo ? "#faf5ff" : "#f9fafb", borderBottom: editCommitmentSchedule.activo ? "1px solid #e9d5ff" : "none", cursor: "pointer" }}
                onClick={() => setEditCommitmentSchedule(s => ({ ...s, activo: !s.activo }))}
              >
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "11px", fontWeight: 700, color: editCommitmentSchedule.activo ? "#7c3aed" : "#374151" }} onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={editCommitmentSchedule.activo} onChange={e => setEditCommitmentSchedule(s => ({ ...s, activo: e.target.checked }))} />
                  🕐 Compromiso de carga
                </label>
                <span style={{ fontSize: "10px", color: "#9ca3af" }}>Define cuándo se espera esta carga</span>
              </div>
              {editCommitmentSchedule.activo && (
                <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "10px", background: "#fdf4ff" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#6b7280", marginBottom: "4px" }}>Recurrencia</label>
                    <select
                      value={editCommitmentSchedule.tipo}
                      onChange={e => setEditCommitmentSchedule(s => ({ ...s, tipo: e.target.value, dias: [] }))}
                      style={{ width: "100%", padding: "7px 10px", border: "1px solid #e5e7eb", borderRadius: "8px", fontSize: "12px", background: "#fff" }}
                    >
                      <option value="diario">Diario (todos los días)</option>
                      <option value="semanal">Días específicos de la semana</option>
                    </select>
                  </div>
                  {editCommitmentSchedule.tipo !== "diario" && (
                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#6b7280", marginBottom: "6px" }}>Días</label>
                      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                        {[["lunes","Lun"],["martes","Mar"],["miercoles","Mié"],["jueves","Jue"],["viernes","Vie"],["sabado","Sáb"],["domingo","Dom"]].map(([val, label]) => {
                          const sel = editCommitmentSchedule.dias.includes(val);
                          return (
                            <label key={val} style={{ display: "flex", alignItems: "center", gap: "3px", padding: "4px 8px", borderRadius: "6px", border: `1px solid ${sel ? "#7c3aed" : "#d1d5db"}`, background: sel ? "#ede9fe" : "white", fontSize: "11px", fontWeight: 600, color: sel ? "#5b21b6" : "#374151", cursor: "pointer" }}>
                              <input type="checkbox" style={{ display: "none" }} checked={sel} onChange={() => setEditCommitmentSchedule(s => ({ ...s, dias: sel ? s.dias.filter(d => d !== val) : [...s.dias, val] }))} />
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
                      ranges={getScheduleRanges(editCommitmentSchedule)}
                      onChange={(nextRanges) => setEditCommitmentSchedule((s) => normalizeSchedule({ ...s, rangos: nextRanges }))}
                      addButtonLabel="+ Agregar nuevo rango"
                    />
                  </div>
                </div>
              )}
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
                disabled={editProcessNameConflict}
                title={editProcessNameConflict ? "Nombre de proceso duplicado en la carpeta" : ""}
                onClick={async () => {
                  if (editProcessNameConflict) return;
                  try {
                    const res = await fetch(`${API}/upload/${editingFile.id}`, {
                      method: "PUT",
                      headers: {
                        "Content-Type": "application/json"
                      },
                      body: JSON.stringify({
                        process_name: editForm.process_name,
                        metadata: Object.fromEntries(
                          Object.entries(editForm).filter(([key]) => key !== "process_name")
                        ),
                        commitment_schedule: editCommitmentSchedule.activo ? normalizeSchedule(editCommitmentSchedule) : null,
                      })
                    });

                    if (!res.ok) {
                      const body = await res.json().catch(() => ({}));
                      throw new Error(body?.detail || "No se pudo guardar el proceso");
                    }

                    setEditingFile(null);
                    loadFiles();
                  } catch (err) {
                    console.error(err);
                    alert(`Error al guardar metadata: ${err.message}`);
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