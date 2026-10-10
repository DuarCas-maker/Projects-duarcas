// Test-only preload; never copied to the Docker runner. No live upstream calls.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
if (process.env.PROJECT_OS_NAMES_ONLY_FIXTURE !== 'synthetic-only' || process.env.SUPABASE_URL !== 'https://supabase.fixture.test') throw new Error('Isolated names-only fixture required.');
const file = process.env.PROJECT_OS_NAMES_ONLY_FIXTURE_FILE;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== 'https://supabase.fixture.test') throw new Error('Live upstream calls are forbidden.');
  const state = existsSync(file) ? JSON.parse(readFileSync(file,'utf8')) : {marker:false,projects:[]};
  const table = url.pathname.split('/').at(-1), workspace = process.env.PROJECT_OS_WORKSPACE_ID;
  if (init.method === 'POST') {
    const body = JSON.parse(init.body);
    if (table === 'projects') {
      if (body.some(row=>row.user_id !== workspace)) throw new Error('Wrong fixture workspace');
      for (const row of body) if (!state.projects.some(existing=>existing.id===row.id)) state.projects.push(row);
    } else if (table === 'workspace_bootstrap' && body.user_id === workspace) state.marker=true;
    else throw new Error('Unexpected fixture mutation');
    writeFileSync(file,JSON.stringify(state));
    return new Response(null,{status:204});
  }
  if (init.method !== 'GET' || url.searchParams.get('user_id') !== `eq.${workspace}`) throw new Error('Unexpected fixture read');
  return Response.json(table === 'workspace_bootstrap' ? state.marker ? [{user_id:workspace}] : [] : table === 'projects' ? state.projects : []);
};
