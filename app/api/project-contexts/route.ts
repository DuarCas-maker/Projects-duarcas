import { uploadAnalysisResource, downloadAnalysisResource } from "@/lib/resource-upload";

export const dynamic = "force-dynamic";
export const POST = (request: Request) => uploadAnalysisResource(request,"project_context");
export const GET = (request: Request) => downloadAnalysisResource(request,"project_context");
