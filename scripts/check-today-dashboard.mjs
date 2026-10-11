import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openSqlite, migrate } from "../runtime/sqlite.mjs";

const directory = await mkdtemp(join(tmpdir(), "today-dashboard-"));
try {
  const result = await build({ stdin: { contents: ['today-dashboard','core-commands','workspace-types','project-operations','daily-engine'].map(name => `export * from './${name}';`).join('\n'), resolveDir: fileURLToPath(new URL('../lib/', import.meta.url)) }, bundle: true, format: 'esm', platform: 'node', write: false });
  const file = join(directory,'today.mjs'); await writeFile(file,result.outputFiles[0].text);
  const api = await import(pathToFileURL(file));
  let state = api.emptyWorkspace(), counter = 0;
  const now = '2026-10-11T04:30:00Z', user = 'fixture-today'; // Still October 10 in Bogotá.
  const camel = row => Object.fromEntries(Object.entries(row).map(([key,value]) => [key.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),value]));
  const tableKeys = {projects:'projects',tasks:'tasks',project_operations:'operations',project_events:'events',task_dependencies:'dependencies'};
  const sql = openSqlite(join(directory,'fixture.sqlite')); migrate(sql);
  const command = (action,payload) => {
    const plan = api.buildCoreCommand(state,user,action,payload,`event-${++counter}`,now,()=>`row-${++counter}`);
    sql.exec('BEGIN');
    try {
      for (const change of plan.changes) {
        const row=change.row, keys=Object.keys(row), value=v=>typeof v==='boolean'?Number(v):v;
        if (change.kind === 'insert') sql.prepare(`INSERT INTO ${change.table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>value(row[k])));
        else if (change.kind === 'update') { const editable=keys.filter(k=>!['id','user_id'].includes(k)); sql.prepare(`UPDATE ${change.table} SET ${editable.map(k=>`${k}=?`).join(',')} WHERE id=? AND user_id=?`).run(...editable.map(k=>value(row[k])),row.id,user); }
      }
      sql.exec('COMMIT');
    } catch (error) { sql.exec('ROLLBACK'); throw error; }
    for (const change of plan.changes) { const key=tableKeys[change.table],row=camel(change.row); state[key]=state[key].filter(r=>r.id!==row.id); if(change.kind!=='delete')state[key].push(row); }
    state=api.deriveWorkspaceState(state);return plan;
  };
  const id=command('create_project',{name:'Diseño',operationalStatus:'Activo',projectPlannedStart:'2026-10-01',projectActualStart:'2026-10-02',targetEndDate:'2026-10-20'}).id;
  const other=command('create_project',{name:'Desarrollo',operationalStatus:'Por iniciar'}).id;
  command('create_project',{name:'Pausado',operationalStatus:'Pausado'});
  command('create_task',{projectId:id,title:'Vencida',deadline:'2026-10-09'});
  command('create_task',{projectId:id,title:'Hoy',deadline:'2026-10-10'});
  command('create_task',{projectId:id,title:'Después',deadline:'2026-10-15'});
  command('create_task',{projectId:id,title:'Sin fecha',tentativeDeliveryDate:'2026-10-01'});
  command('create_task',{projectId:id,title:'Hecha',status:'completed',deadline:'2026-10-01'});
  command('create_task',{projectId:id,title:'Cancelada',status:'cancelled'});
  const project=state.projects.find(p=>p.id===id);
  assert.equal(api.bogotaDay(new Date(now)),'2026-10-10');
  assert.deepEqual(api.projectScope(state,false).map(p=>p.name),['Diseño','Desarrollo']);
  assert.equal(api.projectScope(state,true).length,3);
  assert.deepEqual(api.taskCounts(state.tasks),{total:5,pending:4,completed:1});
  assert.equal(api.deadlineSignal(state.tasks.find(t=>t.title==='Sin fecha'),'2026-10-10').days,null);
  assert.equal(api.deadlineSignal(state.tasks.find(t=>t.title==='Vencida'),'2026-10-10').label,'1 día de atraso');
  assert.equal(api.deadlineSignal(state.tasks.find(t=>t.title==='Hecha'),'2026-10-10').kind,'closed');
  assert.deepEqual(api.sortAgenda(state.tasks.filter(t=>api.matchesMetric(t,'pending'))).map(t=>t.title),['Vencida','Hoy','Después','Sin fecha']);
  const progress=api.projectProgress(state,project,'2026-10-10');
  assert.equal(progress.completedPercent,20);assert.equal(progress.cancelled,1);assert.equal(progress.overdue,1);
  assert.equal(progress.timePercent,44);assert.equal(progress.remaining,10);assert.equal(progress.startBasis,'Inicio real');
  assert.equal(api.projectProgress(state,project,'2026-09-30').timePercent,0);
  assert.equal(api.projectProgress(state,project,'2026-10-20').timePercent,100);
  assert.equal(api.projectProgress(state,project,'2026-11-01').timePercent,100);
  assert.equal(api.projectProgress(state,state.projects.find(p=>p.id===other)).timePercent,null);
  command('update_project',{id,name:'Diseño actualizado'});
  assert.deepEqual(api.operationsFor(state,id).schedule,{plannedStart:'2026-10-01',actualStart:'2026-10-02'});
  assert.throws(()=>command('update_project',{id,projectPlannedStart:'2026-10-22'}),api.CoreValidationError);
  assert.throws(()=>command('update_project',{id,projectActualStart:'2026-10-11'}),api.CoreValidationError);
  assert.throws(()=>command('update_project',{id,projectActualStart:'2026-02-30'}),api.CoreValidationError);
  assert.throws(()=>command('update_project',{id,projectActualStart:'2026-10-03',operationsUpdatedAt:'stale'}),api.CoreValidationError);
  assert.deepEqual(JSON.parse(sql.prepare('SELECT data FROM project_operations WHERE project_id=?').get(id).data).schedule,{plannedStart:'2026-10-01',actualStart:'2026-10-02'});
  command('update_project',{id,projectActualStart:''});
  assert.equal(api.projectProgress(state,state.projects.find(p=>p.id===id),'2026-10-10').startBasis,'Inicio planificado');
  assert.equal(api.projectProgress(state,state.projects.find(p=>p.id===id),'2026-10-10').timePercent,47);
  const assigned=api.emptyOperations();assigned.people=[{id:'self',name:'Yo',active:true,isSelf:true},{id:'colleague',name:'Ana',active:true,isSelf:false}];
  assigned.taskDetails[state.tasks[0].id]={primaryId:'colleague',collaboratorIds:[],plannedStart:null,plannedEnd:null,columnId:null};
  state.operations=state.operations.map(row=>row.projectId===id?{...row,data:JSON.stringify(assigned)}:row);
  assert.equal(api.dashboardTasks(state,[project],'mine').length,5);
  assert.equal(api.dashboardTasks(state,[project],'all').length,6);
  state.tasks[1]={...state.tasks[1],isBlocked:true,blockingReason:'Espera'};
  assert.ok(!api.recommendedTasks(state,state.tasks,'2026-10-10').some(t=>t.id===state.tasks[1].id));
  assert.ok(api.recommendedTasks(state,state.tasks,'2026-10-10').length<=3);
  sql.close();
  console.log('Today dashboard passed: Bogotá dates, project/person scopes, KPI totals, cancellations, tentative dates, overdue ordering, task/time progress, missing dates, executable recommendations and atomic persisted project starts. Live API calls: 0.');
} finally { await rm(directory,{recursive:true,force:true}); }
