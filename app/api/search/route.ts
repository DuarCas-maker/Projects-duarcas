import { activeKnowledge } from "@/lib/task-attachments";
import { currentWorkspaceId, WorkspaceConfigurationError } from "@/lib/workspace-context";
import { getWorkspaceState } from "@/db/workspace";
import { searchIndex,indexKnowledge,readIndexedSource } from "@/db/knowledge-search";
import { searchRecords,mergeSearchResults } from "@/lib/global-search";
import { BrainError } from "@/lib/gbrain-client";

export const dynamic="force-dynamic";
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
function failure(error:unknown){
  if(error instanceof BrainError)return json({error:error.message},error.status);
  if(error instanceof SyntaxError)return json({error:"Entrada JSON no válida."},400);
  if(error instanceof WorkspaceConfigurationError)return json({error:error.message},error.status);
  console.error("global_search_failed",error instanceof Error ? error.name : "unknown");return json({error:"No se pudo consultar el índice de contenido. Tus originales se conservan."},503);
}
export async function GET(request:Request){
  try {
    const params=new URL(request.url).searchParams,query=params.get("q")??"",page=Number(params.get("page")??1);
    if(query.length>160 || !Number.isSafeInteger(page) || page<1)throw new BrainError("Busca una frase de hasta 160 caracteres.",400);
    const userId=await currentWorkspaceId(),state=await getWorkspaceState(userId);
    if(params.has("sourceId")){
      const item=activeKnowledge(state).find(k=>k.id===params.get("sourceId") && k.userId===userId && state.projects.some(p=>p.id===k.projectId && p.userId===userId));
      if(!item)throw new BrainError("Fuente no encontrada.",404);
      return json(await readIndexedSource(userId,item));
    }
    const index=await searchIndex(userId,state,query);
    return json({...mergeSearchResults(searchRecords(state,query),index.matches,page),coverage:index.coverage});
  }catch(error){return failure(error);}
}
export async function POST(request:Request){
  try {
    const userId=await currentWorkspaceId(request);
    const input=await request.text();if(input.length>1000)throw new BrainError("Entrada demasiado grande.",413);
    const body=JSON.parse(input) as {knowledgeId?:unknown;retry?:boolean};if(!body||typeof body!=="object"||typeof body.knowledgeId!=="string")throw new BrainError("Selecciona una fuente.",400);
    const state=await getWorkspaceState(userId),item=activeKnowledge(state).find(k=>k.id===body.knowledgeId && k.userId===userId && state.projects.some(p=>p.id===k.projectId && p.userId===userId));
    if(!item)throw new BrainError("Fuente no encontrada.",404);
    return json(await indexKnowledge(userId,item,body.retry===true));
  }catch(error){return failure(error);}
}
