// Local Node preview only: reuse a bounded set of connections instead of
// opening one TLS connection for every parallel workspace-table request.
import { Agent, setGlobalDispatcher } from "undici";
setGlobalDispatcher(new Agent({connections:4,pipelining:1}));
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
