import { ProjectOS } from "./project-os";
import { redirect } from "next/navigation";
import { AuthError, requireOwner } from "@/lib/supabase-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  let user;
  try { user = await requireOwner(); } catch (error) {
    if (error instanceof AuthError) redirect("/login");
    throw error;
  }
  return <ProjectOS ownerEmail={user.email} />;
}
