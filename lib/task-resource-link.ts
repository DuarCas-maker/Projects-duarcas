import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { BrainError } from "./gbrain-client";
import { publicLink,MAX_TASK_FILE_BYTES } from "./task-attachments";

export function publicAddress(address:string) {
  if(isIP(address)===4) {
    const [a,b]=address.split(".").map(Number);
    return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&[0,168].includes(b)||a===100&&b>=64&&b<=127||a===198&&[18,19,51].includes(b)||a===203&&b===0);
  }
  // Only global unicast IPv6; excludes loopback, mapped IPv4, ULA, link-local,
  // multicast, transition/tunnel ranges and documentation addresses.
  return isIP(address)===6&&/^2[0-9a-f]{3}:/i.test(address)&&!/^2001:(?:0:|db8:|10:|20:)|^2002:/i.test(address);
}
function exportUrl(input:string) {
  const url=new URL(input),match=url.pathname.match(/^\/(document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/);
  if(url.hostname==="docs.google.com"&&match)return `https://docs.google.com/${match[1]}/d/${match[2]}/export?format=${match[1]==="document"?"txt":match[1]==="spreadsheets"?"xlsx":"pptx"}`;
  if(url.hostname==="drive.google.com") {const id=url.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1]??url.searchParams.get("id");if(id&&/^[a-zA-Z0-9_-]+$/.test(id))return `https://drive.google.com/uc?export=download&id=${id}`;}
  return url.href;
}
export async function fetchTaskLink(input:string):Promise<{bytes:Uint8Array;mime:string;name:string}> {
  let current=exportUrl(input);
  for(let redirect=0;redirect<=4;redirect++) {
    const safe=publicLink(current);if(!safe)throw new BrainError("Usa un enlace HTTPS público, sin credenciales ni direcciones internas.",400);
    const url=new URL(safe);
    let addresses;try {addresses=await lookup(url.hostname,{all:true});}catch{throw new BrainError("No se pudo resolver el enlace. El recurso sigue guardado.",502);}
    if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new BrainError("El enlace no apunta a un servicio público permitido.",422);
    const selected=addresses[0];
    const result=await new Promise<{status:number;location?:string;mime:string;disposition:string;bytes:Uint8Array}>((resolve,reject)=>{
      const req=httpsRequest(url,{method:"GET",family:selected.family,headers:{Accept:"text/html,text/plain,application/pdf,application/octet-stream", "User-Agent":"ProjectOS-Resources/1.0"},lookup:(_host,_options,callback)=>callback(null,selected.address,selected.family)},response=>{
        const chunks:Uint8Array[]=[];let size=0;
        if(Number(response.headers["content-length"])>MAX_TASK_FILE_BYTES){response.destroy();reject(new BrainError("El enlace supera 25 MB.",413));return;}
        response.on("data",(chunk:Uint8Array)=>{size+=chunk.length;if(size>MAX_TASK_FILE_BYTES){response.destroy();reject(new BrainError("El enlace supera 25 MB.",413));}else chunks.push(chunk);});
        response.on("error",()=>reject(new BrainError("No se pudo leer el enlace completo.",502)));
        response.on("end",()=>{const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}resolve({status:response.statusCode??500,location:response.headers.location,mime:response.headers["content-type"]?.split(";")[0]??"application/octet-stream",disposition:String(response.headers["content-disposition"]??""),bytes});});
      });
      const deadline=setTimeout(()=>{req.destroy();reject(new BrainError("El enlace tardó demasiado. Reintenta su lectura.",502));},20000);
      req.on("close",()=>clearTimeout(deadline));
      req.on("error",()=>reject(new BrainError("No se pudo acceder al enlace. Puede requerir permisos o una sesión.",502)));req.end();
    });
    if([301,302,303,307,308].includes(result.status)&&result.location){current=new URL(result.location,url).href;continue;}
    if(result.status<200||result.status>=300)throw new BrainError("El enlace no está disponible públicamente. Revisa sus permisos de acceso.",422);
    let name=result.disposition.match(/filename="?([^";]+)/i)?.[1]??decodeURIComponent(url.pathname.split("/").at(-1)??"enlace");
    if(result.mime.includes("wordprocessingml"))name="enlace.docx";else if(result.mime.includes("spreadsheetml"))name="enlace.xlsx";else if(result.mime.includes("presentationml"))name="enlace.pptx";else if(result.mime==="application/pdf")name="enlace.pdf";else if(result.mime.startsWith("text/"))name=result.mime==="text/html"?"enlace.html":"enlace.txt";else if(["image/png","image/jpeg","image/webp","image/gif"].includes(result.mime))name=`enlace.${result.mime==="image/jpeg"?"jpg":result.mime.slice(6)}`;
    return {bytes:result.bytes,mime:result.mime,name:name.slice(0,180)};
  }
  throw new BrainError("El enlace tiene demasiadas redirecciones.",422);
}
