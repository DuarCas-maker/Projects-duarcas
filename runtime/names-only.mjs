import { createHash } from 'node:crypto';
import { TABLES, httpsOrigin } from './transfer-contract.mjs';

const operationalTables = ['projects','milestones','tasks','task_dependencies','task_evidence','project_financials','project_events','ai_suggestions','inbox_items','calendar_blocks','knowledge_items','repositories'];
const fail = message => { throw new Error(message); };
const hash = value => createHash('sha256').update(value).digest('hex');

export function namesOnlySettings(env) {
  if (!/^clean_[a-f0-9]{32}$/.test(env.PROJECT_OS_WORKSPACE_ID ?? '')) fail('Names-only initialization requires a new clean_ workspace, never the existing Site workspace.');
  const raw = env.PROJECT_OS_INITIAL_PROJECT_NAMES;
  if (typeof raw !== 'string' || raw.length > 32000) fail('Set the names-only project list as a bounded JSON array.');
  let names;
  try { names = JSON.parse(raw); } catch { fail('The initial project list is not valid JSON.'); }
  if (!Array.isArray(names) || !names.length || names.length > 100 || names.some(name => typeof name !== 'string' || !name.trim() || name.trim().length > 180)) fail('Provide between 1 and 100 project names, without other fields.');
  names = names.map(name => name.trim());
  if (new Set(names.map(name => name.toLocaleLowerCase('es'))).size !== names.length) fail('The initial project names must not be duplicated.');
  const origin = httpsOrigin(env.SUPABASE_URL);
  if (!env.SUPABASE_SECRET_KEY?.trim()) fail('The Supabase server-only secret is required.');
  const workspace = env.PROJECT_OS_WORKSPACE_ID;
  return { workspace, names, origin, secret: env.SUPABASE_SECRET_KEY.trim(), fingerprint: hash(JSON.stringify({workspace,origin,names})) };
}

export function namesOnlyProjectRows(settings, now = new Date().toISOString()) {
  return settings.names.map(name => ({
    id: `project_${hash(`${settings.workspace}\n${name}`).slice(0,32)}`,
    user_id: settings.workspace, name, short_code: name.slice(0,4).toUpperCase(),
    description: '', project_type: 'Por alcance', operational_status: 'Por iniciar',
    commercial_status: 'Sin definir', priority: 3, strategic_priority: 3,
    target_end_date: null, current_summary: '', next_step_summary: '', blocked_reason: null,
    accent: 'blue', created_at: now, updated_at: now,
  }));
}

function receipt(sql) {
  return sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_workspace_initializations'").get()
    ? sql.prepare('SELECT * FROM _workspace_initializations').all() : [];
}

function verifyLocal(sql, settings, initialized) {
  const imported = sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_auxiliary_imports'").get();
  if (imported && sql.prepare('SELECT 1 FROM _auxiliary_imports LIMIT 1').get()) fail('This volume contains an imported history. Names-only initialization cannot replace it.');
  for (const table of [...operationalTables,...Object.keys(TABLES)]) {
    if (sql.prepare(`SELECT 1 FROM "${table}" ${initialized ? 'WHERE user_id <> ?' : ''} LIMIT 1`).get(...(initialized ? [settings.workspace] : []))) fail('The volume contains existing data; nothing is cleared or overwritten.');
  }
}

// Startup only, not an API endpoint. All writes are inserts into a newly chosen
// workspace. A persistent local receipt prevents reseeding or silently accepting
// a replacement/lost volume, and allows a failed initial attempt to resume.
export async function initializeNamesOnly(sql, env, fetcher = fetch) {
  const settings = namesOnlySettings(env);
  const receipts = receipt(sql);
  if (receipts.length > 1 || receipts.some(row => row.workspace_id !== settings.workspace || row.supabase_url !== settings.origin || row.fingerprint !== settings.fingerprint || !['preparing','ready'].includes(row.phase))) fail('The volume belongs to another initialization or the initial configuration changed.');
  const previous = receipts[0];
  verifyLocal(sql, settings, previous?.phase === 'ready');

  const request = async (table, params, body) => {
    let response;
    try { response = await fetcher(`${settings.origin}/rest/v1/${table}?${params}`, {
      method: body ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(30000),
      headers: { apikey: settings.secret, Authorization: `Bearer ${settings.secret}`, Accept: 'application/json',
        ...(body ? {'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates,return=minimal'} : {}) },
      ...(body ? {body:JSON.stringify(body)} : {}),
    }); } catch { fail('Names-only Supabase transport failed. Startup was stopped.'); }
    // Never print upstream bodies: proxies can echo authorization headers.
    if (!response.ok) fail(`Names-only Supabase request failed (${response.status}).`);
    if (body || response.status === 204) return;
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > 1024 * 1024) fail('Initialization response exceeded its limit.');
    const reader = response.body?.getReader(), parts = []; let bytes = 0;
    if (!reader) fail('Invalid initialization response.');
    try {
      for (;;) {
        const {done,value} = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 1024 * 1024) { await reader.cancel(); fail('Initialization response exceeded its limit.'); }
        parts.push(value);
      }
    } finally { reader.releaseLock(); }
    const buffer = new Uint8Array(bytes); let offset = 0;
    for (const part of parts) { buffer.set(part,offset); offset += part.byteLength; }
    const text = new TextDecoder().decode(buffer);
    let rows; try { rows = JSON.parse(text); } catch { fail('Invalid initialization response.'); }
    if (!Array.isArray(rows)) fail('Invalid initialization response.');
    return rows;
  };
  const params = (select, limit) => new URLSearchParams({select,user_id:`eq.${settings.workspace}`,limit:String(limit)});
  const marker = async () => {
    const rows = await request('workspace_bootstrap', params('user_id',2));
    if (rows.some(row => row.user_id !== settings.workspace) || rows.length > 1) fail('Unexpected workspace marker.');
    return rows.length === 1;
  };
  const exists = await marker();
  if (previous?.phase === 'ready') {
    if (!exists) fail('The initialized Supabase workspace is unavailable; it is never recreated automatically.');
    return {mode:'names-only',phase:'ready',initialized:false,projects:settings.names.length};
  }
  if (!previous && exists) fail('This workspace already exists but its original volume is missing. Restore that volume instead of resetting history.');

  const wanted = namesOnlyProjectRows(settings);
  const remoteProjects = await request('projects',params('*',101));
  if (!previous && remoteProjects.length) fail('The destination workspace is not empty. Select a new clean_ workspace.');
  for (const row of remoteProjects) {
    const expected = wanted.find(item => item.id === row.id);
    if (!expected || Object.keys(expected).some(key => !['created_at','updated_at'].includes(key) && expected[key] !== row[key])) fail('The destination contains changed or unrelated project data; nothing is overwritten.');
  }
  for (const table of operationalTables.filter(table => table !== 'projects')) {
    if ((await request(table,params('id',1))).length) fail('The destination already has content. Names-only initialization cannot reset it.');
  }
  if (exists && remoteProjects.length !== wanted.length) fail('The initial workspace marker does not match its project list.');
  if (!previous) {
    sql.exec('BEGIN IMMEDIATE');
    try {
      verifyLocal(sql,settings,false);
      if (receipt(sql).length) fail('Initialization already started in another process.');
      sql.exec('CREATE TABLE IF NOT EXISTS _workspace_initializations (workspace_id TEXT PRIMARY KEY, supabase_url TEXT NOT NULL, fingerprint TEXT NOT NULL, phase TEXT NOT NULL, created_at TEXT NOT NULL)');
      sql.prepare('INSERT INTO _workspace_initializations VALUES (?,?,?,?,?)').run(settings.workspace,settings.origin,settings.fingerprint,'preparing',new Date().toISOString());
      sql.exec('COMMIT');
    } catch (error) { sql.exec('ROLLBACK'); throw error; }
  }
  const missing = wanted.filter(row => !remoteProjects.some(existing => existing.id === row.id));
  if (missing.length) await request('projects',new URLSearchParams({on_conflict:'id'}),missing);
  const saved = await request('projects',params('*',101));
  if (saved.length !== wanted.length || wanted.some(expected => !saved.some(row => row.id === expected.id && Object.keys(expected).every(key => ['created_at','updated_at'].includes(key) || expected[key] === row[key])))) fail('The initial projects could not be verified. Startup was stopped.');
  if (!exists) await request('workspace_bootstrap',new URLSearchParams({on_conflict:'user_id'}),{user_id:settings.workspace,seeded_at:new Date().toISOString()});
  if (!await marker()) fail('The new workspace marker could not be verified.');
  sql.prepare("UPDATE _workspace_initializations SET phase='ready' WHERE workspace_id=? AND fingerprint=?").run(settings.workspace,settings.fingerprint);
  return {mode:'names-only',phase:'ready',initialized:true,projects:wanted.length};
}
