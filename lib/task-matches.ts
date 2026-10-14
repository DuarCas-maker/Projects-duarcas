import type { Workspace, Task } from "./workspace-types";
import { isMergedTask } from "./task-structure";
import { detailFor,operationsFor } from "./project-operations";

const ignored=new Set("de del la el los las un una para por con y o a en al se que sobre final finales ajustes tarea proyecto definir enviar coordinar organizar preparar realizar reunion reuniones".split(" "));
export function taskTokens(text:string) {
  return new Set(text.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLocaleLowerCase("es").replace(/disenador(?:a|es|as)?/g,"diseno").replace(/fotografos?|fotografas?/g,"fotografia").split(/[^\p{L}\p{N}]+/gu).map(w=>w.length>4&&w.endsWith("s")?w.slice(0,-1):w).filter(w=>w.length>2&&!ignored.has(w)));
}
export function possibleTaskMatch(left:{title:string;description?:string},right:{title:string;description?:string}) {
  const a=taskTokens(left.title),b=taskTokens(right.title);
  const shared=[...a].filter(w=>b.has(w)).length;
  if(left.title.trim().toLocaleLowerCase("es")===right.title.trim().toLocaleLowerCase("es"))return true;
  const action=(title:string)=>/enviar|compartir|remitir|entregar/i.test(title)?"deliver":/coordinar|organizar|agendar|convocar/i.test(title)&&/reuni[oó]n/i.test(title)?"meeting":/definir|establecer|acordar/i.test(title)?"define":"";
  if(shared===1&&Math.min(a.size,b.size)<=2&&action(left.title)&&action(left.title)===action(right.title))return true;
  return shared>=2 && shared/Math.min(a.size||1,b.size||1)>=0.5;
}
export function proposalTaskData(suggestion:Workspace["suggestions"][number]):Record<string,unknown>|null {
  try {
    const stored=JSON.parse(suggestion.payload);
    if(stored.source==="notebook") {
      if(!["create_task","update_task"].includes(stored.proposal?.action))return null;
      const data=Object.fromEntries(stored.proposal.changes.map((c:{field:string;value:unknown})=>[c.field,c.value]));
      if(data.criteria) data.description=`${data.description??""}\n\nCriterios de finalización: ${data.criteria}`;
      return {...data,title:data.title??suggestion.title,matchedTaskIds:stored.matchedTaskIds??[],targetId:stored.proposal.targetId};
    }
    return stored.action==="create_task"?{...stored.data,title:stored.data?.title??suggestion.title,matchedTaskIds:stored.matchedTaskIds??[]}:null;
  }catch{return null;}
}
export function proposalMatches(state:Workspace,suggestion:Workspace["suggestions"][number]) {
  const data=proposalTaskData(suggestion);if(!data)return {tasks:[] as Task[],proposals:[] as Workspace["suggestions"]};
  const explicit=Array.isArray(data.matchedTaskIds)?data.matchedTaskIds:[];
  const input={title:String(data.title),description:String(data.description??"")};
  return {
    tasks:state.tasks.filter(t=>t.projectId===suggestion.projectId&&!isMergedTask(t)&&t.status!=="cancelled"&&data.parentTaskId!==t.id&&data.parentProposalTitle!==t.title&&(explicit.includes(t.id)||possibleTaskMatch(input,t))),
    proposals:state.suggestions.filter(s=>s.id!==suggestion.id&&s.status==="pending"&&s.projectId===suggestion.projectId&&proposalTaskData(s)&&data.parentProposalTitle!==s.title&&proposalTaskData(s)?.parentProposalTitle!==data.title&&(explicit.includes(s.id)||possibleTaskMatch(input,{title:s.title}))),
  };
}
export function taskComparisonContext(state:Workspace,projectId:string) {
  const data=operationsFor(state,projectId);
  return state.tasks.filter(t=>t.projectId===projectId&&!isMergedTask(t)&&t.status!=="cancelled").slice(0,150).map(t=>({id:t.id,title:t.title,description:t.description,status:t.status,deadline:t.deadline,parentTaskId:t.parentTaskId,assignment:detailFor(data,t.id)}));
}
