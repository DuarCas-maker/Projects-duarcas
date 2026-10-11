import assert from "node:assert/strict";
import vm from "node:vm";
import { generateKeyPairSync, verify } from "node:crypto";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// Ephemeral RSA fixture; no real credentials, installations or external calls.
const pair = generateKeyPairSync("rsa",{modulusLength:2048});
const fixtureEnv = {}, calls = [];
const app = {id:123,slug:"project-os-fixture"};
const permissions = {contents:"read",metadata:"read"};
const installation = {id:456,app_id:app.id,account:{login:"owner-fixture",type:"User"},suspended_at:null,permissions,repository_selection:"selected"};
const head = "a".repeat(40), tree = "b".repeat(40), blob = "c".repeat(40);
const repo = {owner:{login:"owner-fixture"},name:"private-fixture",full_name:"owner-fixture/private-fixture",html_url:"https://github.com/owner-fixture/private-fixture",default_branch:"main",private:true,visibility:"private"};
const content = "# Private fixture\nOnly this repository's pinned context.";
let currentInstallation = installation, currentPermissions = permissions, revoked = false, authorized = true, paginate = false;
const context = vm.createContext({Request,Response,Headers,URL,AbortSignal,TextEncoder,TextDecoder,Uint8Array,crypto,atob,btoa,console,fixtureEnv,
  fixtureAuth:()=>{if(!authorized)throw Object.assign(new Error("Inicia sesión"),{status:401});return "workspace-fixture";},
  async fetch(url,init) {
    calls.push({url,init});
    const address = new URL(url), path = address.pathname;
    assert.equal(address.origin,"https://api.github.com");assert.equal(init.redirect,"manual");assert.equal(init.cache,"no-store");
    const auth = init.headers.Authorization;
    if (path === "/app" || path === "/app/installations" || path.endsWith("/installation") || path.endsWith("/access_tokens")) {
      assert.ok(auth.startsWith("Bearer "));
      const [header,payload,signature] = auth.slice(7).split(".");
      assert.equal(JSON.parse(Buffer.from(header,"base64url")).alg,"RS256");
      assert.equal(verify("RSA-SHA256",Buffer.from(`${header}.${payload}`),pair.publicKey,Buffer.from(signature,"base64url")),true);
      const claims = JSON.parse(Buffer.from(payload,"base64url"));
      assert.equal(claims.iss,"123"); assert.ok(claims.iat <= Date.now()/1000 && claims.exp > Date.now()/1000 && claims.exp-claims.iat <= 600);
    }
    if (path === "/app") return Response.json(app);
    if (path === "/app/installations") return Response.json([currentInstallation,{...installation,id:999,account:{login:"another-owner",type:"User"}}]);
    if (path.endsWith("/installation")) return revoked ? Response.json({},{status:404}) : Response.json(currentInstallation);
    if (path === "/app/installations/456/access_tokens") {
      assert.equal(init.method,"POST"); const body = JSON.parse(init.body);assert.deepEqual(body.permissions,permissions);
      assert.ok(!body.repositories || JSON.stringify(body.repositories) === '["private-fixture"]');
      return Response.json({token:body.repositories ? "ghs_repo_fixture.part-2.signature" : "ghs_list_fixture.part-2.signature",expires_at:new Date(Date.now()+3600000).toISOString(),permissions:currentPermissions});
    }
    assert.equal(init.method,"GET");
    if (path === "/installation/repositories") {
      assert.equal(auth,"Bearer ghs_list_fixture.part-2.signature");
      return Response.json({repositories:paginate && address.searchParams.get("page") === "1" ? Array.from({length:100},(_,n)=>({...repo,name:`repo-${n}`,full_name:`owner-fixture/repo-${n}`})) : [repo]});
    }
    if (path === "/repos/owner-fixture/private-fixture" && !auth) return Response.json({},{status:404});
    assert.equal(auth,"Bearer ghs_repo_fixture.part-2.signature");
    if (path.endsWith("/commits/main")) return Response.json({sha:head,commit:{tree:{sha:tree},message:"Private fixture commit"}});
    if (path.endsWith(`/git/trees/${tree}`)) return Response.json({tree:[{path:"README.md",sha:blob,size:Buffer.byteLength(content),type:"blob",mode:"100644"}],truncated:false});
    if (path.endsWith(`/git/blobs/${blob}`)) return Response.json({sha:blob,size:Buffer.byteLength(content),encoding:"base64",content:Buffer.from(content).toString("base64")});
    if (path === "/repos/owner-fixture/private-fixture") return Response.json(repo);
    throw Error("Unexpected fixture path");
  },
});
const compiled = await build({stdin:{contents:'export * from "../lib/github-app";export * from "../lib/github-client";export * as route from "../app/api/github/route";',resolveDir:fileURLToPath(new URL(".",import.meta.url))},bundle:true,format:"esm",platform:"node",write:false,plugins:[{name:"github-app-fixtures",setup(builder){
  builder.onResolve({filter:/^(cloudflare:workers|@\/lib\/workspace-context)$/},args=>({path:args.path,namespace:"fixture"}));
  builder.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:args.path === "cloudflare:workers" ? "export const env=globalThis.fixtureEnv" : "export class WorkspaceConfigurationError extends Error{constructor(message,status){super(message);this.status=status}};export async function currentWorkspaceId(){try{return globalThis.fixtureAuth()}catch(e){throw new WorkspaceConfigurationError(e.message,e.status)}}"}));
}}]});
const module = new vm.SourceTextModule(compiled.outputFiles[0].text,{context});await module.link(()=>{});await module.evaluate();const api = module.namespace;
assert.equal((await api.githubConnection()).configured,false);assert.equal(calls.length,0);
fixtureEnv.GITHUB_ALLOWED_ACCOUNTS="owner-fixture";assert.equal((await api.githubConnection()).configured,false);assert.equal(calls.length,0);
fixtureEnv.GITHUB_APP_ID="123";await assert.rejects(api.githubConnection(),e=>e.status === 503);assert.equal(calls.length,0);
Object.assign(fixtureEnv,{GITHUB_APP_SLUG:app.slug,GITHUB_APP_PRIVATE_KEY:pair.privateKey.export({type:"pkcs1",format:"pem"}).replace(/\n/g,"\\n"),GITHUB_ALLOWED_ACCOUNTS:"owner-fixture"});
let connected = await api.githubConnection();
assert.equal(connected.installations.length,1);assert.equal(connected.repositories.length,1);assert.equal(connected.repositories[0].private,true);
assert.equal(connected.installUrl,"https://github.com/apps/project-os-fixture/installations/new");
assert.ok(!JSON.stringify(connected).includes("ghs_") && !JSON.stringify(connected).includes("PRIVATE KEY") && !JSON.stringify(connected).includes("another-owner"));
assert.equal((await api.route.GET()).status,200);assert.equal((await api.route.GET()).headers.get("cache-control"),"private, no-store");
authorized=false;calls.length=0;assert.equal((await api.route.GET()).status,401);assert.equal(calls.length,0);authorized=true;
assert.equal(await api.githubRepositoryAccess("another-owner","repo"),undefined);assert.equal(calls.length,0);
const access = await api.githubRepositoryAccess("owner-fixture","private-fixture");
await assert.rejects(api.githubGet("/repos/another-owner/repo",access),e=>e.status === 403);
await assert.rejects(api.githubGet("/repos/owner-fixture/private-fixture/../../another-owner/repo",access),e=>e.status === 400);
assert.equal((await api.githubMetadata("owner-fixture","private-fixture")).branch,"main");
const snapshot = await api.readGithubSnapshot("owner-fixture","private-fixture","main");
assert.equal(snapshot.sha,head);assert.equal(snapshot.included,1);assert.ok(snapshot.content.includes(content));
for (const call of calls.filter(c=>c.init.method === "POST")) assert.equal(new URL(call.url).pathname,"/app/installations/456/access_tokens");
revoked=true;await assert.rejects(api.readGithubSnapshot("owner-fixture","private-fixture","main",head),e=>e.status === 404);revoked=false;
currentInstallation={...installation,suspended_at:"2026-10-11T00:00:00Z"};await assert.rejects(api.githubRepositoryAccess("owner-fixture","private-fixture"),e=>e.status === 403);
currentInstallation={...installation,account:{login:"another-owner",type:"User"}};await assert.rejects(api.githubRepositoryAccess("owner-fixture","private-fixture"),e=>e.status === 403);
currentInstallation={...installation,app_id:999};await assert.rejects(api.githubRepositoryAccess("owner-fixture","private-fixture"),e=>e.status === 403);
currentInstallation={...installation,permissions:{...permissions,issues:"write"}};await assert.rejects(api.githubConnection(),e=>e.status === 403);
currentInstallation=installation;currentPermissions={...permissions,contents:"write"};await assert.rejects(api.githubRepositoryAccess("owner-fixture","private-fixture"),e=>e.status === 502);currentPermissions=permissions;
fixtureEnv.GITHUB_APP_PRIVATE_KEY="invalid fixture";await assert.rejects(api.githubConnection(),e=>e.status === 503 && !e.message.includes("invalid fixture"));
fixtureEnv.GITHUB_APP_PRIVATE_KEY=pair.privateKey.export({type:"pkcs8",format:"pem"});
paginate=true;connected=await api.githubConnection();assert.equal(connected.repositories.length,101);assert.equal(connected.partial,false);paginate=false;
fixtureEnv.GITHUB_APP_SLUG="different-slug";await assert.rejects(api.githubConnection(),e=>e.status === 403);fixtureEnv.GITHUB_APP_SLUG=app.slug;
currentInstallation={...installation,account:{login:"owner-fixture",type:"Organization"}};
assert.equal((await api.githubConnection()).installations[0].manageUrl,"https://github.com/organizations/owner-fixture/settings/installations/456");
console.log("GitHub App passed: verified RSA JWTs (PKCS#1 and PKCS#8), account allowlist, private pinned snapshots, repo-scoped read-only tokens, revocation/suspension, pagination, safe errors and authenticated no-store API. Live calls: 0.");
