import { env } from 'cloudflare:workers';
import { exportAuxiliary as snapshot } from '@/runtime/export-auxiliary.mjs';
export async function exportAuxiliary(workspaceId: string) {
  return snapshot(env.DB,env,workspaceId);
}
