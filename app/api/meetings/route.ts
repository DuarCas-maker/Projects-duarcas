import { uploadAnalysisResource, downloadAnalysisResource } from "@/lib/resource-upload";

export const dynamic = "force-dynamic";
export const POST = (request: Request) => uploadAnalysisResource(request,"meeting");
export const GET = (request: Request) => downloadAnalysisResource(request,"meeting");
