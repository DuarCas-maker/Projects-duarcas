import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openSqlite,migrate,d1Adapter } from '../runtime/sqlite.mjs';
import { TABLES,createSnapshot,validateSnapshot,MAX_RAW_BYTES } from '../runtime/transfer-contract.mjs';
import { exportAuxiliary } from '../runtime/export-auxiliary.mjs';
import { importAuxiliary,requireAuxiliaryImport } from '../runtime/import-auxiliary.mjs';
const directory = await mkdtemp(join(tmpdir(),'project-os-transfer-'));
const workspace = 'existing-workspace', supabase = 'https://supabase.fixture.test';
const config = {PROJECT_OS_BACKEND:'supabase',SUPABASE_URL:supabase,PROJECT_OS_APP_URL:'https://source.fixture.test'};
const metadata = {workspaceId:workspace,supabaseUrl:supabase,sourceUrl:config.PROJECT_OS_APP_URL,exportedAt:'2026-10-10T00:00:00.000Z'};
const source = openSqlite(':memory:'); migrate(source);
let destination = openSqlite(join(directory,'history.sqlite')); migrate(destination);
function fixture(table,owner = workspace) {
  const numeric = ['input_tokens','output_tokens','attempts'];
  return Object.fromEntries(TABLES[table].map(column => [column,column === 'id' ? `${table}-${owner}` : column === 'user_id' ? owner : column === 'status' ? 'completed' : numeric.includes(column) ? 1 : column === 'indexed_at' && table === 'project_brain_sources' ? null : column === 'result' ? JSON.stringify({text:'Transcripción completa '.repeat(3000)}) : 'fixture']));
}
function insert(sql,table,row) { const columns = TABLES[table]; sql.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map(column => row[column])); }
try {
  for (const table of Object.keys(TABLES)) { insert(source,table,fixture(table)); insert(source,table,fixture(table,'other-workspace')); }
  const snapshot = await exportAuxiliary(d1Adapter(source),config,workspace);
  assert.equal(Object.values(snapshot.payload.tables).flat().length,4);
  assert.ok(snapshot.payload.tables.ai_runs[0].result.length > 50000);
  await validateSnapshot(snapshot,workspace,supabase);
  await assert.rejects(validateSnapshot(snapshot,'another-workspace',supabase));
  await assert.rejects(validateSnapshot(snapshot,workspace,'https://other.fixture.test'));
  const tampered = structuredClone(snapshot); tampered.payload.tables.ai_runs[0].result = 'changed';
  await assert.rejects(validateSnapshot(tampered,workspace,supabase));
  const mixed = structuredClone(snapshot); mixed.payload.tables.ai_runs[0].user_id = 'another-workspace';
  await assert.rejects(validateSnapshot(mixed,workspace,supabase));
  const unknown = structuredClone(snapshot); unknown.payload.tables.secrets = [];
  await assert.rejects(validateSnapshot(unknown,workspace,supabase));
  const typed = structuredClone(snapshot); typed.payload.tables.ai_runs[0].input_tokens = '1';
  await assert.rejects(validateSnapshot(typed,workspace,supabase));
  const duplicate = structuredClone(snapshot); duplicate.payload.tables.ai_runs.push(duplicate.payload.tables.ai_runs[0]);
  await assert.rejects(validateSnapshot(duplicate,workspace,supabase));
  assert.throws(() => requireAuxiliaryImport(destination,workspace));
  assert.equal((await importAuxiliary(destination,snapshot,workspace,supabase)).mode,'dry-run');
  assert.equal(destination.prepare('SELECT COUNT(*) AS n FROM ai_runs').get().n,0);
  destination.exec("CREATE TRIGGER reject_fixture BEFORE INSERT ON brain_requests BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
  await assert.rejects(importAuxiliary(destination,snapshot,workspace,supabase,{apply:true}));
  assert.equal(destination.prepare('SELECT COUNT(*) AS n FROM ai_runs').get().n,0);
  assert.throws(() => requireAuxiliaryImport(destination,workspace));
  destination.exec('DROP TRIGGER reject_fixture');
  assert.equal((await importAuxiliary(destination,snapshot,workspace,supabase,{apply:true})).inserted,4);
  requireAuxiliaryImport(destination,workspace);
  assert.equal((await importAuxiliary(destination,snapshot,workspace,supabase,{apply:true})).inserted,0);
  destination.close(); destination = openSqlite(join(directory,'history.sqlite')); migrate(destination);
  assert.equal(destination.prepare('SELECT result FROM ai_runs').get().result,snapshot.payload.tables.ai_runs[0].result);
  requireAuxiliaryImport(destination,workspace);
  const newer = await createSnapshot({...metadata,exportedAt:'2026-10-11T00:00:00.000Z'},snapshot.payload.tables);
  await assert.rejects(importAuxiliary(destination,newer,workspace,supabase,{apply:true}));
  destination.prepare('UPDATE ai_runs SET result = ?').run('new activity');
  await assert.rejects(importAuxiliary(destination,snapshot,workspace,supabase,{apply:true}));
  const occupied = openSqlite(':memory:'); migrate(occupied); insert(occupied,'ai_runs',fixture('ai_runs'));
  await assert.rejects(importAuxiliary(occupied,snapshot,workspace,supabase,{apply:true})); occupied.close();
  await assert.rejects(exportAuxiliary(d1Adapter(source),{...config,PROJECT_OS_BACKEND:'d1'},workspace));
  source.prepare('UPDATE knowledge_search SET content = ? WHERE user_id = ?').run('x'.repeat(MAX_RAW_BYTES+1),workspace);
  await assert.rejects(exportAuxiliary(d1Adapter(source),config,workspace),error => error.status === 413);
  console.log('Transfer passed: consistent workspace-only export, full text, integrity/schema/origin validation, dry-run, atomic rollback, idempotency, persistence, no overwrite and size limits. Live API calls: 0.');
} finally { source.close(); destination.close(); await rm(directory,{recursive:true,force:true}); }
