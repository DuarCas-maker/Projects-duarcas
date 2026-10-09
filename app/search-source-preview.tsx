"use client";
import { useEffect,useRef,useState } from "react";
import { Button } from "@/components/ui/button";
import type { SearchResult } from "@/lib/global-search";
export function SearchSourcePreview({source}:{source:SearchResult}) {
  const [content,setContent]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),generation=useRef(0);
  const load=async()=>{const current=++generation.current,response=await fetch(`/api/search?sourceId=${encodeURIComponent(source.knowledgeId!)}`,{cache:"no-store"}),data=await response.json() as {content:string;error?:string};if(current!==generation.current)return;if(!response.ok)throw new Error(data.error||"No se pudo leer la fuente.");setContent(data.content);};
  useEffect(()=>{setContent("");setError("");void load().catch(e=>setError(e.message));return()=>{generation.current++;};},[source.knowledgeId]);
  const prepare=async()=>{setBusy(true);setError("");try{const response=await fetch("/api/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({knowledgeId:source.knowledgeId,retry:true})}),data=await response.json() as {status:string;error?:string};if(!response.ok || data.status!=="ready")throw new Error(data.error||"No se pudo preparar esta fuente.");await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <section className="panel search-source-preview"><p className="eyebrow">FUENTE ENCONTRADA</p><h2>{source.label}</h2><p className="daily-hint">Coincidencia: {source.excerpt}</p>{content && <details open><summary>Texto completo extraído · solo lectura</summary><pre tabIndex={0}>{content}</pre></details>}{error && <><p className="core-form-error" role="alert">{error}</p><Button size="sm" variant="outline" disabled={busy} onClick={()=>void prepare()}>{busy ? "Preparando…" : "Preparar texto de esta fuente"}</Button></>}</section>;
}
