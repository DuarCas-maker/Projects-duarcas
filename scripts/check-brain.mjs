import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const requests = [], config = {url:"https://brain.brant--co.com",sourceId:"project-os",clientId:"synthetic-client",clientSecret:"synthetic-private-secret"};
let mode = "success", tokenCalls = 0, denied = false;
const context = vm.createContext({crypto,TextEncoder,TextDecoder,Uint8Array,URL,URLSearchParams,Response,AbortSignal,Date,console,fetch:async (url,init) => {
  requests.push({url,init});
  if (url.endsWith("/token")) { tokenCalls++; return Response.json({access_token:"synthetic-access-token",token_type:"Bearer",expires_in:3600}); }
  if (mode === "unauthorized" && !denied) { denied=true; return new Response("private upstream echo",{status:401}); }
  if (mode === "redirect") return new Response(null,{status:302,headers:{Location:"https://unapproved.example"}});
  if (mode === "error") return Response.json({jsonrpc:"2.0",id:JSON.parse(init.body).id,result:{isError:true,content:[{type:"text",text:JSON.stringify({code:"permission_denied",message:config.clientSecret})}]}});
  const id=JSON.parse(init.body).id; return new Response(`event: message\ndata: ${JSON.stringify({jsonrpc:"2.0",id,result:{content:[{type:"text",text:JSON.stringify({state:"committed"})}]}})}\n\n`,{headers:{"Content-Type":"text/event-stream"}});
}});
const modules = new Map();
async function load(file) {
  if (modules.has(file)) return modules.get(file);
  const {outputText}=ts.transpileModule(await readFile(new URL(file,import.meta.url),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
  const module=new vm.SourceTextModule(outputText,{context}); modules.set(file,module);
  await module.link((specifier) => load(`../lib/${specifier.replace(/^\.\//,"")}.ts`)); await module.evaluate(); return module;
}
const {GBrainClient,BrainError,validateBrainConfig,parseRpc,boundedText}=(await load("../lib/gbrain-client.ts")).namespace;
const {safeMemoryText,safeSourceText,memoryChunks,memorySlug,memoryMarkdown,selectMemoryHits}=(await load("../lib/brain-content.ts")).namespace;
const client = new GBrainClient(config);
assert.equal((await client.call("put_page",{request_id:crypto.randomUUID()})).state,"committed");
await client.call("whoami"); assert.equal(tokenCalls,1,"Token reused until expiry");
assert.ok(requests.every(({url,init})=>url.startsWith(config.url) && init.redirect==="manual"));
mode="unauthorized"; await client.call("whoami"); assert.equal(tokenCalls,2,"One credential refresh after 401");
mode="error"; await assert.rejects(client.call("search"),error=>error instanceof BrainError && !error.message.includes(config.clientSecret));
mode="redirect"; await assert.rejects(client.call("whoami"));
for (const url of ["http://brain.brant--co.com","https://evil.example","https://brain.brant--co.com/path","https://user:password@brain.brant--co.com","https://brain.brant--co.com?x=1"]) assert.throws(()=>validateBrainConfig({...config,url}));
assert.throws(()=>validateBrainConfig({...config,sourceId:"default"}));
assert.throws(()=>parseRpc(JSON.stringify({jsonrpc:"2.0",id:"other",result:{}}),"application/json","wanted"));
await assert.rejects(boundedText(new Response("12345"),3));
for (const text of ["", "API_KEY=synthetic-secret-value", "sk-proj-synthetic012345678901234567890", "\x00binary", "x".repeat(50000)]) assert.throws(()=>safeMemoryText(text));
// Empty environment templates must not borrow a value from the next line.
for (const newline of ["\n","\r\n"]) {
  const template=["```env","SUPABASE_SERVICE_ROLE_KEY=","OPENAI_API_KEY= \t","OPENAI_DISCOVERY_MODEL=","CLIENT_SECRET:","JWT_SECRET=","PASSWORD =","```","Nunca publicar credenciales."].join(newline);
  assert.equal(safeMemoryText(template),template);
  assert.equal(safeSourceText(template),template);
  assert.ok(memoryMarkdown("Variables","Proyecto",template).includes(template));
  const source=template+newline+"Contexto documental sin credenciales. ".repeat(2000);
  assert.equal(memoryChunks("Variables","Proyecto",source).map(part=>part.text).join(""),source.trim());
}
for (const text of ["OPENAI_API_KEY = synthetic-secret-value","CLIENT_SECRET:\tsynthetic-secret-value","JWT_SECRET=synthetic-secret-value","PASSWORD = \"synthetic-password\"","SUPABASE_SERVICE_ROLE_KEY=synthetic-service-value","-----BEGIN PRIVATE KEY-----","sb_secret_synthetic_value","eyJsynthetic012345.abcdefghijklmnop.abcdefghijklmnop","OPENAI_API_KEY=\nPASSWORD=synthetic-password"]) {
  for (const validate of [safeMemoryText,safeSourceText]) assert.throws(()=>validate(text),error=>error instanceof BrainError && error.status===422);
}
const a=await memorySlug("workspace-a","project-a","source-a"), b=await memorySlug("workspace-b","project-a","source-a"), c=await memorySlug("workspace-a","project-b","source-a");
assert.notEqual(a,b);assert.notEqual(a,c); assert.match(a,/^project-os\/ws-[a-f0-9]{32}\/project-[a-f0-9]{32}\/item-[a-f0-9]{32}$/);
assert.equal(a,await memorySlug("workspace-a","project-a","source-a"));
assert.throws(()=>memoryMarkdown("Title","Project","PASSWORD=synthetic-password"));
const link={source_id:"project-os",external_reference:a,knowledge_id:"source-a",project_id:"project-a",title:"Synthetic note"};
const hits=selectMemoryHits([{slug:b,source_id:"project-os",chunk_text:"another workspace"},{slug:a,source_id:"default",chunk_text:"forged source"},{slug:a,chunk_text:"missing source"},null,{slug:a,source_id:"project-os",chunk_text:"approved evidence"},{slug:a,source_id:"project-os",chunk_text:"duplicate"}],[link]);
assert.equal(hits.length,1); assert.equal(hits[0].text,"approved evidence"); assert.equal(hits[0].projectId,"project-a");
const {aiContext}=(await load("../lib/ai-context.ts")).namespace;
const state={projects:[{id:"project-a",userId:"fixture",name:"A"},{id:"project-b",userId:"fixture",name:"B"}],tasks:[],milestones:[],financials:[],events:[],knowledge:[],inbox:[],suggestions:[],repositories:[],dependencies:[]};
const scoped=aiContext(state,"project-a",undefined,{status:"connected",hits:[hits[0],{...hits[0],id:"forged-id",projectId:"project-b",text:"do not reveal this"}]});
assert.ok(scoped.sources.has("brain:source-a"));assert.ok(!scoped.sources.has("forged-id"));assert.ok(!scoped.text.includes("do not reveal this"));
console.log(JSON.stringify({passed:true,tokenReuse:true,refreshOn401:true,sse:true,noCredentialEcho:true,redirectsRejected:true,sizeBounded:true,secretInputRejected:true,workspaceAndProjectPathsIsolated:true}));
