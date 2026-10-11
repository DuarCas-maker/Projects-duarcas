import { currentWorkspaceId, WorkspaceConfigurationError } from "@/lib/workspace-context";
import { getWorkspaceState } from "@/db/workspace";
import { AiError, aiConfig, findAiRun, reserveAiRun, finishAiRun, failAiRun } from "@/db/ai-history";
import { BrainError, boundedText } from "@/lib/gbrain-client";
import { safeMemoryText } from "@/lib/brain-content";
import { memoryAnswerContext } from "@/lib/memory-answer-context";
import { requestMemoryAnswer } from "@/lib/memory-answer-provider";
import { validateMemoryAnswer, type MemoryAnswerRecord } from "@/lib/memory-answer";

export const dynamic="force-dynamic";
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
export async function POST(request:Request) {
  let reserved:{userId:string;id:string}|undefined;
  try {
    const userId=await currentWorkspaceId(request),body=JSON.parse(await boundedText(new Response(request.body),5000)) as Record<string,unknown>;
    if(!body || Array.isArray(body) || typeof body!=="object" || typeof body.query!=="string" || !body.query.trim() || body.query.length>1000 || !["auto","latest_meeting"].includes(String(body.mode))) throw new AiError("Escribe una pregunta de hasta 1.000 caracteres y selecciona su alcance.",400);
    if(typeof body.requestId!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId)) throw new AiError("Identificador de pregunta no válido.",400);
    const state=await getWorkspaceState(userId),project=state.projects.find(p=>p.id===body.projectId && p.userId===userId);
    if(!project) throw new AiError("Proyecto no encontrado.",404);
    const query=safeMemoryText(body.query),operation=JSON.stringify({query,mode:body.mode}),existing=await findAiRun(userId,body.requestId);
    if(existing) {
      if(existing.scope!==project.id || existing.kind!=="memory_answer" || existing.query!==operation) throw new AiError("Esta operación pertenece a otra pregunta.",409);
      if(existing.status==="completed") return json({...JSON.parse(existing.result),replayed:true});
      throw new AiError(existing.status==="pending"?"La respuesta sigue en curso. Espera antes de reintentar.":"La consulta anterior falló. Vuelve a preguntar para iniciar un intento nuevo.",409);
    }
    const config=aiConfig();if(!config.configured || !config.enabled) throw new AiError("Activa la IA y autoriza el envío del contexto antes de consultar respuestas resumidas.");
    const context=await memoryAnswerContext(userId,state,project.id,query,body.mode as "auto"|"latest_meeting",body.requestId);
    if(!context.sources.length) return json({id:body.requestId,query,...context,result:null} satisfies MemoryAnswerRecord);
    await reserveAiRun(userId,body.requestId,project.id,"memory_answer",operation);reserved={userId,id:body.requestId};
    const output=await requestMemoryAnswer(query,context);
    let result;try{result=validateMemoryAnswer(output.result,context.sources);}catch{throw new AiError("La respuesta no contiene citas verificables. Reintenta la pregunta; no se modificó el proyecto.",502);}
    const record:MemoryAnswerRecord={id:body.requestId,query,policy:context.policy,result,sources:context.sources,warnings:context.warnings,latestDate:context.latestDate};
    await finishAiRun(userId,body.requestId,record,output.usage?.input_tokens,output.usage?.output_tokens);reserved=undefined;
    return json(record);
  } catch(error) {
    if(reserved) await failAiRun(reserved.userId,reserved.id).catch(()=>undefined);
    if(error instanceof AiError || error instanceof BrainError || error instanceof WorkspaceConfigurationError) return json({error:error.message},error.status);
    if(error instanceof SyntaxError) return json({error:"Entrada JSON no válida."},400);
    console.error("memory_answer_failed",error instanceof Error?error.name:"unknown");
    return json({error:"No se pudo responder con la memoria. Los originales se conservan y no se aplicó ningún cambio."},503);
  }
}
