import { exportAuxiliary } from '@/db/auxiliary-export';
import { currentWorkspaceId, WorkspaceConfigurationError } from '@/lib/workspace-context';
import { TransferError } from '@/runtime/transfer-contract.mjs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const snapshot = await exportAuxiliary(await currentWorkspaceId(request));
    return new Response(JSON.stringify(snapshot), {headers:{
      'Content-Type':'application/json; charset=utf-8',
      'Content-Disposition':`attachment; filename="project-os-history-${snapshot.payload.exportedAt.slice(0,10)}.json"`,
      'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
    }});
  } catch (error) {
    if (error instanceof WorkspaceConfigurationError || error instanceof TransferError) return Response.json({error:error.message},{status:error.status});
    console.error('auxiliary_export_failed'); // Never log private backup contents.
    return Response.json({error:'No se pudo preparar la copia. No se modificó ningún dato.'},{status:500});
  }
}
