"use client";
import type { MemoryAnswerRecord, MemoryClaim } from "@/lib/memory-answer";

const labels={topic:"Tema",agreement:"Acuerdo",pending:"Pendiente"};
export function MemoryAnswerView({record}:{record:MemoryAnswerRecord}) {
  const evidence=(claim:MemoryClaim)=><details className="memory-answer-evidence"><summary>Ver evidencia ({claim.citations.length})</summary>{claim.citations.map((citation,index)=>{const source=record.sources.find(s=>s.id===citation.sourceId);return <figure key={`${citation.sourceId}-${index}`}><blockquote>{citation.quote}</blockquote><figcaption>{source?.title} · {source?.date??"Sin fecha"}{source?.kind==="analysis"?" · análisis guardado":source?.partial?" · extracto":""}</figcaption></figure>;})}</details>;
  return <div className="memory-answer" aria-live="polite">
    <div className="memory-answer-heading"><strong>Respuesta del proyecto</strong><small>{record.policy==="latest_meeting"?`Última reunión · ${record.latestDate??"sin fecha"}`:"Fuentes relevantes · más recientes primero"}{record.sources.some(s=>s.partial)?" · lectura parcial":""}</small></div>
    {record.result?<><p className="memory-answer-direct">{record.result.answer.text}</p>{evidence(record.result.answer)}
      {!!record.result.points.length&&<ol className="memory-answer-points">{record.result.points.map((point,index)=><li key={index}><span className="memory-answer-kind">{labels[point.kind]}</span><p>{point.text}</p>{evidence(point)}</li>)}</ol>}
    </>:<p>{record.message}</p>}
    {record.warnings.map((warning,index)=><p className="memory-answer-warning" key={index}>{warning}</p>)}
    {!!record.sources.length&&<details className="memory-answer-sources"><summary>Fuentes utilizadas ({record.sources.length})</summary><ul>{record.sources.map(source=><li key={source.id}>{source.title} · {source.date??"Sin fecha"}</li>)}</ul></details>}
  </div>;
}
