"use client";
import { useEffect, useRef, useState } from "react";
import { BrainCircuit, CheckCircle2, FileText, Search, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Workspace } from "@/lib/workspace-types";
import type { BrainStatus, BrainMemory } from "@/lib/brain-types";

export function BrainMemoryPanel({state,projectId,acceptState}: {state:Workspace;projectId:string;acceptState:(state:Workspace)=>void}) {
  const [status,setStatus] = useState<BrainStatus|null>(null), [error,setError] = useState(""), [busy,setBusy] = useState("");
  const [title,setTitle] = useState(""), [content,setContent] = useState(""), [query,setQuery] = useState(""), [search,setSearch] = useState<BrainMemory|null>(null);
  const operations = useRef(new Map<string,{fingerprint:string;id:string}>());
  const generation = useRef(0), stop = useRef(false);
  const [progress,setProgress] = useState("");
  const sources = state.knowledge.filter((item) => item.projectId === projectId), signature = sources.map((item) => `${item.id}:${item.processingStatus}`).join(",");
  const refresh = async (signal?:AbortSignal) => {
    const response = await fetch(`/api/brain?projectId=${encodeURIComponent(projectId)}`,{cache:"no-store",signal});
    const data = await response.json() as BrainStatus;
    if (!response.ok) throw new Error(data.error || "No se pudo consultar la memoria."); setStatus(data);
  };
  useEffect(() => { const controller = new AbortController(); setStatus(null); setSearch(null); setError(""); setTitle(""); setContent(""); setQuery(""); operations.current.clear(); void refresh(controller.signal).catch((failure) => { if (!controller.signal.aborted) setError(failure.message); }); return () => {controller.abort();generation.current++;stop.current=true;}; },[projectId]);
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal).catch((failure) => { if (!controller.signal.aborted) setError(failure.message); }); return () => controller.abort(); },[signature]);
  const perform = async (action:string,payload:Record<string,unknown>,key:string) => {
    if (busy) return; setBusy(key); setError(""); setProgress(""); stop.current = false;
    const activeGeneration = generation.current, fingerprint = JSON.stringify({projectId,action,...payload});
    try {
      do {
      const old = operations.current.get(key), requestId = old?.fingerprint === fingerprint ? old.id : crypto.randomUUID(); operations.current.set(key,{fingerprint,id:requestId});
      const response = await fetch("/api/brain",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,projectId,...payload,requestId})});
      const data = await response.json() as Omit<BrainMemory,"status"> & {error?:string;state?:Workspace;status:BrainMemory["status"]|"pending"|"ready";processedParts?:number;totalParts?:number};
      if (generation.current !== activeGeneration) return;
      if (data.state) acceptState(data.state);
      if (!response.ok) throw new Error(data.error || "No se pudo completar la operación.");
      if (action === "search") {
        if (!["connected","not_configured","unavailable"].includes(data.status) || !Array.isArray(data.hits)) throw new Error("La búsqueda no devolvió resultados válidos.");
        setSearch({status:data.status as BrainMemory["status"],hits:data.hits,warning:data.warning});
      }
      if (action === "create_note") { setTitle(""); setContent(""); operations.current.delete(key); }
      await refresh();
      if (action !== "process" || data.status !== "pending") break;
      operations.current.delete(key);
      setProgress(`Fragmentos guardados: ${data.processedParts}/${data.totalParts}. El próximo se enviará en unos segundos para respetar el límite compartido.`);
      // This is the continuation of the user's manual click, not a background
      // ingestion job. Leaving the view or pausing stops subsequent writes.
      for (let second=0;second<21 && !stop.current && generation.current===activeGeneration;second++) await new Promise(resolve => setTimeout(resolve,1000));
      } while (!stop.current && generation.current===activeGeneration);
      if (stop.current && generation.current===activeGeneration) setProgress("Procesamiento pausado. El avance está guardado; pulsa Continuar para terminar.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "La memoria no está disponible."); await refresh().catch(() => undefined); }
    finally { if (generation.current===activeGeneration) setBusy(""); }
  };
  const enabled = !!status?.configured && !!status.enabled;
  return <section className="panel brain-panel" aria-label="Memoria GBrain">
    <div className="brain-heading"><span className="brain-symbol"><BrainCircuit size={23}/></span><div><span className="eyebrow">MEMORIA CONECTADA</span><h3>GBrain · contexto del proyecto</h3><p>{!status ? "Comprobando conexión…" : !enabled ? "GBrain no está configurado o está desactivado." : status.connected ? `Conectado · ${status.used}/${status.limit} operaciones hoy (compartidas)` : "GBrain no está disponible. Los originales están a salvo."}</p></div></div>
    <p className="daily-hint">Solo se procesa lo que tú envíes. Originales en Project OS; texto y búsqueda en GBrain. No incluyas claves ni contraseñas. La aplicación sigue siendo pública.</p>
    <div className="brain-tools">
      <form className="brain-note" onSubmit={(event) => {event.preventDefault();void perform("create_note",{title,content},"note");}}>
        <h4><Plus size={16}/> Guardar una nota en memoria</h4>
        <Input aria-label="Título de la nota de memoria" placeholder="Ej. Decisión de la reunión" maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} disabled={!!busy}/>
        <Textarea aria-label="Texto de la nota de memoria" placeholder="Escribe una decisión, contexto o conocimiento que quieras recordar…" maxLength={16000} value={content} onChange={(event) => setContent(event.target.value)} disabled={!!busy}/>
        <Button type="submit" disabled={!!busy || !enabled || !title.trim() || !content.trim()}>{busy === "note" ? "Guardando y procesando…" : "Guardar en memoria"}</Button>
      </form>
      <div className="brain-search"><h4><Search size={16}/> Buscar en la memoria</h4>
        <form onSubmit={(event) => {event.preventDefault();void perform("search",{query},"search");}}><Input aria-label="Buscar en la memoria del proyecto" placeholder="Busca una decisión o tema…" maxLength={1000} value={query} onChange={(event) => setQuery(event.target.value)} disabled={!!busy}/><Button type="submit" variant="outline" disabled={!!busy || !enabled || !query.trim()}>{busy === "search" ? "Buscando…" : "Buscar"}</Button></form>
        <small>Hasta 10 resultados y 4.000 tokens. Solo devuelve fuentes vinculadas a este proyecto.</small>
        {search && <div className="brain-results" aria-live="polite">{search.hits.length ? search.hits.map((hit) => <article key={hit.id}><strong>{hit.title}</strong><p>{hit.text}</p><small>{hit.sourceReference}</small></article>) : <p>No hay coincidencias en las fuentes indexadas de este proyecto. Prueba otro tema o procesa una fuente.</p>}</div>}
      </div>
    </div>
    <h4 className="brain-sources-title">Fuentes del proyecto</h4>
    <div className="brain-source-list">{sources.length ? sources.map((item) => { const link = status?.links.find((entry) => entry.knowledgeId === item.id), ready = link?.status === "ready"; return <article key={item.id}><FileText size={18}/><div><strong>{item.title}</strong><small>{ready ? "Indexado en GBrain" : link?.error || (link?.status === "pending" ? "Procesamiento pendiente" : "Original guardado · pendiente de procesar")}</small></div><Button variant="outline" size="sm" disabled={!!busy || !enabled || ready} onClick={() => void perform("process",{knowledgeId:item.id},item.id)}>{ready ? <><CheckCircle2 size={14}/> Indexado</> : busy === item.id ? "Procesando…" : link?.status === "pending" ? "Continuar" : link ? "Reintentar" : "Procesar"}</Button></article>; }) : <p className="daily-hint">Todavía no hay fuentes. Guarda una nota o sube un archivo con el botón de arriba.</p>}</div>
    <small className="daily-hint">PDF con texto y Word .docx: hasta 10 MB y 40 KB de texto extraído; PDF hasta 100 páginas. TXT, Markdown, CSV y JSON UTF-8: hasta 48 KB. Los PDF escaneados necesitan OCR; convierte Word .doc a .docx. Siempre se conserva el original.</small>
    <small className="daily-hint">Reuniones: hasta 512 KiB de texto, dividido en un máximo de 16 fragmentos. Cada fragmento cuenta como una operación compartida; el enlace de Drive se guarda como referencia, sin analizar el video.</small>
    {progress && <p role="status" className="daily-hint">{progress}</p>}
    {busy && <p role="status" className="daily-hint">La operación está en curso; no cierres esta vista. {busy !== "note" && busy !== "search" && <Button variant="outline" size="sm" onClick={() => {stop.current=true;setProgress("Se detendrá después del fragmento en curso. El avance se conserva.");}}>Pausar</Button>}</p>}
    {error && <p className="core-form-error" role="alert">{error}</p>}
  </section>;
}
