"use client";
import { useEffect, useRef, useState } from "react";
import { Bot, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AiRecord, AiResult } from "@/lib/ai-types";
import type { Workspace } from "@/lib/workspace-types";
import { ProjectSources,SourceCoverageView } from "./project-sources";

export async function aiRequest(body: Record<string, unknown>) {
  const response = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json() as { id: string; response: AiResult; state: Workspace; error?: string; sources?:AiRecord["sources"]; memory?:AiRecord["memory"];sourceCoverage?:AiRecord["sourceCoverage"];contextRevision?:string }; if (!response.ok) throw new Error(data.error || "No se pudo completar la consulta."); return data;
}
function sourceLabel(state: Workspace, id: string) {
  const item = [...state.projects, ...state.tasks, ...state.events, ...state.milestones, ...state.knowledge, ...state.inbox, ...state.financials].find((row) => row.id === id) as { title?: string; name?: string; content?: string; projectId?: string } | undefined;
  return item?.title ?? item?.name ?? item?.content?.slice(0, 100) ?? (item?.projectId ? `Pago · ${state.projects.find((row) => row.id === item.projectId)?.name ?? item.projectId}` : id);
}
export function AiAnswer({ result, state, sources }: { result: AiResult; state: Workspace; sources?:Record<string,string> }) {
  const evidence = (ids: string[]) => <small className="ai-sources">Evidencia: {ids.map((id) => sources?.[id] ?? sourceLabel(state, id)).join(" · ")}</small>;
  return <div className="ai-answer"><p>{result.answer}</p>{[["Hechos registrados", result.facts], ["Inferencias de la IA", result.inferences]].map(([label, claims]) => (claims as AiResult["facts"]).length > 0 && <section key={label as string}><h4>{label as string}</h4>{(claims as AiResult["facts"]).map((claim, index) => <div key={index}><p>{claim.text}</p>{evidence(claim.sourceIds)}</div>)}</section>)}{result.suggestions.length > 0 && <section><h4>Sugerencias · requieren aprobación</h4>{result.suggestions.map((item, index) => <div key={index}><strong>{item.title}</strong><p>{item.reason}</p>{evidence(item.evidenceIds)}<small>{item.estimatedMinutes} min · prioridad {item.priority}/5 · {state.projects.find((row) => row.id === item.projectId)?.name}</small></div>)}</section>}</div>;
}
export function AiPanel({ state, projectId, acceptState }: { state: Workspace; projectId?: string; acceptState: (state: Workspace) => void }) {
  const [history, setHistory] = useState<AiRecord[]>([]), [query, setQuery] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [config, setConfig] = useState<{ configured: boolean; enabled: boolean; used: number; limit: number; model: string } | null>(null);
  const [saved, setSaved] = useState<string[]>([]); const latestQuery = useRef(""), requestId = useRef(crypto.randomUUID());
  const [since,setSince]=useState("");
  const [catalogRefresh,setCatalogRefresh]=useState(0);
  const stateSignature=JSON.stringify([state.knowledge,state.repositories,state.tasks,state.events,state.projects]);
  const refresh = async () => {
    const response = await fetch(`/api/ai${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`, { cache: "no-store" });
    const data = await response.json() as { configured: boolean; enabled: boolean; used: number; limit: number; model: string; history: AiRecord[]; error?: string }; if (!response.ok) throw new Error(data.error); setConfig(data); setHistory(data.history);
  };
  useEffect(() => { void refresh().catch((failure) => setError(failure.message)); }, [projectId,stateSignature]);
  const ask = async () => {
    if (!query.trim() || busy) return; setBusy(true); setError("");
    const text = query.trim(),identity=JSON.stringify([text,since]); if (identity !== latestQuery.current) { latestQuery.current = identity; requestId.current = crypto.randomUUID(); }
    try {
      const data = await aiRequest({ kind: "chat", query: text, since, projectId, requestId: requestId.current });
      setHistory((current) => [...current.filter((item) => item.id !== data.id), { id: data.id, query: text, result: data.response, sources:data.sources, memory:data.memory,sourceCoverage:data.sourceCoverage,contextRevision:data.contextRevision,createdAt: new Date().toISOString(), kind: "chat" }]);
      setQuery(""); latestQuery.current = ""; requestId.current = crypto.randomUUID(); setCatalogRefresh(value=>value+1);await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "La IA no está disponible."); }
    finally { setBusy(false); }
  };
  const propose = async (runId: string) => {
    if (busy) return; setBusy(true); setError("");
    try { const data = await aiRequest({ kind: "save_suggestions", runId }); acceptState(data.state); setSaved((rows) => [...rows, runId]); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "No se guardaron las propuestas."); }
    finally { setBusy(false); }
  };
  return <section className="panel chat-panel"><div className="chat-head"><span><Bot size={19} /></span><div><strong>{projectId ? `IA · ${state.projects.find((item) => item.id === projectId)?.name}` : "Project OS Intelligence"}</strong><small>{config ? `${config.configured ? config.enabled ? "IA conectada" : "Pendiente de autorización de contexto" : "Sin conexión de IA"} · ${config.used}/${config.limit} consultas hoy (compartidas)` : "Comprobando conexión…"}</small></div></div><ProjectSources state={state} projectId={projectId} refreshKey={catalogRefresh} onPrepared={()=>void refresh().catch(e=>setError(e.message))}/><div className="ai-news-controls"><Button variant="outline" size="sm" disabled={busy} onClick={()=>setQuery("¿Qué hay de nuevo del proyecto?")}>¿Qué hay de nuevo?</Button><label>Novedades desde <Input type="date" aria-label="Fecha inicial de novedades" value={since} onChange={e=>setSince(e.target.value)} disabled={busy}/></label><small>Sin fecha: compara con la última consulta de este chat.</small></div><div className="messages ai-messages">{!history.length && <div className="ai-welcome"><Sparkles size={20} /><p>Consulta el estado, las prioridades o los riesgos de tus proyectos. La IA utiliza tus registros y cita su evidencia.</p><div className="ai-starters">{["¿Qué debería hacer primero hoy?", "¿Qué proyectos están bloqueados?", "Propón próximos pasos concretos"].map((text) => <Button key={text} variant="outline" size="sm" onClick={() => setQuery(text)}>{text}</Button>)}</div></div>}{history.map((item) => <article key={item.id} className="ai-exchange"><div className="user"><p>{item.query}</p></div>{item.memory?.warning && <p className="core-form-error" role="status">{item.memory.warning}</p>}{item.stale&&<p className="update-warning" role="status">Los datos del proyecto cambiaron desde esta respuesta. Vuelve a preguntar para consultar las fuentes vigentes.</p>}{item.memory?.status === "connected" && <small className="ai-sources">{item.memory.provider==="local"?"Índice del proyecto":"Recuperación de fuentes"}: {item.memory.count} fuentes con contenido</small>}{item.sourceCoverage&&<SourceCoverageView coverage={item.sourceCoverage}/>}<AiAnswer result={item.result} state={state} sources={item.sources} />{item.result.suggestions.length > 0 && <Button size="sm" variant="outline" disabled={busy || saved.includes(item.id) || state.suggestions.some((row) => row.id === item.id)} onClick={() => void propose(item.id)}>{saved.includes(item.id) || state.suggestions.some((row) => row.id === item.id) ? "Propuestas guardadas" : "Enviar propuestas a aprobaciones"}</Button>}</article>)}</div>{error && <p className="core-form-error" role="alert">{error} <button onClick={() => { latestQuery.current = ""; requestId.current = crypto.randomUUID(); setError(""); }}>Preparar nueva consulta</button></p>}{busy && <p role="status" className="daily-hint">Consultando o guardando…</p>}<form className="chat-input" onSubmit={(event) => { event.preventDefault(); void ask(); }}><Input aria-label="Pregunta a la IA" maxLength={1500} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pregunta por estado, riesgos o próximos pasos…" disabled={busy} /><Button size="icon" type="submit" disabled={busy || !config?.configured || !config.enabled || !query.trim() || config.used >= config.limit} aria-label="Enviar pregunta"><Send size={16} /></Button></form><small className="daily-hint">Nada se ejecuta desde el chat. Historial compartido · la IA puede equivocarse.</small></section>;
}
