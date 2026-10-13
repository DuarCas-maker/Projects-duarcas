// Local Node preview only: reuse a bounded set of connections instead of
// opening one TLS connection for every parallel workspace-table request.
import { Agent, setGlobalDispatcher } from "undici";
import { lookup } from "node:dns";
import { Resolver } from "node:dns/promises";

// Scope DNS recovery to the configured Supabase host in this local preview.
// Keep the hostname for TLS certificate verification; do not change OS DNS.
const previewSupabaseHost = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).hostname : null;
const previewResolver = new Resolver({ timeout: 2500, tries: 1 });
previewResolver.setServers(["1.1.1.1", "1.0.0.1"]);
const previewLookup = (hostname, options, callback) => {
  lookup(hostname, options, (error, address, family) => {
    if (!error || hostname !== previewSupabaseHost || !["ENOTFOUND", "EAI_AGAIN", "EPERM"].includes(error.code)) {
      callback(error, address, family);
      return;
    }
    const settings = typeof options === "number" ? { family: options } : options;
    const requestedFamily = settings.family === 6 ? 6 : 4;
    const query = requestedFamily === 6 ? previewResolver.resolve6(hostname) : previewResolver.resolve4(hostname);
    void query.then(addresses => {
      if (!addresses.length) { callback(error); return; }
      if (settings.all) callback(null, addresses.map(value => ({ address: value, family: requestedFamily })));
      else callback(null, addresses[0], requestedFamily);
    }, () => callback(error));
  });
};
setGlobalDispatcher(new Agent({connections:4,pipelining:1,connect:{lookup:previewLookup}}));
const nativeFetch=globalThis.fetch;
const transient=new Set(["UND_ERR_CONNECT_TIMEOUT","UND_ERR_SOCKET","ECONNRESET","ETIMEDOUT"]);
globalThis.fetch=async(input,options)=>{
  try {return await nativeFetch(input,options);}
  catch(error){
    const method=options?.method??(input instanceof Request?input.method:"GET");
    const url=String(input instanceof Request?input.url:input);
    const signal=options?.signal??(input instanceof Request?input.signal:undefined);
    if(method.toUpperCase()!=="GET"||!process.env.SUPABASE_URL||new URL(url).origin!==new URL(process.env.SUPABASE_URL).origin||signal?.aborted||!transient.has(error.cause?.code))throw error;
    // GET reads are safe to repeat. Mutations and paid provider calls are never
    // replayed by this transport helper.
    return nativeFetch(input,options);
  }
};
