import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath,pathToFileURL } from "node:url";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqlite,migrate,d1Adapter } from "../runtime/sqlite.mjs";

const compiled=await build({stdin:{contents:["core-commands","operations-commands","workspace-types","task-merge","task-structure","task-matches","task-match-commands","project-operations","task-copy","task-attachments","notebook","daily-engine","daily-commands","today-dashboard"].map(n=>`export * from "./${n}";`).join("\n"),resolveDir:fileURLToPath(new URL("../lib/",import.meta.url))},bundle:true,platform:"node",format:"esm",write:false});
const dir=await mkdtemp(join(tmpdir(),"task-organization-")),file=join(dir,"fixture.mjs");await writeFile(file,compiled.outputFiles[0].text);
const api=await import(pathToFileURL(file).href),sql=openSqlite(join(dir,"fixture.sqlite"));migrate(sql);const db=d1Adapter(sql);
let state=api.emptyWorkspace(),counter=0;
const owner="organization-fixture",keys={tasks:"tasks",projects:"projects",milestones:"milestones",project_events:"events",project_operations:"operations",task_dependencies:"dependencies",calendar_blocks:"calendar",ai_suggestions:"suggestions"};
const now=()=>new Date(Date.UTC(2026,9,14,14,0,counter++)).toISOString();
const camel=row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k.replace(/_([a-z])/g,(_,x)=>x.toUpperCase()),v]));
async function apply(plan){
  const statements=[],value=v=>typeof v==="boolean"?Number(v):v;
  for(const c of plan.changes){
    const row=c.row,cols=Object.keys(row);
    if(c.expected){const expected=Object.entries(c.expected);statements.push(db.prepare(`SELECT json(CASE WHEN EXISTS(SELECT 1 FROM ${c.table} WHERE id=? AND user_id=? AND ${expected.map(([k])=>`${k} IS ?`).join(" AND ")}) THEN 'true' ELSE 'conflict' END)`).bind(row.id,owner,...expected.map(([,v])=>value(v))));}
    if(c.kind==="insert")statements.push(db.prepare(`INSERT INTO ${c.table} (${cols.join(",")}) VALUES (${cols.map(()=>"?").join(",")})`).bind(...cols.map(k=>value(row[k]))));
    else if(c.kind==="delete")statements.push(db.prepare(`DELETE FROM ${c.table} WHERE id=? AND user_id=?`).bind(row.id,owner));
    else {const edit=cols.filter(k=>!["id","user_id"].includes(k));statements.push(db.prepare(`UPDATE ${c.table} SET ${edit.map(k=>`${k}=?`).join(",")} WHERE id=? AND user_id=?`).bind(...edit.map(k=>value(row[k])),row.id,owner));}
  }
  await db.batch(statements);
  for(const c of plan.changes){const key=keys[c.table];assert.ok(key,c.table);const row=camel(c.row);state[key]=state[key].filter(r=>r.id!==row.id);if(c.kind!=="delete")state[key].push(row);}
  state=api.deriveWorkspaceState(state);return plan.id;
}
const core=async(action,payload)=>apply(api.buildCoreCommand(state,owner,action,payload,crypto.randomUUID(),now()));
const op=async(action,payload)=>apply(api.buildOperationsCommand(state,owner,action,payload,crypto.randomUUID(),now()));
const task=id=>state.tasks.find(t=>t.id===id);
const group=(ids,title)=>({taskIds:ids,title,description:"Acción concreta del proyecto",criteria:"Entregable revisado",primaryId:null,deadline:null,estimatedMinutes:30,status:"pending"});
const draft=(groups,mode="single")=>({mode,title:"Cerrar diseño web, marca y catálogo",description:"Resultado común del proyecto",reason:"Dos convocatorias corresponden a la misma reunión; materiales y catálogo son acciones distintas.",primaryId:null,deadline:null,conflicts:[],groups});
try {
  const projectId=await core("create_project",{name:"Diseño de Diego",operationalStatus:"Activo"}),other=await core("create_project",{name:"Proyecto externo"});
  const parent=await core("create_task",{projectId,title:"Cerrar diseño"});
  const a=await core("create_task",{projectId,parentTaskId:parent,title:"Enviar materiales",status:"completed"});
  assert.equal(task(parent).status,"completed");
  const b=await core("create_task",{projectId,parentTaskId:parent,title:"Definir catálogo"});assert.equal(task(parent).status,"pending");
  await core("update_task_status",{id:b,status:"completed"});assert.equal(task(parent).status,"completed");
  await core("update_task_status",{id:a,status:"pending"});assert.equal(task(parent).status,"pending");
  await assert.rejects(core("update_task_status",{id:parent,status:"completed"}),api.CoreValidationError);
  await assert.rejects(core("create_task",{projectId,parentTaskId:a,title:"Tercer nivel"}),api.CoreValidationError);
  await assert.rejects(core("update_task",{id:parent,parentTaskId:a}),api.CoreValidationError);
  await assert.rejects(core("create_task",{projectId:other,parentTaskId:parent,title:"Cruzar proyectos"}),api.CoreValidationError);
  await assert.rejects(core("update_task",{id:a,dependsOnTaskIds:[parent]}),api.CoreValidationError);
  const counted=api.taskCounts(state.tasks.filter(t=>t.projectId===projectId));assert.equal(counted.total,2);assert.ok(!api.eligibleTasks(state).some(t=>t.id===parent));
  assert.ok(api.formatTasksForCopy(state,projectId,[parent]).includes("↳"));assert.ok(api.taskTree(state,projectId,t=>t.id===a).some(g=>g.parent.id===parent&&g.children.length===1));
  await core("update_task_status",{id:a,status:"cancelled"});assert.equal(task(parent).status,"completed");await core("update_task_status",{id:b,status:"cancelled"});assert.equal(task(parent).status,"cancelled");

  const person=await op("save_person",{projectId,name:"Diego"}),photographer=await op("save_person",{projectId,name:"Fotógrafo"});
  const meeting=await core("create_task",{projectId,title:"Coordinar reunión con diseñadora y fotógrafo",primaryId:person});
  const duplicate=await core("create_task",{projectId,title:"Organizar reunión para manual de marca y foto del catálogo",primaryId:photographer});
  const materials=await core("create_task",{projectId,title:"Enviar materiales gráficos y contexto"});
  const catalog=await core("create_task",{projectId,title:"Definir catálogo visual y personalización"});
  const downstream=await core("create_task",{projectId,title:"Publicar entregables",dependsOnTaskIds:[duplicate]});
  await op("add_task_comment",{projectId,taskId:duplicate,body:"Comentario del original"});
  state.knowledge.push({id:"source-attachment",userId:owner,projectId,itemType:"task_attachment",title:"Brief",sourceReference:api.TASK_ATTACHMENT_PREFIX+JSON.stringify({version:1,taskId:duplicate,kind:"link",published:true,activeVersionId:"source-version",versions:[{id:"source-version",name:"Brief",key:null,size:0,mime:"text/html",url:"https://example.com/brief",createdAt:now(),error:""}]})});
  const ids=[meeting,duplicate,materials,catalog],d=draft([group([meeting,duplicate],"Coordinar reunión de diseño y fotografía"),group([materials],"Enviar materiales"),group([catalog],"Definir catálogo")],"parent");
  d.groups[0].primaryId=person;
  const snapshot=api.mergeSnapshot(state,projectId);
  assert.throws(()=>api.buildTaskMerge(state,owner,other,ids,d,snapshot,"wrong"));
  assert.throws(()=>api.validateMergeDraft({...d,groups:[...d.groups,group([meeting],"Duplicada")]},ids.map(task),state));
  assert.throws(()=>api.validateMergeDraft({...d,groups:d.groups.slice(1)},ids.map(task),state));
  const root=await apply(api.buildTaskMerge(state,owner,projectId,ids,d,snapshot,"merge-fixture",now()));
  assert.equal(api.taskChildren(state,root).length,3);assert.equal(task(duplicate).sourceType,"task_merge");assert.equal(task(duplicate).sourceId,meeting);
  assert.equal(state.dependencies.find(e=>e.taskId===downstream).dependsOnTaskId,meeting);
  assert.equal(api.taskAttachments(state,meeting).length,1);assert.ok(api.taskSourceIds(state,meeting).has(duplicate));
  assert.ok(api.operationsFor(state,projectId).comments.some(c=>c.taskId===duplicate));
  assert.ok(api.detailFor(api.operationsFor(state,projectId),meeting).collaboratorIds.includes(photographer));
  assert.ok(!api.taskTree(state,projectId,()=>true).some(g=>g.parent.id===duplicate));
  const history=state.events.find(e=>e.id==="merge-fixture");assert.equal(JSON.parse(history.description).originals.length,4);
  assert.throws(()=>api.buildTaskMerge(state,owner,projectId,ids,d,snapshot,"stale"),api.CoreValidationError);
  for(const id of [meeting,materials,catalog])await core("update_task_status",{id,status:"completed"});assert.equal(task(root).status,"completed");
  await core("update_task_status",{id:materials,status:"pending"});assert.equal(task(root).status,"pending");

  const one=await core("create_task",{projectId,title:"Enviar brief de diseño"}),two=await core("create_task",{projectId,title:"Compartir brief para diseño"});
  const plan=api.buildTaskMerge(state,owner,projectId,[one,two],draft([group([one,two],"Enviar brief")]),api.mergeSnapshot(state,projectId),"stale-transaction",now());
  await core("update_task",{id:two,description:"Cambio concurrente"});
  await assert.rejects(apply(plan));assert.notEqual(task(two).sourceType,"task_merge");assert.ok(!state.events.some(e=>e.id==="stale-transaction"));
  const merged=await apply(api.buildTaskMerge(state,owner,projectId,[one,two],draft([group([one,two],"Enviar brief")]),api.mergeSnapshot(state,projectId),"single-fixture",now()));assert.equal(merged,one);assert.equal(task(two).sourceId,one);

  const suggest=async(title,description="Información nueva")=>apply(api.buildDailyCommand(state,owner,"create_task_suggestion",{projectId,title,description},crypto.randomUUID(),now()));
  const suggestionId=await suggest("Compartir brief de diseño"),suggestion=state.suggestions.find(s=>s.id===suggestionId);
  assert.ok(api.proposalMatches(state,suggestion).tasks.some(t=>t.id===one));
  assert.throws(()=>api.buildDailyCommand(state,owner,"suggestion_status",{id:suggestionId,status:"approved"},"duplicate-approval"));
  const resolution={id:suggestionId,mode:"update",targetId:one,title:task(one).title,description:"Brief consolidado con el nuevo contexto",suggestionSnapshot:suggestion.payload,targetUpdatedAt:task(one).updatedAt,operationsUpdatedAt:api.operationsRecord(state,projectId)?.updatedAt??null};
  assert.throws(()=>api.buildTaskMatchResolution(state,owner,{...resolution,targetUpdatedAt:"stale"},"stale-resolution"));
  const beforeCount=state.tasks.length;await apply(api.buildTaskMatchResolution(state,owner,resolution,"resolve-update",now()));assert.equal(state.tasks.length,beforeCount);assert.equal(task(one).description,resolution.description);
  const childSuggestion=await suggest("Enviar brief al fotógrafo");const child=state.suggestions.find(s=>s.id===childSuggestion);
  const newChild=await apply(api.buildTaskMatchResolution(state,owner,{id:childSuggestion,mode:"subtask",targetId:root,title:child.title,description:"Entregar el brief revisado",suggestionSnapshot:child.payload,targetUpdatedAt:task(root).updatedAt,operationsUpdatedAt:api.operationsRecord(state,projectId)?.updatedAt??null},"resolve-child",now()));assert.equal(task(newChild).parentTaskId,root);
  const distinctSuggestion=await suggest("Enviar brief de diseño a otro cliente"),distinct=state.suggestions.find(s=>s.id===distinctSuggestion);
  const independent=await apply(api.buildTaskMatchResolution(state,owner,{id:distinctSuggestion,mode:"separate",title:distinct.title,description:"Distinto contexto confirmado",suggestionSnapshot:distinct.payload,operationsUpdatedAt:api.operationsRecord(state,projectId)?.updatedAt??null},"resolve-separate",now()));assert.equal(task(independent).parentTaskId,null);
  const pendingOne=await suggest("Preparar catálogo fotográfico"),pendingTwo=await suggest("Preparar catálogo fotográfico final"),p1=state.suggestions.find(s=>s.id===pendingOne),p2=state.suggestions.find(s=>s.id===pendingTwo);
  await apply(api.buildTaskMatchResolution(state,owner,{id:pendingTwo,mode:"pending",targetId:pendingOne,description:"Un solo catálogo con ambas especificaciones",suggestionSnapshot:p2.payload,targetSnapshot:p1.payload,operationsUpdatedAt:api.operationsRecord(state,projectId)?.updatedAt??null},"resolve-pending",now()));assert.equal(state.suggestions.find(s=>s.id===pendingOne).status,"pending");assert.equal(state.suggestions.find(s=>s.id===pendingTwo).status,"rejected");
  assert.ok(!api.mergeEventText(history).includes("taskDetails"));

  const note={id:"hierarchy-note",userId:owner,content:"Cerrar campaña. Preparar guion.",inputType:"text",detectedProjectId:projectId,classification:api.NOTEBOOK_CLASSIFICATION,status:"unprocessed",createdAt:now()};
  keys.inbox_items="inbox";await apply({id:note.id,changes:[{table:"inbox_items",kind:"insert",row:api.databaseRow(note)}]});
  const proposalFor=(title,extra={})=>({projectId,action:"create_task",targetId:null,title,reason:"Acción explícita de la nota",quote:note.content,changes:Object.entries({title,description:"Entregable de campaña",priority:3,urgency:3,estimatedMinutes:30,criteria:"Entregable revisado",...extra}).map(([field,value])=>({field,value:String(value)}))});
  const result={summary:"Principal y subtarea",questions:[],proposals:[proposalFor("Cerrar campaña"),proposalFor("Preparar guion",{parentProposalTitle:"Cerrar campaña"})]};
  api.validateNotebookResult(result,state,owner,note.content,false);
  assert.throws(()=>api.validateNotebookResult({...result,proposals:[result.proposals[1]]},state,owner,note.content,false));
  await apply(api.buildNotebookProposals(state,owner,note,{id:"hierarchy-round",createdAt:now(),answers:[],result}));
  assert.throws(()=>api.buildNotebookReview(state,owner,"suggestion_status",{id:"hierarchy-round-1",status:"approved"},"child-first",now()));
  await apply(api.buildNotebookReview(state,owner,"suggestion_status",{id:"hierarchy-round-0",status:"approved"},"parent-approved",now()));
  await apply(api.buildNotebookReview(state,owner,"suggestion_status",{id:"hierarchy-round-1",status:"approved"},"child-approved",now()));
  assert.equal(task("child-approved-record").parentTaskId,"parent-approved-record");


} finally {sql.close();await rm(dir,{recursive:true,force:true});}
console.log("Task organization passed: one-level hierarchy, automatic completion/reopening, cancellation, scope/cycle checks, grouped and single merges, evidence/attachments/collaborators/dependencies, stale transaction rollback, collapsed filtering, copy hierarchy and no double counting. Live API calls: 0.");
