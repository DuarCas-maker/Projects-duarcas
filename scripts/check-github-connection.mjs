import {build} from "esbuild";
import {fileURLToPath} from "node:url";

// Operator check: installed app only; do not print tokens or source contents.
try {
  if (!process.env.GITHUB_APP_PRIVATE_KEY) process.loadEnvFile(".env.github-app.local");
  if (process.argv.includes("--diagnostic")) {
    const originalFetch=globalThis.fetch;
    globalThis.fetch=async(url,init)=>{
      const response=await originalFetch(url,init);
      if (new URL(url).pathname.endsWith("/access_tokens") && response.ok) {
        const data=await response.clone().json();
        console.log(JSON.stringify({tokenResponse:{tokenPresent:typeof data.token === "string",tokenLength:typeof data.token === "string" ? data.token.length : 0,bearerFormat:typeof data.token === "string" && /^[A-Za-z0-9._~+/-]{1,2000}={0,2}$/.test(data.token),expiresAt:data.expires_at,contents:data.permissions?.contents ?? null,metadata:data.permissions?.metadata ?? null,permissionLevels:Object.values(data.permissions ?? {})}}));
      }
      return response;
    };
  }
  const compiled=await build({stdin:{contents:'export {githubConnection} from "../lib/github-app";',resolveDir:fileURLToPath(new URL(".",import.meta.url))},bundle:true,format:"esm",platform:"node",write:false,plugins:[{name:"operator-env",setup(builder){
    builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:"env",namespace:"operator"}));
    builder.onLoad({filter:/.*/,namespace:"operator"},()=>({contents:"export const env=process.env"}));
  }}]});
  const api=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
  const connection=await api.githubConnection();
  console.log(JSON.stringify({configured:connection.configured,installations:connection.installations.map(i=>({account:i.account,repositorySelection:i.repositorySelection})),repositories:connection.repositories.map(r=>({name:r.fullName,private:r.private})),partial:connection.partial}));
} catch(error) {
  console.error("GitHub connection check failed:",error?.name === "GithubError" ? error.message : "Check the private environment file and network access.");process.exitCode=1;
}
