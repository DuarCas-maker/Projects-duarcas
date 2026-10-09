import { AuthError, authOperation, requireOwner } from "@/lib/supabase-auth";
export const dynamic = "force-dynamic";
const options = { headers: { "Cache-Control": "private, no-store" } };
function failure(error: unknown) {
  return Response.json({ error: error instanceof AuthError ? error.message : "No fue posible autenticar." }, { ...options, status: error instanceof AuthError ? error.status : 500 });
}
export async function GET() {
  try { return Response.json({ user: await requireOwner() }, options); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try { return Response.json({ user: await authOperation(request) }, options); } catch (error) { return failure(error); }
}
