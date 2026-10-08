// Live, read-only access checks. Credentials are read privately and never logged.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const local=await readFile(new URL("../.env.local",import.meta.url),"utf8");
const value=(key)=>local.match(new RegExp(`^${key}=(.+)$`,"m"))?.[1].trim();
const origin=value("GBRAIN_URL"); assert.equal(origin,"https://brain.brant--co.com");
const tokenResponse=await fetch(`${origin}/token`,{method:"POST",redirect:"manual",signal:AbortSignal.timeout(15000),headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"client_credentials",client_id:value("GBRAIN_CLIENT_ID"),client_secret:value("GBRAIN_CLIENT_SECRET"),scope:"read write",resource:`${origin}/mcp`})});
assert.equal(tokenResponse.status,200);const token=(await tokenResponse.json()).access_token;
async function rpc(method,params={}) {
  const id=crypto.randomUUID(),r=await fetch(`${origin}/mcp`,{method:"POST",redirect:"manual",signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json",Accept:"application/json, text/event-stream","MCP-Protocol-Version":"2025-03-26"},body:JSON.stringify({jsonrpc:"2.0",id,method,params})});
  assert.equal(r.status,200);const text=await r.text();return r.headers.get("content-type").includes("text/event-stream") ? JSON.parse(text.split("\n").find(line=>line.startsWith("data:")).slice(5)) : JSON.parse(text);
}
const listed=await rpc("tools/list");
assert.deepEqual(listed.result.tools.map(tool=>tool.name).sort(),["get_page","get_write_request","put_page","search","whoami"].sort());
const denied=await rpc("tools/call",{name:"search",arguments:{query:"synthetic permission check",source_id:"default",limit:1}});assert.equal(denied.result.isError,true,"Default source is outside the grant");
const admin=await fetch(`${origin}/admin/api/full-stats`,{redirect:"manual",signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${token}`}});
assert.ok([401,403].includes(admin.status),"Machine client cannot open owner administration");
console.log(JSON.stringify({passed:true,exactlyFiveOperations:true,otherSourceDenied:true,ownerAdministrationDenied:true}));
