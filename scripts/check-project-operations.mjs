import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openSqlite, migrate, d1Adapter } from "../runtime/sqlite.mjs";

const compiled = await build({ stdin: { contents: ['core-commands', 'operations-commands', 'project-operations', 'workspace-types', 'daily-engine', 'shared-project', 'meeting-analysis'].map(name => `export * from "./${name}";`).join("\n"), resolveDir: fileURLToPath(new URL("../lib/", import.meta.url)) }, bundle: true, format: "esm", platform: "node", write: false });
const directory = await mkdtemp(join(tmpdir(), "project-operations-")), file = join(directory, "fixture.sqlite");
const bundlePath = join(directory, "operations-fixture.mjs");
await writeFile(bundlePath, compiled.outputFiles[0].text);
const api = await import(pathToFileURL(bundlePath).href);
let sql = openSqlite(file); migrate(sql); let db = d1Adapter(sql);
let state = api.emptyWorkspace(), counter = 0;
const userId = "fixture-operations", tableKeys = { projects: "projects", tasks: "tasks", milestones: "milestones", task_dependencies: "dependencies", project_events: "events", project_financials: "financials", project_operations: "operations" };
const camel = row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), value]));
const now = () => new Date(Date.UTC(2026, 9, 11, 14, 0, counter++)).toISOString();
async function apply(plan) {
  const statements = [];
  for (const change of plan.changes) {
    const row = change.row, keys = Object.keys(row), value = v => typeof v === 'boolean' ? Number(v) : v;
    if (change.expected) { const entries = Object.entries(change.expected); statements.push(db.prepare(`SELECT json(CASE WHEN EXISTS (SELECT 1 FROM ${change.table} WHERE id=? AND user_id=? AND ${entries.map(([key]) => `${key} IS ?`).join(' AND ')}) THEN 'true' ELSE 'conflict' END)`).bind(row.id, row.user_id, ...entries.map(([,v]) => value(v)))); }
    if (change.kind === 'insert') statements.push(db.prepare(`INSERT INTO ${change.table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).bind(...keys.map(key => value(row[key]))));
    else if (change.kind === 'delete') statements.push(db.prepare(`DELETE FROM ${change.table} WHERE id=? AND user_id=?`).bind(row.id,row.user_id));
    else { const editable = keys.filter(key => !['id','user_id'].includes(key)); statements.push(db.prepare(`UPDATE ${change.table} SET ${editable.map(key => `${key}=?`).join(',')} WHERE id=? AND user_id=?`).bind(...editable.map(key => value(row[key])),row.id,row.user_id)); }
  }
  await db.batch(statements);
  for (const change of plan.changes) { const key = tableKeys[change.table], row = camel(change.row); state[key] = state[key].filter(item => item.id !== row.id); if (change.kind !== 'delete') state[key].push(row); }
  state = api.deriveWorkspaceState(state); return plan.id;
}
const core = async (action, payload) => apply(api.buildCoreCommand(state,userId,action,payload,crypto.randomUUID(),now()));
const operation = async (action,payload) => apply(api.buildOperationsCommand(state,userId,action,payload,crypto.randomUUID(),now()));
const invalid = (action,payload) => assert.throws(() => api.buildOperationsCommand(state,userId,action,payload,crypto.randomUUID(),now()),api.CoreValidationError);
try {
  const projectId = await core('create_project',{name:'Proyecto de pruebas',operationalStatus:'Activo'});
  const otherProject = await core('create_project',{name:'Proyecto privado',operationalStatus:'Activo'});
  const alice = await operation('save_person',{projectId,name:'Ana',email:'ana@fixture.test',role:'Diseño'});
  const me = await operation('save_person',{projectId,name:'Propietario',isSelf:true});
  const outsider = await operation('save_person',{projectId:otherProject,name:'Persona externa'});
  invalid('save_person',{projectId,name:'Otra ficha mía',isSelf:true});
  const task = await core('create_task',{projectId,title:'Diseñar portada',primaryId:alice,collaboratorIds:[me],plannedStart:'2026-10-12',plannedEnd:'2026-10-15'});
  const prerequisite = await core('create_task',{projectId,title:'Preparar contenido',primaryId:me});
  const foreign = await core('create_task',{projectId:otherProject,title:'Secreto de otro proyecto'});
  await assert.rejects(core('update_task',{id:task,primaryId:outsider}),api.CoreValidationError);
  await assert.rejects(core('update_task',{id:task,collaboratorIds:[alice]}),api.CoreValidationError);
  await assert.rejects(core('update_task',{id:task,plannedStart:'2026-10-20',plannedEnd:'2026-10-19'}),api.CoreValidationError);
  await core('update_task',{id:task,dependsOnTaskIds:[prerequisite]});
  await assert.rejects(core('update_task_status',{id:task,status:'completed'}),api.CoreValidationError);
  await core('update_task_status',{id:prerequisite,status:'completed'});
  const beforeMove = state.tasks.find(t => t.id === task);
  await core('update_task',{id:task,plannedStart:'2026-10-14',plannedEnd:'2026-10-17'});
  assert.equal(state.tasks.find(t => t.id === task).deadline,beforeMove.deadline);
  assert.equal(state.tasks.find(t => t.id === task).tentativeDeliveryDate,beforeMove.tentativeDeliveryDate);
  const quotas = [{id:'q1',name:'Anticipo',percentage:33.33},{id:'q2',name:'Avance',percentage:33.33},{id:'q3',name:'Entrega',percentage:33.34}];
  invalid('save_agreement',{projectId,direction:'income',mode:'fixed',title:'Inválido',currency:'COP',totalValue:1000,startDate:'2026-10-11',installments:[{name:'Cuota',percentage:90}]});
  const income = await operation('save_agreement',{projectId,direction:'income',mode:'fixed',title:'Contrato',currency:'COP',totalValue:1000,startDate:'2026-10-11',installments:quotas});
  let data = api.operationsFor(state,projectId), agreement = data.agreements.find(a => a.id === income), period = agreement.periods[0];
  assert.deepEqual(period.installments.map(i => i.amount),[333,333,334]);
  await operation('record_installment_payment',{projectId,agreementId:income,periodId:period.id,installmentId:'q1',amount:100,date:'2026-10-11'});
  invalid('record_installment_payment',{projectId,agreementId:income,periodId:period.id,installmentId:'q1',amount:234,date:'2026-10-11'});
  invalid('save_agreement',{projectId,id:income,direction:'income',mode:'fixed',title:'Contrato',currency:'USD',totalValue:1200,startDate:'2026-10-11',installments:quotas,reason:'Cambio'});
  invalid('save_agreement',{projectId,id:income,direction:'income',mode:'fixed',title:'Contrato',currency:'COP',totalValue:1200,startDate:'2026-10-11',installments:[{id:'nuevo',name:'Nueva',percentage:100}],reason:'Cambio'});
  await operation('save_agreement',{projectId,id:income,direction:'income',mode:'fixed',title:'Contrato',currency:'COP',totalValue:1200,startDate:'2026-10-11',installments:quotas,reason:'Mayor alcance'});
  data=api.operationsFor(state,projectId); agreement=data.agreements.find(a=>a.id===income);
  assert.equal(agreement.revisions.length,2); assert.equal(api.agreementTotals(data,agreement).paid,100);
  const expense=await operation('save_agreement',{projectId,direction:'expense',mode:'finite',title:'Diseño de Ana',personId:alice,currency:'COP',totalValue:600,startDate:'2026-10-31',installments:[{id:'e1',name:'Mes 1',percentage:50,dueDate:''},{id:'e2',name:'Mes 2',percentage:50,dueDate:''}]});
  data=api.operationsFor(state,projectId); const expenseAgreement=data.agreements.find(a=>a.id===expense);
  assert.equal(expenseAgreement.periods[0].installments[1].dueDate,'2026-11-30');
  await operation('save_budget',{projectId,currency:'COP',amount:900});
  await operation('record_installment_payment',{projectId,agreementId:expense,periodId:expenseAgreement.periods[0].id,installmentId:'e1',amount:300,date:'2026-10-11'});
  const recurring=await operation('save_agreement',{projectId,direction:'income',mode:'periodic',title:'Soporte',currency:'USD',totalValue:200,startDate:'2026-01-31',installments:[{id:'monthly',name:'Mensual',percentage:100,dueDate:'2026-01-31'}]});
  await operation('issue_period',{projectId,agreementId:recurring});
  data=api.operationsFor(state,projectId); let monthly=data.agreements.find(a=>a.id===recurring);
  assert.equal(monthly.periods[1].startDate,'2026-02-28'); assert.equal(monthly.periods[1].installments[0].dueDate,'2026-02-28');
  await operation('save_agreement',{projectId,id:recurring,direction:'income',mode:'periodic',title:'Soporte',currency:'USD',totalValue:250,startDate:'2026-01-31',installments:[{id:'monthly',name:'Mensual',percentage:100,dueDate:'2026-01-31'}],reason:'Nueva tarifa'});
  await operation('issue_period',{projectId,agreementId:recurring}); monthly=api.operationsFor(state,projectId).agreements.find(a=>a.id===recurring);
  assert.equal(monthly.periods[0].totalValue,200); assert.equal(monthly.periods[2].totalValue,250); assert.equal(monthly.periods[2].startDate,'2026-03-31');
  await core('update_financials',{projectId,totalValue:500,currency:'COP'}); await core('record_payment',{projectId,amount:125});
  await operation('save_agreement',{projectId,direction:'income',mode:'fixed',title:'Saldo anterior',currency:'COP',totalValue:500,startDate:'2026-10-11',installments:[{id:'old',name:'Total',percentage:100}],importLegacy:true});
  data=api.operationsFor(state,projectId); assert.equal(data.movements.filter(m=>m.opening).reduce((sum,m)=>sum+m.amount,0),125);
  assert.equal(api.financeTotals(state,projectId).find(t=>t.currency==='COP').income,1700);
  await assert.rejects(core('record_payment',{projectId,amount:1}),api.CoreValidationError);
  await operation('add_task_comment',{projectId,taskId:task,personId:alice,body:'Portada en revisión'});
  invalid('add_task_comment',{projectId,taskId:foreign,body:'Fuera del proyecto'});
  const projection=api.sharedProjection(state,projectId,alice);
  assert.deepEqual(projection.tasks.map(t=>t.id),[task]);
  const serialized=JSON.stringify(projection);
  for(const forbidden of ['fixture-operations','ana@fixture.test','Contrato','Secreto de otro proyecto','tokenHash','shared-deliveries','totalValue','agreementId'])assert.ok(!serialized.includes(forbidden),forbidden);
  const stale=api.buildOperationsCommand(state,userId,'save_budget',{projectId,currency:'COP',amount:950},crypto.randomUUID(),now());
  await operation('save_budget',{projectId,currency:'COP',amount:1000});
  const eventsBefore=state.events.length; await assert.rejects(apply(stale)); assert.equal(state.events.length,eventsBefore);
  const identicalTime=api.operationsRecord(state,projectId).updatedAt;
  const sameMillisecond=api.buildOperationsCommand(state,userId,'save_budget',{projectId,currency:'COP',amount:1150},crypto.randomUUID(),identicalTime);
  await apply(api.buildOperationsCommand(state,userId,'save_budget',{projectId,currency:'COP',amount:1000},crypto.randomUUID(),identicalTime));
  await assert.rejects(apply(sameMillisecond));assert.equal(api.operationsFor(state,projectId).budgets[0].amount,1000);
  invalid('save_budget',{projectId,currency:'COP',amount:1200,operationsUpdatedAt:'stale'});
  const plan=api.planDay(state,{day:'2026-10-12',start:'08:00',end:'18:00',breakMinutes:10},new Date('2026-10-11T12:00:00Z'));
  assert.ok(plan.blocks.every(b=>api.isMyTask(state,state.tasks.find(t=>t.id===b.taskId))));
  // Reopen the real SQLite database: operations and movements remain intact.
  const expected=sql.prepare('SELECT data FROM project_operations WHERE project_id=?').get(projectId).data;
  sql.close();sql=openSqlite(file);migrate(sql);db=d1Adapter(sql);
  assert.equal(sql.prepare('SELECT data FROM project_operations WHERE project_id=?').get(projectId).data,expected);
  console.log('Project operations passed: exact percentages/rounding, partial receipts and expenses, immutable movements, revisions, both recurrence modes, legacy balances, project-scoped assignments, Gantt dates, personal planning, share projection, atomic conflicts and restart persistence. Live API calls: 0.');
} finally { sql.close(); await rm(directory,{recursive:true,force:true}); }
