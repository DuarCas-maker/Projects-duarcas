import type { Workspace } from "./workspace-types";
import { projectUpdateSignature } from "./project-update";
import { contentHash } from "./brain-content";
export async function contextRevision(state:Workspace,projectIds:string[]) {
  return contentHash(JSON.stringify({version:1,projects:[...projectIds].sort().map(id=>projectUpdateSignature(state,id,"")),inbox:state.inbox.filter(i=>i.detectedProjectId && projectIds.includes(i.detectedProjectId))}));
}
