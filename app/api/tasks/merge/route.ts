import { currentWorkspaceId, WorkspaceConfigurationError } from "@/lib/workspace-context";
import { getWorkspaceState } from "@/db/workspace";
import { findAiRun,reserveAiRun,finishAiRun,failAiRun,AiError } from "@/db/ai-history";
import { persistCorePlan } from "@/db/core-mutations";
import { CoreValidationError } from "@/lib/core-commands";
import { SupabaseConflictError } from "@/db/supabase";
import { mergeTasks,mergeSnapshot,validateMergeDraft,buildTaskMerge } from "@/lib/task-merge";
import { operationsFor,detailFor } from "@/lib/project-operations";
import { requestTaskMerge } from "@/lib/task-merge-provider";
import { BrainError } from "@/lib/gbrain-client";
export const dynamic="force-dynamic";
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
export async function POST(request:Request) {
  let reserved:{userId:string;id:string}|undefined;
  try {
    const userId=await currentWorkspaceId(request),input=await request.text();
    if(input.length>64000) throw new AiError("Entrada demasiado grande.",413);
    const body=JSON.parse(input) as Record<string,unknown>;
    if(!body||typeof body.projectId!=="string"||typeof body.requestId!=="string"||!/^[a-zA-Z0-9_-]{1,80}$/.test(body.requestId)) throw new AiError("Solicitud de fusión no válida.",400);
    const state=await getWorkspaceState(userId),projectId=body.projectId,id=body.requestId;
    if(body.action==="apply") {
      const run=await findAiRun(userId,id);
      if(!run||run.kind!=="task_merge"||run.scope!==projectId||run.status!=="completed") throw new AiError("Propuesta de fusión no encontrada.",404);
      const eventId=`merge-${id}`;
      if(state.events.some(e=>e.id===eventId)) return json({state,replayed:true});
      const stored=JSON.parse(run.result) as {ids:string[];snapshot:string};
      const plan=buildTaskMerge(state,userId,projectId,stored.ids,body.draft,stored.snapshot,eventId);
      return json(await persistCorePlan(userId,plan));
    }
    if(body.action!=="generate") throw new AiError("Acción no válida.",400);
    const tasks=mergeTasks(state,userId,projectId,body.ids),snapshot=mergeSnapshot(state,projectId),query=JSON.stringify({ids:tasks.map(t=>t.id)});
    const existing=await findAiRun(userId,id);
    if(existing) {
      if(existing.kind!=="task_merge"||existing.scope!==projectId||existing.query!==query) throw new AiError("Esta operación pertenece a otra selección.",409);
      if(existing.status!=="completed") throw new AiError("La consulta anterior está en curso o falló. Reintenta con una operación nueva.",409);
      const stored=JSON.parse(existing.result);if(stored.snapshot!==snapshot)throw new AiError("Las tareas cambiaron. Genera una propuesta nueva.",409);return json({draft:stored.draft,requestId:id});
    }
    await reserveAiRun(userId,id,projectId,"task_merge",query);reserved={userId,id};
    const ops=operationsFor(state,projectId);
    const output=await requestTaskMerge(JSON.stringify({project:state.projects.find(p=>p.id===projectId)?.name,people:ops.people.filter(p=>p.active).map(({id,name,role})=>({id,name,role})),tasks:tasks.map(t=>({...t,assignment:detailFor(ops,t.id)})),dependencies:state.dependencies.filter(e=>tasks.some(t=>t.id===e.taskId||t.id===e.dependsOnTaskId))}));
    const draft=validateMergeDraft(output.result,tasks,state);
    await finishAiRun(userId,id,{draft,ids:tasks.map(t=>t.id),snapshot},output.usage?.input_tokens,output.usage?.output_tokens);reserved=undefined;
    return json({draft,requestId:id});
  }catch(error) {
    if(reserved)await failAiRun(reserved.userId,reserved.id).catch(()=>undefined);
    if(error instanceof AiError||error instanceof CoreValidationError||error instanceof WorkspaceConfigurationError||error instanceof BrainError)return json({error:error.message},error.status);
    if(error instanceof SupabaseConflictError)return json({error:error.message},409);
    if(error instanceof SyntaxError)return json({error:"Entrada JSON no válida."},400);
    console.error("task_merge_failed",error instanceof Error?error.name:"unknown");return json({error:"No se pudo preparar o aplicar la fusión. Las tareas se conservan."},503);
  }
}
