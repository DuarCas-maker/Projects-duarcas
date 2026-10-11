import { env } from "cloudflare:workers";
import { GithubError } from "./github-errors";
import { githubRequest } from "./github-http";

type AppConfig = {id:number;slug:string;privateKey:string;accounts:string[]};
export type GithubAccess = {token:string;owner:string;repo:string};
export type GithubConnection = {
  configured:boolean; installUrl:string|null; accounts:string[];
  installations:{account:string;repositorySelection:"all"|"selected";manageUrl:string}[];
  repositories:{fullName:string;url:string;defaultBranch:string;private:boolean}[];
  partial:boolean;
};
function config(): AppConfig | null {
  const id = env.GITHUB_APP_ID?.trim(), slug = env.GITHUB_APP_SLUG?.trim(), key = env.GITHUB_APP_PRIVATE_KEY?.trim(), accounts = env.GITHUB_ALLOWED_ACCOUNTS?.trim();
  if (!id && !slug && !key) return null;
  const allowed = accounts?.split(",").map(x=>x.trim().toLowerCase()).filter(Boolean) ?? [];
  if (!id || !/^[1-9]\d{0,14}$/.test(id) || !Number.isSafeInteger(Number(id)) || !slug || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug) ||
      !key || !allowed.length || allowed.length > 10 || allowed.some(x=>!validOwner(x)))
    throw new GithubError("La GitHub App está incompleta. Configura ID, slug, clave privada y cuentas autorizadas en el servidor.");
  return {id:Number(id),slug,privateKey:key.replace(/\\n/g,"\n").trim(),accounts:[...new Set(allowed)]};
}
const validOwner = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9-]{1,39}$/.test(value);
const validRepo = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_.-]{1,100}$/.test(value) && value !== "." && value !== "..";
function base64url(bytes: Uint8Array) {
  return btoa(Array.from(bytes,b=>String.fromCharCode(b)).join("")).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
}
function der(tag: number, bytes: Uint8Array) {
  const length = bytes.length;
  if (length > 65535) throw new Error("key_size");
  return Uint8Array.from([tag,...(length < 128 ? [length] : length < 256 ? [0x81,length] : [0x82,length >> 8,length & 255]),...bytes]);
}
async function jwt(app: AppConfig) {
  try {
    const now = Math.floor(Date.now()/1000), encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
    const payload = `${encode({alg:"RS256",typ:"JWT"})}.${encode({iat:now-60,exp:now+540,iss:String(app.id)})}`;
    const pem = /^(-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----)\s+([A-Za-z0-9+/=\s]+)\s+-----END \2-----$/.exec(app.privateKey);
    if (!pem || app.privateKey.length > 16000) throw new Error("key_format");
    let bytes: Uint8Array<ArrayBuffer> = Uint8Array.from(atob(pem[3].replace(/\s/g,"")),c=>c.charCodeAt(0));
    if (pem[2] === "RSA PRIVATE KEY") {
      // GitHub downloads PKCS#1; Web Crypto imports PKCS#8. Wrap the RSA DER
      // without parsing or changing its key material (rsaEncryption + NULL).
      bytes = der(0x30,Uint8Array.from([2,1,0,0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0x00,...der(4,bytes)]));
    }
    const key = await crypto.subtle.importKey("pkcs8",bytes,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(payload));
    return `${payload}.${base64url(new Uint8Array(signature))}`;
  } catch { throw new GithubError("La clave privada de la GitHub App no es válida. Revisa la variable del servidor."); }
}
type Installation = {id:number;app_id:number;account:{login:string;type:string};suspended_at:string|null;permissions:Record<string,string>;repository_selection:"all"|"selected"};
function validateInstallation(value: unknown, app: AppConfig): Installation {
  const i = value as Installation;
  if (!i || !Number.isSafeInteger(i.id) || i.id <= 0 || i.app_id !== app.id || !validOwner(i.account?.login) || !app.accounts.includes(i.account.login.toLowerCase()) ||
      !["User","Organization"].includes(i.account.type) || i.suspended_at !== null || !["all","selected"].includes(i.repository_selection))
    throw new GithubError("La instalación de GitHub no está autorizada para este gestor o está suspendida.",403);
  if (!i.permissions || i.permissions.contents !== "read" || i.permissions.metadata !== "read" || Object.values(i.permissions).some(p=>p !== "read"))
    throw new GithubError("Configura la GitHub App con Contents y Metadata de solo lectura, sin permisos de escritura.",403);
  return i;
}
async function installationToken(app: AppConfig, installation: Installation, repository?: string) {
  const data = await githubRequest(`/app/installations/${installation.id}/access_tokens`,await jwt(app),{
    permissions:{contents:"read",metadata:"read"}, ...(repository ? {repositories:[repository]} : {}),
  });
  // Treat tokens as opaque Bearer credentials, including GitHub's signed
  // token format. Do not assume the older ghs_ alphanumeric representation.
  if (typeof data.token !== "string" || !/^[A-Za-z0-9._~+/-]{1,2000}={0,2}$/.test(data.token) ||
      typeof data.expires_at !== "string" || !Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= Date.now() ||
      data.permissions?.contents !== "read" || data.permissions?.metadata !== "read" || Object.values(data.permissions).some(p=>p !== "read"))
    throw new GithubError("GitHub no devolvió una credencial válida de solo lectura.",502);
  // Tokens live only during this request; each sync re-checks installation/access.
  return data.token as string;
}
export async function githubRepositoryAccess(owner: string, repo: string): Promise<GithubAccess | undefined> {
  if (!validOwner(owner) || !validRepo(repo)) throw new GithubError("Repositorio no válido.",400);
  const app = config(); if (!app || !app.accounts.includes(owner.toLowerCase())) return undefined;
  let raw: unknown;
  try { raw = await githubRequest(`/repos/${owner}/${repo}/installation`,await jwt(app)); }
  catch (error) { if (error instanceof GithubError && error.status === 404) return undefined; throw error; }
  const installation = validateInstallation(raw,app);
  if (installation.account.login.toLowerCase() !== owner.toLowerCase()) throw new GithubError("El repositorio no pertenece a la cuenta autorizada.",403);
  return {token:await installationToken(app,installation,repo),owner:owner.toLowerCase(),repo:repo.toLowerCase()};
}
export async function githubConnection(): Promise<GithubConnection> {
  const app = config();
  const result: GithubConnection = {configured:!!app,installUrl:app ? `https://github.com/apps/${app.slug}/installations/new` : null,accounts:app?.accounts ?? [],installations:[],repositories:[],partial:false};
  if (!app) return result;
  // Confirm the configured slug and key belong to this app before showing links.
  const identity = await githubRequest("/app",await jwt(app));
  if (identity.id !== app.id || identity.slug !== app.slug) throw new GithubError("El ID y el slug no corresponden a la misma GitHub App.",403);
  let installations: Installation[] = [];
  for (let page=1; page<=10; page++) {
    const rows = await githubRequest(`/app/installations?per_page=100&page=${page}`,await jwt(app));
    if (!Array.isArray(rows) || rows.length > 100) throw new GithubError("No se pudieron comprobar las instalaciones de GitHub.",502);
    installations.push(...rows.filter(i=>validOwner(i?.account?.login) && app.accounts.includes(i.account.login.toLowerCase())).map(i=>validateInstallation(i,app)));
    if (rows.length < 100) break;
    if (page === 10) result.partial = true;
  }
  for (const installation of installations) {
    const account = installation.account.login;
    result.installations.push({account,repositorySelection:installation.repository_selection,
      manageUrl:installation.account.type === "Organization" ? `https://github.com/organizations/${account}/settings/installations/${installation.id}` : `https://github.com/settings/installations/${installation.id}`});
    const token = await installationToken(app,installation);
    for (let page=1; page<=10; page++) {
      const data = await githubRequest(`/installation/repositories?per_page=100&page=${page}`,token);
      if (!Array.isArray(data.repositories) || data.repositories.length > 100) throw new GithubError("No se pudieron listar los repositorios autorizados.",502);
      for (const repo of data.repositories) {
        if (!validOwner(repo?.owner?.login) || repo.owner.login.toLowerCase() !== account.toLowerCase() || !validRepo(repo.name) ||
            repo.full_name !== `${repo.owner.login}/${repo.name}` || typeof repo.default_branch !== "string" || repo.default_branch.length > 100 || typeof repo.private !== "boolean")
          throw new GithubError("GitHub devolvió un repositorio fuera de la cuenta autorizada.",502);
        result.repositories.push({fullName:repo.full_name,url:`https://github.com/${repo.full_name}`,defaultBranch:repo.default_branch,private:repo.private});
      }
      if (data.repositories.length < 100) break;
      if (page === 10) result.partial = true;
    }
  }
  result.repositories.sort((a,b)=>a.fullName.localeCompare(b.fullName));
  return result;
}
