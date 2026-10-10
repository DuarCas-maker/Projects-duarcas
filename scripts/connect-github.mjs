import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// Operator utility. Dry-run by default, existing Supabase workspace only;
// no project creation, source credential, GitHub writes, or paid AI calls.
async function main() {
  const args = process.argv.slice(2), apply = args.includes("--apply");
  if(args.includes("--diagnostic")) {
    const originalFetch=globalThis.fetch;
    globalThis.fetch=async(url,init)=>{try{return await originalFetch(url,init);}catch(error){
      console.error("Network failure:",new URL(url).hostname,init?.method??"GET",error?.cause?.code??error?.name??"unknown");throw error;
    }};
  }
  const value = flag => args[args.indexOf(flag)+1];
  if (!args.includes("--project-name") || !args.includes("--url")) throw new Error("Use --project-name NAME --url HTTPS_GITHUB_URL [--apply]");
  const userId=process.env.PROJECT_OS_WORKSPACE_ID?.trim();
  if (!userId || process.env.PROJECT_OS_BACKEND!=="supabase") throw new Error("Existing Supabase workspace configuration required");
  const compiled=await build({stdin:{contents:'export * from "../db/repositories";export {getSupabaseWorkspaceState} from "../db/supabase";',resolveDir:fileURLToPath(new URL(".",import.meta.url))},bundle:true,format:"esm",platform:"node",write:false,plugins:[{name:"operator-runtime",setup(builder){
    builder.onResolve({filter:/^(cloudflare:workers|\.\/workspace)$/},args=>({path:args.path,namespace:"operator"}));
    builder.onLoad({filter:/.*/,namespace:"operator"},args=>({contents:args.path==="cloudflare:workers" ? "export const env=process.env" : 'export {getSupabaseWorkspaceState as getWorkspaceState} from "./supabase";',resolveDir:fileURLToPath(new URL("../db/",import.meta.url))}));
  }}]});
  const api=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
  const state=await api.getSupabaseWorkspaceState(userId);
  const selected=state.projects.filter(p=>p.userId===userId && p.name.toLowerCase()===value("--project-name").toLowerCase());
  if(selected.length!==1)throw new Error("Expected exactly one existing project matching the name. No data changed.");
  const project=selected[0];
  if(!apply){console.log(JSON.stringify({dryRun:true,project:project.name,url:value("--url"),repositories:state.repositories.filter(r=>r.userId===userId && r.projectId===project.id).map(r=>({repository:`${r.owner}/${r.repo}`,branch:r.defaultBranch,snapshotSaved:r.status.startsWith("read_only:")}))}));return;}
  console.log("Selected existing project. Linking only the requested repository.");
  const link=await api.linkGithubRepository(userId,state,project.id,value("--url"));
  console.log("Verified repository link in the selected project; synchronizing public context.");
  const result=await api.syncGithubRepository(userId,await api.getSupabaseWorkspaceState(userId),project.id,link.repository.id);
  const verified=await api.getSupabaseWorkspaceState(userId);
  const saved=verified.repositories.find(r=>r.id===link.repository.id && r.userId===userId && r.projectId===project.id);
  if(!saved?.status.startsWith("read_only:"))throw new Error("Snapshot pointer not verified");
  const pack=await api.githubContextPack(userId,verified,project.id,saved.id);
  if(pack.records.length!==1)throw new Error("Context did not resolve to this project's repository");
  console.log(JSON.stringify({project:project.name,repository:`${saved.owner}/${saved.repo}`,branch:saved.defaultBranch,sha:result.source.sha,includedFiles:result.source.included,omittedFiles:result.source.omitted,contextBytes:Buffer.byteLength(pack.text),indexPending:result.indexPending,verified:true}));
}
try {await main();} catch(error) {console.error("GitHub operator failed:",error instanceof Error ? error.message : "unknown");process.exitCode=1;}
