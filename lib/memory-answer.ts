import { readMeeting } from "./meetings";
import type { Workspace } from "./workspace-types";

export type MemoryAnswerMode = "auto" | "latest_meeting";
export type MemoryAnswerSource = { id:string; knowledgeId:string; title:string; date:string|null; kind:"original"|"analysis"|"memory"; text:string; partial:boolean };
export type MemoryCitation = { sourceId:string; quote:string };
export type MemoryClaim = { text:string; citations:MemoryCitation[] };
export type MemoryAnswerResult = { answer:MemoryClaim; points:(MemoryClaim & { kind:"topic"|"agreement"|"pending" })[] };
export type MemoryAnswerRecord = {
  id:string; query:string; policy:"latest_meeting"|"relevance"; result:MemoryAnswerResult|null;
  sources:MemoryAnswerSource[]; warnings:string[]; latestDate:string|null; message?:string;
};
export const MAX_ANSWER_CONTEXT_CHARS = 16000;
export function asksForLatest(query:string) {
  const text=query.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  return /\b(ultim[oa]s?|mas reciente[s]?|recientemente|lo reciente)\b/.test(text);
}
export function orderedProjectMeetings(state:Workspace,userId:string,projectId:string) {
  return state.knowledge.filter(k=>k.userId===userId && k.projectId===projectId && k.itemType==="meeting")
    .flatMap(item=>{const meeting=readMeeting(item);return meeting && Number.isFinite(Date.parse(`${meeting.date}T12:00:00Z`)) && new Date(`${meeting.date}T12:00:00Z`).toISOString().slice(0,10)===meeting.date?[{item,meeting}]:[];})
    .sort((a,b)=>b.meeting.date.localeCompare(a.meeting.date)||a.item.id.localeCompare(b.item.id));
}
// Strip presentation syntax and known generated footers, not meeting content.
// The originals and the existing GBrain index are never rewritten.
export function readableMemoryText(text:string) {
  return text.replace(/\r\n?/g,"\n").split("\n").filter(line=>!/(revisa las notas de gemini|como es la calidad de|cómo es la calidad de|google\.qualtrics\.com|support\.google\.com\/meet\/answer\/14754931|obt[eé]n sugerencias y descubre c[oó]mo gemini|fragmento \d+ de \d+\. conserva la referencia)/i.test(line))
    .join("\n").replace(/\[([^\]\n]+)\]\([^\n)]*\)/g,"$1").replace(/\\([\\*_#`~\[\]()!.:>-])/g,"$1").replace(/^\s*#{1,6}\s+/gm,"").replace(/\*\*|__|`/g,"").replace(/\n{3,}/g,"\n\n").trim();
}
export function boundedMemoryExcerpt(text:string,query:string,budget:number) {
  if(text.length<=budget) return {text,partial:false};
  // Complete windows drawn from across the original, with query matches first.
  // Uniform fallback avoids spending the entire budget on transcript greetings.
  const width=1200,windows:Array<{index:number;text:string;score:number}>=[];
  const words=[...new Set(query.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().match(/[a-z0-9]{4,}/g)??[])].filter(w=>!["ultimo","ultima","proyecto","reunion","reciente","hablo","dijo","cual","cuales","esto","esta","fueron"].includes(w));
  for(let start=0;start<text.length;start+=width) {
    const value=text.slice(start,start+width),normalized=value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
    windows.push({index:windows.length,text:value,score:words.reduce((n,w)=>n+(normalized.includes(w)?1:0),0)});
  }
  const count=Math.max(1,Math.floor(budget/(width+40))),selected=new Map<number,typeof windows[number]>();
  for(const row of [...windows].filter(w=>w.score>0).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,count)) selected.set(row.index,row);
  for(let i=0;i<count && selected.size<count;i++){const row=windows[Math.floor(i*(windows.length-1)/Math.max(1,count-1))];selected.set(row.index,row);}
  return {text:[...selected.values()].sort((a,b)=>a.index-b.index).map(w=>w.text).join("\n\n[Otro extracto del mismo documento]\n\n").slice(0,budget),partial:true};
}
export function validateMemoryAnswer(value:unknown,sources:MemoryAnswerSource[]):MemoryAnswerResult {
  const fail=():never=>{throw new Error("La respuesta no contiene citas verificables. Reintenta la pregunta; no se modificó el proyecto.");};
  const row=value as MemoryAnswerResult;
  const normalize=(v:string)=>v.normalize("NFC").replace(/\s+/g," ").trim();
  const claim=(v:MemoryClaim,max:number)=>v && typeof v.text==="string" && v.text.trim().length>0 && v.text.length<=max && Array.isArray(v.citations) && v.citations.length>=1 && v.citations.length<=4 && v.citations.every(c=>{
    const source=sources.find(s=>s.id===c?.sourceId);
    return source && typeof c.quote==="string" && c.quote.trim().length>=12 && c.quote.length<=350 && normalize(source.text).includes(normalize(c.quote));
  });
  if(!row || !claim(row.answer,1200) || !Array.isArray(row.points) || row.points.length>6 || !row.points.every(p=>["topic","agreement","pending"].includes(p?.kind) && claim(p,700))) return fail();
  return row;
}
