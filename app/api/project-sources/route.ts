import { currentWorkspaceId, WorkspaceConfigurationError } from "@/lib/workspace-context";
import { getWorkspaceState } from "@/db/workspace";
import { projectSourceInventory, prepareProjectSources } from "@/db/project-sources";
import { BrainError, boundedText } from "@/lib/gbrain-client";

export const dynamic="force-dynamic";
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
function failure(error:unknown){if(error instanceof BrainError||error instanceof WorkspaceConfigurationError)return json({error:error.message},error.status);if(error instanceof SyntaxError)return json({error:"Entrada no válida."},400);return json({error:"No se pudo consultar el catálogo de fuentes."},503);}
async function scoped(userId:string,projectId:unknown){
  const state=await getWorkspaceState(userId);
  if(projectId!==undefined && (typeof projectId!=="string"||!state.projects.some(p=>p.id===projectId&&p.userId===userId)))throw new BrainError("Proyecto no encontrado.",404);
  return {state,ids:state.projects.filter(p=>p.userId===userId&&(!projectId||p.id===projectId)).map(p=>p.id)};
}
export async function GET(request:Request){try{const userId=await currentWorkspaceId(),params=new URL(request.url).searchParams,c=await scoped(userId,params.get("projectId")??undefined);return json(await projectSourceInventory(userId,c.state,c.ids));}catch(e){return failure(e);}}
export async function POST(request:Request){try{const userId=await currentWorkspaceId(request),body=JSON.parse(await boundedText(new Response(request.body),1000));if(!body||typeof body!=="object"||Array.isArray(body))throw new BrainError("Entrada no válida.",400);const c=await scoped(userId,body.projectId);return json(await prepareProjectSources(userId,c.state,c.ids,body.retry===true));}catch(e){return failure(e);}}
