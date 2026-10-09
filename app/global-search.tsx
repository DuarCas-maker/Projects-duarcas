"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Workspace } from "@/lib/workspace-types";
import { searchRecords, type GlobalSearchResponse, type SearchResult } from "@/lib/global-search";

export function GlobalSearch({state,open}:{state:Workspace;open:(result:SearchResult)=>void}) {
  const [query,setQuery]=useState(""),[focused,setFocused]=useState(false),[page,setPage]=useState(1),[data,setData]=useState<GlobalSearchResponse|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[indexing,setIndexing]=useState(false),[progress,setProgress]=useState("");
  const stop=useRef(false),sequence=useRef(0),latestQuery=useRef(query);latestQuery.current=query;
  const immediate=useMemo(()=>searchRecords(state,query).slice(0,20),[state,query]);
  const read=async(text:string,requestedPage=1)=>{
    const response=await fetch(`/api/search?q=${encodeURIComponent(text)}&page=${requestedPage}`,{cache:"no-store"}),body=await response.json() as GlobalSearchResponse & {error?:string};if(!response.ok)throw new Error(body.error||"No se pudo buscar.");return body;
  };
  useEffect(()=>{
    const current=++sequence.current;setData(null);setError("");setPage(1);
    if(!query.trim()){setBusy(false);return;}
    setBusy(true);const timer=setTimeout(()=>{void read(query).then(result=>{if(sequence.current===current)setData(result);}).catch(e=>{if(sequence.current===current)setError(e.message);}).finally(()=>{if(sequence.current===current)setBusy(false);});},300);
    return()=>{clearTimeout(timer);sequence.current++;};
  },[query,state]);
  useEffect(()=>()=>{stop.current=true;},[]);
  const prepare=async(retry=false)=>{
    if(indexing||!data)return;setIndexing(true);stop.current=false;setError("");
    const sources=retry ? data.coverage.unavailable : data.coverage.pending;
    try {
      for(let index=0;index<sources.length && !stop.current;index++) {
        setProgress(`${index+1}/${sources.length} · ${sources[index].title}`);
        const response=await fetch("/api/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({knowledgeId:sources[index].id,retry})}),result=await response.json() as {error?:string};
        if(!response.ok)throw new Error(result.error||"No se pudo preparar esta fuente.");
      }
      if(!stop.current)setProgress("Documentos revisados. El índice conserva todo el texto extraído.");
    }catch(e){setError(e instanceof Error?e.message:"No se pudo preparar la búsqueda.");}
    finally{if(!stop.current || latestQuery.current.trim())await read(latestQuery.current).then(result=>{setData(result);setPage(1);}).catch(e=>setError(e.message));setIndexing(false);}
  };
  const changePage=async(next:number)=>{setBusy(true);try{const result=await read(query,next);setData(result);setPage(result.page);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const results=data?.results??immediate,visible=focused && !!query.trim();
  return <div className="global-search content-search"><Search size={17}/><input aria-label="Buscar en proyectos y contenido" value={query} maxLength={160} onFocus={()=>setFocused(true)} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Escape"){setFocused(false);stop.current=true;}}} placeholder="Buscar también dentro de documentos…"/>{query && <button aria-label="Cerrar búsqueda" onClick={()=>{stop.current=true;setQuery("");setProgress("");}}><X size={15}/></button>}
    {visible && <><button className="search-dismiss" aria-label="Cerrar resultados" onClick={()=>setFocused(false)}/><div className="search-results content-search-results" aria-label="Resultados de búsqueda">
      <div className="search-status" role="status">{busy ? "Buscando en registros y contenido…" : `${data?.total??results.length} coincidencias${data && data.pages>1 ? ` · página ${page}/${data.pages}` : ""}`}</div>
      {results.map(result=><button className="search-result" key={`${result.type}:${result.id}`} onClick={()=>{open(result);setFocused(false);setQuery("");}}><span>{result.type} · {result.detail}</span><strong>{result.label}</strong><small>{result.excerpt}</small></button>)}
      {!results.length && !busy && <p className="search-status">No hay coincidencias en los registros o el texto preparado. Busca una frase sin distinguir mayúsculas ni tildes.</p>}
      {data && <div className="search-index-status"><small>Contenido completo preparado: {data.coverage.ready}/{data.coverage.total} fuentes. No usa IA ni abre Drive.</small>
        {data.coverage.pending.length>0 && <Button size="sm" variant="outline" disabled={indexing} onClick={()=>void prepare()}>Preparar {data.coverage.pending.length} fuentes pendientes</Button>}
        {indexing && <><p role="status">{progress}</p><Button size="sm" variant="outline" onClick={()=>{stop.current=true;setProgress("Pausa solicitada; el archivo actual terminará. El avance se conserva.");}}>Pausar</Button></>}
        {!indexing && progress && <p role="status">{progress}</p>}
        {data.coverage.unavailable.length>0 && <details><summary>{data.coverage.unavailable.length} fuentes sin texto disponible</summary>{data.coverage.unavailable.map(item=><p key={item.id}><strong>{item.title}</strong> · {item.error}</p>)}<Button size="sm" variant="outline" disabled={indexing} onClick={()=>void prepare(true)}>Reintentar estas fuentes</Button></details>}
      </div>}
      {error && <p className="core-form-error" role="alert">{error}</p>}
      {data && data.pages>1 && <div className="search-pagination"><Button size="sm" variant="outline" disabled={busy||indexing||page<=1} onClick={()=>void changePage(page-1)}>Anterior</Button><Button size="sm" variant="outline" disabled={busy||indexing||page>=data.pages} onClick={()=>void changePage(page+1)}>Siguiente</Button></div>}
    </div></>}
  </div>;
}
