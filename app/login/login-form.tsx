"use client";
import { useEffect, useState } from "react";
import { LockKeyhole } from "lucide-react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").then(registration => registration.update()).catch(() => {});
    let active = true;
    fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refresh" }) })
      .then(response => { if (response.ok && active) window.location.replace("/"); }).catch(() => {});
    return () => { active = false; };
  }, []);
  return <main className="login-screen"><section className="login-card"><div className="login-brand"><span>OS</span><LockKeyhole size={24} /></div><p className="eyebrow">PROJECT OS · ESPACIO PRIVADO</p><h1>Bienvenido de nuevo.</h1><p>Accede con tu correo y contraseña de Supabase. No necesitas iniciar sesión con ChatGPT.</p><form onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "login", email, password }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "No fue posible iniciar sesión.");
      setPassword(""); window.location.replace("/");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible conectar."); } finally { setBusy(false); }
  }}><label>Correo<input type="email" name="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label><label>Contraseña<input type="password" name="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} /></label>{error && <p role="alert" className="login-error">{error}</p>}<button type="submit" disabled={busy}>{busy ? "Ingresando…" : "Iniciar sesión"}</button></form><small>Solo la cuenta autorizada puede acceder. No hay registro público.</small></section></main>;
}
