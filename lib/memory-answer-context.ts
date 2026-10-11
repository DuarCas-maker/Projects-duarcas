import { knowledgeText, recallMemory } from "./brain-provider";
import { meetingParts, meetingQueryPrefix } from "@/db/meeting-analysis";
import { combineMeetingParts } from "./meeting-analysis";
import { safeMemoryText, safeSourceText } from "./brain-content";
import { readMeeting } from "./meetings";
import { projectRepositorySources } from "./github-context";
import { asksForLatest, orderedProjectMeetings, readableMemoryText, boundedMemoryExcerpt, MAX_ANSWER_CONTEXT_CHARS, type MemoryAnswerMode, type MemoryAnswerSource } from "./memory-answer";
import type { Workspace } from "./workspace-types";

export async function memoryAnswerContext(userId:string,state:Workspace,projectId:string,query:string,mode:MemoryAnswerMode,requestId:string) {
  const latest=mode==="latest_meeting" || asksForLatest(query),meetings=orderedProjectMeetings(state,userId,projectId),latestDate=meetings[0]?.meeting.date??null;
  const policy=latest?"latest_meeting" as const:"relevance" as const;
  const sources:MemoryAnswerSource[]=[],warnings:string[]=[];
  let remaining=MAX_ANSWER_CONTEXT_CHARS;
  const add=(source:Omit<MemoryAnswerSource,"text"|"partial">,raw:string,budget:number,partial=false)=>{
    const clean=readableMemoryText(raw);if(!clean || remaining<300) return;
    const excerpt=boundedMemoryExcerpt(clean,query,Math.min(budget,remaining));remaining-=excerpt.text.length;
    sources.push({...source,...excerpt,partial:partial||excerpt.partial});
  };
  if(latest) {
    // No semantic search decides which meeting is latest. Equal-date meetings
    // are included together because the form does not record an exact time.
    const sameDay=meetings.filter(m=>m.meeting.date===latestDate),selected=sameDay.slice(0,3);
    if(!selected.length) return {policy,sources,warnings,latestDate,message:"No hay una reunión con fecha válida en este proyecto. Guarda una reunión para consultar qué se habló por última vez."};
    if(sameDay.length>1) warnings.push(`Hay ${sameDay.length} reuniones con la misma fecha más reciente; no se conoce su orden dentro del día.${sameDay.length>3?" Se consultaron las primeras 3 por identificador; abre las restantes para revisarlas.":""}`);
    const perMeeting=Math.floor(MAX_ANSWER_CONTEXT_CHARS/selected.length);
    for(const {item,meeting} of selected) {
      const base={knowledgeId:item.id,title:item.title,date:meeting.date};
      let analysis;
      try {analysis=combineMeetingParts(await meetingParts(userId,projectId,meetingQueryPrefix(item.id,meeting.fingerprint)));}
      catch {warnings.push(`No se pudo leer el análisis guardado de «${item.title}».`);}
      if(analysis?.status==="ready") {
        const text=analysis.summaries.map((summary,i)=>`Resumen del fragmento ${i+1}: ${summary}`).join("\n\n")+"\n\n"+analysis.findings.map(f=>`${f.kind}: ${f.title}. ${f.description}\nCita del original: ${f.quote}`).join("\n\n");
        add({...base,id:`analysis:${item.id}`,kind:"analysis"},text,perMeeting);
        warnings.push(`«${item.title}»: se usa el análisis guardado de sus ${analysis.completedParts} fragmentos, no una nueva lectura íntegra. Los hallazgos siguen sujetos a revisión y aprobación.`);
        continue;
      }
      try {
        // Reads and validates every original before selecting excerpts. Never
        // fetches Drive or follows links/instructions inside meeting documents.
        const original=safeSourceText(await knowledgeText(userId,item));
        const files=meeting.files.map(file=>({file,marker:`${file.role==="transcript"?"TRANSCRIPCIÓN COMPLETA":"NOTAS DE LA REUNIÓN"} · ${file.name}\n\n`})).map(entry=>({...entry,start:original.indexOf(entry.marker)}));
        if(files.some(f=>f.start<0)) throw Error("Missing document section");
        const ordered=[...files].sort((a,b)=>a.start-b.start);
        const texts=ordered.map((entry,i)=>({...entry,text:original.slice(entry.start+entry.marker.length,ordered[i+1]?.start??original.length)}));
        // Notes first for direct arguments, with a reserved transcript budget.
        const notes=texts.find(f=>f.file.role==="notes"),transcript=texts.find(f=>f.file.role==="transcript")!;
        if(notes) add({...base,id:`original:${item.id}:notes`,title:`${item.title} · notas`,kind:"original"},notes.text,Math.floor(perMeeting*.7));
        add({...base,id:`original:${item.id}:transcript`,title:`${item.title} · transcripción`,kind:"original"},transcript.text,Math.min(perMeeting-(sources.filter(s=>s.knowledgeId===item.id).reduce((n,s)=>n+s.text.length,0)),remaining));
        if(analysis?.status==="partial") warnings.push(`«${item.title}»: análisis incompleto (${analysis.completedParts}/${analysis.totalParts} fragmentos); esta respuesta usa documentos, no hallazgos finales.`);
      } catch {warnings.push(`Los documentos originales de «${item.title}» no están disponibles. No se sustituyeron por una reunión más antigua.`);}
    }
  } else {
    let memory;
    try {memory=await recallMemory(userId,[projectId],safeMemoryText(query),requestId,state);}
    catch {return {policy,sources,warnings,latestDate,message:"No se pudo consultar GBrain. Los originales se conservan; reintenta la pregunta o consulta la última reunión."};}
    if(memory.status!=="connected" || memory.warning) warnings.push(memory.warning??"GBrain no está configurado. Puedes consultar directamente la última reunión.");
    const activeRepos=new Set(projectRepositorySources(state,userId,projectId).map(r=>r.item.id));
    const hits=memory.hits.flatMap(hit=>{
      const item=state.knowledge.find(k=>k.id===hit.knowledgeId && k.projectId===projectId && k.userId===userId);
      if(!item || hit.projectId!==projectId || (item.itemType==="repository" && !activeRepos.has(item.id))) return [];
      const date=item.itemType==="meeting"?readMeeting(item)?.date??null:item.occurredAt.slice(0,10);
      return [{hit,item,date}];
    }).sort((a,b)=>(b.date??"").localeCompare(a.date??"")||b.hit.score-a.hit.score);
    for(const {hit,item,date} of hits) add({id:hit.id,knowledgeId:item.id,title:item.title,date,kind:"memory"},safeSourceText(hit.text),1800,true);
  }
  if(sources.some(s=>s.partial)) warnings.push("Cobertura parcial: se usaron extractos, no todos los documentos. Para una reunión extensa, completa «Analizar y proponer tareas» y vuelve a preguntar.");
  return {policy,sources,warnings,latestDate,message:sources.length?undefined:latest?"La última reunión está identificada, pero no tiene contenido legible disponible. No se respondió con reuniones antiguas.":"No hay coincidencias útiles en las fuentes indexadas de este proyecto. Procesa una fuente en GBrain o consulta la última reunión."};
}
