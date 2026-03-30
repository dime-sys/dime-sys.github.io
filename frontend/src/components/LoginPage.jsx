import { useState } from "react";
import { login, checkIdentifier } from "../services/api";
import DimeLogo from "./DimeLogo";

function LoginPage({ onLogin }) {
  // step: "identifier" → "password" (existing user) | "register" (new email) | "pending" (awaiting approval)
  const [step, setStep] = useState("identifier");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isEmail = (v) => { const p = v.split("@"); return p.length === 2 && p[1].includes("."); };

  const goBack = () => { setStep("identifier"); setPassword(""); setError(""); };

  const handleCheckIdentifier = async (e) => {
    e.preventDefault();
    if (!identifier.trim()) { setError("Ingresa tu usuario o correo"); return; }
    setError("");
    if (!isEmail(identifier.trim())) { setStep("password"); return; }
    setLoading(true);
    try {
      const data = await checkIdentifier(identifier.trim());
      if (data.status === "pending") setStep("pending");
      else if (data.status === "new") setStep("register");
      else setStep("password");
    } catch { setStep("password"); }
    finally { setLoading(false); }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!password.trim()) { setError("Ingresa tu contraseña"); return; }
    setLoading(true); setError("");
    try {
      const data = await login(identifier.trim(), password);
      localStorage.setItem("authToken", data.token);
      onLogin(data.user);
    } catch (err) {
      setError(err.response?.data?.detail || "Credenciales inválidas");
    } finally { setLoading(false); }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!password.trim()) { setError("Ingresa una contraseña"); return; }
    if (password.length < 4) { setError("La contraseña debe tener al menos 4 caracteres"); return; }
    setLoading(true); setError("");
    try {
      const data = await login(identifier.trim(), password);
      if (data.status === "pending_approval") { setStep("pending"); }
      else { localStorage.setItem("authToken", data.token); onLogin(data.user); }
    } catch (err) {
      setError(err.response?.data?.detail || "Error al registrar");
    } finally { setLoading(false); }
  };

  const inputStyle = {
    width: "100%", padding: "9px 12px", border: "1px solid #d1d5db",
    borderRadius: "8px", fontSize: "13px", outline: "none",
    boxSizing: "border-box", transition: "border-color 0.15s",
  };
  const focusInput = (e) => (e.target.style.borderColor = "#3b82f6");
  const blurInput  = (e) => (e.target.style.borderColor = "#d1d5db");

  const PrimaryBtn = ({ children, bg = "#1d4ed8", disabledBg = "#93c5fd", ...props }) => (
    <button
      {...props}
      style={{
        padding: "10px 16px", background: loading ? disabledBg : bg,
        color: "white", border: "none", borderRadius: "8px",
        fontSize: "14px", fontWeight: 600, width: "100%",
        cursor: loading ? "not-allowed" : "pointer", marginTop: "4px",
      }}
    >
      {children}
    </button>
  );

  const ErrorBox = () => error ? (
    <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", padding: "9px 12px", fontSize: "12px", color: "#991b1b" }}>⚠ {error}</div>
  ) : null;

  const IdentifierChip = () => (
    <div style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "8px 12px", fontSize: "13px", color: "#374151", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span>{isEmail(identifier) ? "📧" : "👤"} {identifier}</span>
      <button type="button" onClick={goBack} style={{ background: "none", border: "none", color: "#6b7280", fontSize: "12px", cursor: "pointer", padding: 0 }}>← Cambiar</button>
    </div>
  );

  const subtitles = { identifier: "Inicia sesión para continuar", password: "Ingresa tu contraseña", register: "Crea tu contraseña de acceso", pending: "Solicitud enviada" };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #f0f4ff 0%, #e8f5e9 100%)" }}>
      <div style={{ background: "white", borderRadius: "16px", padding: "40px 36px", width: "100%", maxWidth: "380px", boxShadow: "0 4px 24px rgba(0,0,0,0.10)", border: "1px solid #e5e7eb" }}>

        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "10px" }}>📊</div>
          <h2 style={{ margin: "0 0 6px" }}><DimeLogo size="1.9rem" /></h2>
          <p style={{ margin: "0 0 4px", fontSize: "11px", color: "#9ca3af", letterSpacing: "0.04em" }}>Data Intake Management Ecosystem</p>
          <p style={{ margin: 0, fontSize: "13px", color: "#6b7280" }}>{subtitles[step]}</p>
        </div>

        {/* STEP 1: identifier */}
        {step === "identifier" && (
          <form onSubmit={handleCheckIdentifier} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#374151", marginBottom: "5px" }}>Usuario o correo</label>
              <input type="text" autoComplete="username" value={identifier}
                onChange={(e) => { setIdentifier(e.target.value); setError(""); }}
                placeholder="usuario o correo@empresa.cl" style={inputStyle}
                onFocus={focusInput} onBlur={blurInput} autoFocus />
            </div>
            <ErrorBox />
            <PrimaryBtn type="submit" disabled={loading}>{loading ? "⏳ Verificando..." : "Continuar →"}</PrimaryBtn>
          </form>
        )}

        {/* STEP 2a: password (existing user) */}
        {step === "password" && (
          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <IdentifierChip />
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#374151", marginBottom: "5px" }}>Contraseña</label>
              <input type="password" autoComplete="current-password" value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                placeholder="Contraseña" style={inputStyle}
                onFocus={focusInput} onBlur={blurInput} autoFocus />
            </div>
            <ErrorBox />
            <PrimaryBtn type="submit" disabled={loading}>{loading ? "⏳ Iniciando sesión..." : "Iniciar sesión"}</PrimaryBtn>
          </form>
        )}

        {/* STEP 2b: register (new email, first time) */}
        {step === "register" && (
          <form onSubmit={handleRegister} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <IdentifierChip />
            <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "8px", padding: "9px 12px", fontSize: "12px", color: "#1e40af" }}>
              ℹ Este correo no está registrado. Crea una contraseña para solicitar acceso — un administrador te asignará un rol.
            </div>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#374151", marginBottom: "5px" }}>Crear contraseña</label>
              <input type="password" autoComplete="new-password" value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                placeholder="Mínimo 4 caracteres" style={inputStyle}
                onFocus={focusInput} onBlur={blurInput} autoFocus />
            </div>
            <ErrorBox />
            <PrimaryBtn type="submit" disabled={loading} bg="#16a34a" disabledBg="#86efac">
              {loading ? "⏳ Enviando solicitud..." : "Crear cuenta y solicitar acceso"}
            </PrimaryBtn>
          </form>
        )}

        {/* STEP 3: pending approval */}
        {step === "pending" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <IdentifierChip />
            <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "8px", padding: "16px 12px", fontSize: "13px", color: "#92400e", lineHeight: "1.6", textAlign: "center" }}>
              <div style={{ fontSize: "2rem", marginBottom: "8px" }}>⏳</div>
              <strong>Solicitud pendiente de aprobación</strong><br />
              Un administrador revisará tu solicitud y te asignará un rol. Vuelve a intentar ingresar una vez que seas aprobado.
            </div>
            <button onClick={() => { setStep("identifier"); setIdentifier(""); setPassword(""); setError(""); }}
              style={{ padding: "10px 16px", background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb", borderRadius: "8px", fontSize: "13px", cursor: "pointer", width: "100%" }}>
              ← Volver al inicio
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

export default LoginPage;
