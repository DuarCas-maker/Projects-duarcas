"use client";

import { useEffect, useState } from "react";
import { GitBranch, Code2 as Github, Link2, RefreshCw, ExternalLink, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { projectRepositorySources } from "@/lib/github-context";
import type { Workspace } from "@/lib/workspace-types";
import type { GithubConnection } from "@/lib/github-app";

export async function fetchGithubContext(projectId: string, repositoryId?: string) {
  const query = new URLSearchParams({projectId,context:"1",...(repositoryId ? {repositoryId} : {})});
  const response = await fetch(`/api/repositories?${query}`,{cache:"no-store"});
  const body = await response.json() as {text:string;error?:string;omitted:number;records:{id:string}[]};
  if (!response.ok) throw new Error(body.error || "No se pudo cargar el contexto de GitHub.");
  return body;
}
export function RepositoryPanel({state,projectId,acceptState}: {state:Workspace;projectId:string;acceptState:(state:Workspace)=>void}) {
  const project = state.projects.find(p=>p.id === projectId)!;
  const linked = state.repositories.filter(r=>r.projectId === projectId && r.userId === project.userId && r.provider === "github");
  const sources = projectRepositorySources(state,project.userId,projectId);
  const [url,setUrl] = useState(""), [branch,setBranch] = useState("");
  const [busy,setBusy] = useState(""), [error,setError] = useState(""), [preview,setPreview] = useState<{title:string;text:string}|null>(null);
  const [connection,setConnection] = useState<GithubConnection|null>(null), [connectionError,setConnectionError] = useState(""), [checking,setChecking] = useState(true);
  useEffect(()=>{
    const controller = new AbortController();
    void checkConnection(controller.signal);
    return ()=>controller.abort();
  },[]);
  async function checkConnection(signal?: AbortSignal) {
    setChecking(true);setConnectionError("");
    try {
      const response = await fetch("/api/github",{cache:"no-store",signal});
      const result = await response.json() as GithubConnection & {error?:string};
      if (!response.ok) throw new Error(result.error || "No se pudo comprobar GitHub.");
      if (!signal?.aborted) setConnection(result);
    } catch (failure) {
      if (!signal?.aborted) {setConnection(null);setConnectionError(failure instanceof Error ? failure.message : "No se pudo comprobar GitHub.");}
    } finally { if (!signal?.aborted) setChecking(false); }
  }
  async function mutate(action: "link"|"sync", repositoryId?: string) {
    setBusy(repositoryId ?? "link"); setError("");
    try {
      const response = await fetch("/api/repositories",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,projectId,...(action === "link" ? {url,branch} : {repositoryId})})});
      const result = await response.json() as {state?:Workspace;error?:string;unchanged?:boolean;indexPending?:boolean};
      if (!response.ok || !result.state) throw new Error(result.error || "No se pudo guardar el repositorio.");
      acceptState(result.state);
      if (action === "link") { setUrl("");setBranch("");toast.success("Repositorio vinculado a este proyecto. Ahora puedes sincronizarlo."); }
      else toast.success(result.unchanged ? "El commit no cambió; el contexto sigue vigente." : "Contexto de GitHub sincronizado, sin modificar el repositorio.");
      if (result.indexPending) toast.warning("El contexto se guardó. Prepara la fuente en búsqueda global para completar su índice.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo conectar."); }
    finally { setBusy(""); }
  }
  async function view(repositoryId: string, title: string) {
    setBusy(repositoryId);setError("");
    try { const result = await fetchGithubContext(projectId,repositoryId);setPreview({title,text:result.text}); }
    catch (failure) {setError(failure instanceof Error ? failure.message : "No se pudo cargar.");} finally {setBusy("");}
  }
  return <section className="panel repository-panel">
    <div className="section-title"><div><p className="eyebrow">GITHUB · SOLO LECTURA</p><h2>Repositorios de {project.name}</h2></div><span>{linked.length}/10 vinculados</span></div>
    <p className="repository-note">Cada repositorio aporta contexto únicamente a este proyecto. Lee repositorios públicos y los privados que autorices en GitHub, con permisos de solo lectura.</p>
    <div className="github-connection" aria-busy={checking}>
      <div className="github-connection-heading"><Github size={20}/><div><strong>{checking ? "Comprobando GitHub…" : connection?.installations.length ? "GitHub conectado" : "Conectar repositorios privados"}</strong>
        <p className="repository-note">{connection?.installations.length ? `${connection.installations.map(i=>i.account).join(", ")} · ${connection.repositories.length} repositorios autorizados` : connection?.configured ? `Instala la App en ${connection.accounts.join(", ")} y elige los repositorios que puede leer.` : "La conexión privada necesita configurar la GitHub App en el servidor."}</p></div></div>
      <div className="repository-actions">
        {connection?.installUrl && connection.installations.length < connection.accounts.length && <a className="github-connect-link" href={connection.installUrl} target="_blank" rel="noopener noreferrer"><Github size={16}/>{connection.installations.length ? "Conectar otra cuenta autorizada" : "Conectar GitHub"}<ExternalLink size={14}/></a>}
        {connection?.installations.map(i=><a className="github-connect-link" key={i.account} href={i.manageUrl} target="_blank" rel="noopener noreferrer">Autorizar repositorios · {i.account}<ExternalLink size={14}/></a>)}
        <Button type="button" variant="outline" size="sm" disabled={checking || !!busy} onClick={()=>void checkConnection()}><RefreshCw size={15}/>{checking ? "Comprobando…" : "Actualizar conexión"}</Button>
      </div>
      {connectionError && <p className="repository-error" role="alert">{connectionError}</p>}
      {connection?.configured && <p className="repository-note">Después de autorizar en GitHub, vuelve aquí y pulsa Actualizar conexión. Selecciona un repositorio para vincularlo a este proyecto.</p>}
      {!!connection?.repositories.length && <label className="github-repository-picker">Repositorio autorizado<select aria-label="Seleccionar repositorio autorizado de GitHub" value={connection.repositories.some(r=>r.url === url) ? url : ""} disabled={!!busy || checking || linked.length >= 10} onChange={event=>{setUrl(event.target.value);setBranch("");}}>
        <option value="">Selecciona un repositorio…</option>
        {connection.repositories.map(r=><option key={r.fullName} value={r.url}>{r.fullName} · {r.private ? "Privado" : "Público"}</option>)}
      </select></label>}
      {connection?.partial && <p className="repository-note">La lista es parcial. Puedes vincular otro repositorio autorizado mediante su URL.</p>}
    </div>
    <form className="repository-link-form" onSubmit={event=>{event.preventDefault();void mutate("link");}}>
      <label>URL del repositorio<Input aria-label="URL del repositorio de GitHub" type="url" required maxLength={250} placeholder="https://github.com/propietario/repositorio" value={url} onChange={event=>setUrl(event.target.value)} disabled={!!busy}/></label>
      <label>Rama (opcional)<Input aria-label="Rama del repositorio" maxLength={100} placeholder="Predeterminada de GitHub" value={branch} onChange={event=>setBranch(event.target.value)} disabled={!!busy}/></label>
      <Button type="submit" disabled={!!busy || linked.length >= 10}><Link2 size={16}/>{busy === "link" ? "Vinculando…" : "Vincular repositorio"}</Button>
    </form>
    {error && <p className="repository-error" role="alert">{error}</p>}
    {!linked.length && <p className="repository-note">Este proyecto todavía no tiene repositorios vinculados.</p>}
    <div className="repository-list">{linked.map(repository=>{
      const saved = sources.find(source=>source.repository.id === repository.id);
      return <article className="repository-card" key={repository.id}>
        <div className="repository-card-heading"><GitBranch size={20}/><div><strong>{repository.owner}/{repository.repo}</strong><small>Rama: {repository.defaultBranch} · {saved ? "Contexto guardado" : "Pendiente de sincronizar"}</small></div><a href={`https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${repository.owner}/${repository.repo} en GitHub`}><ExternalLink size={17}/></a></div>
        {saved && <><p><a href={saved.source.url} target="_blank" rel="noopener noreferrer">Commit {saved.source.sha.slice(0,7)}</a> · {saved.source.included} archivos completos · {saved.source.omitted} archivos elegibles sin leer</p><small>Última comprobación: {repository.lastSync ? new Date(repository.lastSync).toLocaleString("es-CO",{timeZone:"America/Bogota"}) : "Sin registro"}. Cobertura parcial{saved.source.treeTruncated ? "; árbol limitado por GitHub" : ""}.</small><details><summary>Archivos incluidos</summary><ul>{saved.source.files.map(path=><li key={path}>{path}</li>)}</ul></details></>}
        <div className="repository-actions"><Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={()=>void mutate("sync",repository.id)}><RefreshCw size={15}/>{busy === repository.id ? "Procesando…" : "Sincronizar"}</Button>{saved && <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={()=>void view(repository.id,`${repository.owner}/${repository.repo}`)}><FileText size={15}/>Ver contexto guardado</Button>}</div>
      </article>;
    })}</div>
    <small className="repository-note">No se leen conversaciones de Codex ni cambios locales. No se ejecutan archivos ni consultas de IA al sincronizar. Un commit no confirma que una tarea esté terminada.</small>
    <Dialog open={!!preview} onOpenChange={open=>{if(!open)setPreview(null);}}><DialogContent className="repository-preview"><DialogHeader><DialogTitle>{preview?.title}</DialogTitle><DialogDescription>Copia de solo lectura del proyecto seleccionado, identificada por commit. No contiene todos los archivos del repositorio.</DialogDescription></DialogHeader><pre>{preview?.text}</pre></DialogContent></Dialog>
  </section>;
}
