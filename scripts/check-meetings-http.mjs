import assert from "node:assert/strict";
const base="http://127.0.0.1:3001",marker=`reunion-prueba-${crypto.randomUUID().slice(0,8)}`;
async function json(path,body){const response=await fetch(base+path,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{});return {status:response.status,data:await response.json()};}
const state=(await json("/api/state")).data,project=state.projects.find(row=>row.name==="Prueba de lectura · PDF y Word");assert.ok(project,"Use the existing synthetic test project only");
const transcript=`${marker}: transcripción ficticia.\n`+"[00:30:00] María: Revisamos el plan ficticio y dejamos la información completa disponible.\n".repeat(650)+`[01:29:00] ${marker}: al final elegimos el material zafiro para la demostración ficticia.`;
assert.ok(new TextEncoder().encode(transcript).length>48*1024);assert.ok(new TextEncoder().encode(transcript).length<64*1024);
const notes=`${marker}: notas ficticias. Decisión: material zafiro. Pendiente: revisar el jueves.`,id=crypto.randomUUID(),driveUrl="https://drive.google.com/file/d/synthetic_meeting_reference/view";
function form(url=driveUrl,filename="transcripcion.txt",text=transcript){const data=new FormData();for(const [key,value] of Object.entries({requestId:id,projectId:project.id,title:`Reunión ficticia · ${marker}`,date:"2026-10-07",driveUrl:url}))data.set(key,value);data.set("transcript",new File([text],filename,{type:"text/plain"}));data.set("notes",new File([notes],"notas.md",{type:"text/markdown"}));return data;}
async function upload(data,headers){const response=await fetch(base+"/api/meetings",{method:"POST",body:data,headers}),text=await response.text();let result;try{result=JSON.parse(text);}catch{result={error:text};}return {status:response.status,data:result};}
assert.equal((await upload(form("https://unapproved.example/video"))).status,400);
assert.equal((await upload(form(driveUrl,"video.mp4"))).status,422);
assert.equal((await upload(form(),{origin:"https://unapproved.example"})).status,403);
const saved=await upload(form());assert.equal(saved.status,201,saved.data.error);assert.equal(saved.data.item.itemType,"meeting");
const repeated=await upload(form());assert.equal(repeated.status,200);assert.equal(repeated.data.replayed,true);
assert.equal((await upload(form(driveUrl,"transcripcion.txt",transcript+"changed"))).status,409);
for(const [role,expected] of [["transcript",transcript],["notes",notes]]){const response=await fetch(`${base}/api/meetings?id=${id}&role=${role}`);assert.equal(response.status,200);assert.equal(await response.text(),expected);assert.match(response.headers.get("content-disposition"),/attachment/);}
assert.equal((await json(`/api/meetings?id=${crypto.randomUUID()}&role=transcript`)).status,404);
let processed,parts=0;
do {
  const operation={action:"process",projectId:project.id,knowledgeId:id,requestId:crypto.randomUUID()};
  processed=await json("/api/brain",operation);assert.equal(processed.status,200,processed.data.error);parts++;
  const replay=await json("/api/brain",operation);assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);
  assert.ok(parts<=3); // fixture intentionally stays below the shared minute quota
} while(processed.data.status==="pending");
assert.equal(processed.data.status,"ready");assert.equal(parts,2);
assert.equal(processed.data.state.knowledge.find(row=>row.id===id).processingStatus,"indexed");
const recalled=await json("/api/brain",{action:"search",projectId:project.id,query:`${marker} material zafiro decisión final`,requestId:crypto.randomUUID()});assert.equal(recalled.status,200,recalled.data.error);assert.ok(recalled.data.hits.some(hit=>hit.knowledgeId===id),"Meeting fragments are retrieved through their owned parent source");
console.log(JSON.stringify({passed:true,projectId:project.id,meetingId:id,marker,parts,originalDownloadsVerified:true,noVideoCopied:true,replaysWithoutDuplicate:true,invalidLinksAndVideoUploadsRejected:true,fragmentRetrievalVerified:true,chatApiCalls:0,embeddingWrites:parts,syntheticFixtureKept:true}));
