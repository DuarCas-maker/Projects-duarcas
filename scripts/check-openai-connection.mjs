// Synthetic connection check: never reads workspace data or sends project records.
import { readFile } from "node:fs/promises";
const content = await readFile(new URL("../.env.local", import.meta.url), "utf8");
const key = content.split(/\r?\n/).find((line) => line.startsWith("OPENAI_API_KEY="))?.slice("OPENAI_API_KEY=".length).trim();
if (!key) throw new Error("OPENAI_API_KEY is not configured locally.");
try {
  const response = await fetch("https://api.openai.com/v1/responses", { method:"POST", redirect:"manual", signal:AbortSignal.timeout(40000), headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"}, body:JSON.stringify({model:"gpt-4.1-mini",store:false,max_output_tokens:50,input:"Connection test with synthetic data only. Return an object with ok=true.",text:{format:{type:"json_schema",name:"connection_check",strict:true,schema:{type:"object",additionalProperties:false,properties:{ok:{type:"boolean"}},required:["ok"]}}}}) });
  const result=await response.json();
  if (!response.ok) { console.log(JSON.stringify({passed:false,status:response.status,errorCode:result.error?.code,errorType:result.error?.type,noProjectDataSent:true})); process.exitCode=1; }
  else { const output=result.output?.flatMap((item)=>item.content??[]).find((item)=>item.type==="output_text")?.text; console.log(JSON.stringify({passed:JSON.parse(output??"{}").ok===true,status:response.status,structuredOutput:true,noProjectDataSent:true})); }
} catch { console.log(JSON.stringify({passed:false,transportFailure:true,noProjectDataSent:true})); process.exitCode=1; }
