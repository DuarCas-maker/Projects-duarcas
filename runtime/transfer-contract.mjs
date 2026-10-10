// Shared by authenticated Worker export and Node import. No operational data/env.
export const TABLES = {
  ai_runs: ['id','user_id','scope','kind','query','result','status','day_key','created_at','model','input_tokens','output_tokens'],
  project_brain_sources: ['id','user_id','project_id','knowledge_id','title','brain_id','source_id','source_type','external_reference','content_hash','request_id','status','error','indexed_at','created_at'],
  brain_requests: ['id','user_id','project_id','kind','payload_hash','status','day_key','created_at','lease_until','attempts','result'],
  knowledge_search: ['id','user_id','project_id','knowledge_id','fingerprint','content','normalized_content','status','error','indexed_at'],
};
export const MAX_ROWS = 10000;
export const MAX_RAW_BYTES = 8 * 1024 * 1024;
export const MAX_BACKUP_BYTES = 32 * 1024 * 1024;
const encoder = new TextEncoder();
const numeric = new Set(['input_tokens','output_tokens','attempts']);
const nullable = new Set(['project_brain_sources.indexed_at']);
const fields = ['format','schema','workspaceId','supabaseUrl','sourceUrl','exportedAt','tables'];
export class TransferError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'TransferError'; this.status = status; }
}
export function workspaceId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw new TransferError('Identificador de espacio no válido.');
  return value;
}
export function httpsOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new TransferError('Origen HTTPS no válido.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname)) throw new TransferError('Origen HTTPS no válido.');
  return url.origin;
}
function exactKeys(object, expected) {
  if (!object || typeof object !== 'object' || Array.isArray(object) || Object.keys(object).sort().join('|') !== [...expected].sort().join('|')) throw new TransferError('Estructura de respaldo no válida.');
}
function normalize(payload) {
  exactKeys(payload, fields);
  if (payload.format !== 'project-os-auxiliary' || payload.schema !== 1) throw new TransferError('Formato o versión de respaldo incompatible.');
  workspaceId(payload.workspaceId); httpsOrigin(payload.supabaseUrl); httpsOrigin(payload.sourceUrl);
  if (typeof payload.exportedAt !== 'string' || !Number.isFinite(Date.parse(payload.exportedAt))) throw new TransferError('Fecha de respaldo no válida.');
  exactKeys(payload.tables, Object.keys(TABLES));
  const tables = {}; let bytes = 0;
  for (const [table,columns] of Object.entries(TABLES)) {
    const rows = payload.tables[table];
    if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw new TransferError('El respaldo supera el límite de filas.', 413);
    const seen = new Set();
    tables[table] = rows.map(row => {
      exactKeys(row,columns); const normalized = {};
      if (row.user_id !== payload.workspaceId) throw new TransferError('El respaldo contiene datos de otro espacio.');
      if (typeof row.id !== 'string' || !row.id || row.id.length > 1000 || seen.has(row.id)) throw new TransferError('Identificador de registro repetido o no válido.');
      seen.add(row.id);
      for (const column of columns) {
        const value = row[column];
        if (numeric.has(column) ? !Number.isSafeInteger(value) || value < 0 : !(typeof value === 'string' || (value === null && nullable.has(`${table}.${column}`)))) throw new TransferError('Tipo de dato no válido en el respaldo.');
        if (typeof value === 'string') bytes += encoder.encode(value).byteLength;
        normalized[column] = value;
      }
      return normalized;
    }).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }
  if (bytes > MAX_RAW_BYTES) throw new TransferError('El historial supera el límite de esta transferencia. Se requiere una exportación por partes.', 413);
  return {format:payload.format,schema:payload.schema,workspaceId:payload.workspaceId,supabaseUrl:httpsOrigin(payload.supabaseUrl),sourceUrl:httpsOrigin(payload.sourceUrl),exportedAt:payload.exportedAt,tables};
}
async function checksum(payload) {
  const bytes = encoder.encode(JSON.stringify(payload));
  if (bytes.byteLength > MAX_BACKUP_BYTES) throw new TransferError('El respaldo es demasiado grande.', 413);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte => byte.toString(16).padStart(2,'0')).join('');
}
export async function createSnapshot(metadata, tables) {
  const payload = normalize({format:'project-os-auxiliary',schema:1,...metadata,tables});
  return {payload,sha256:await checksum(payload)};
}
export async function validateSnapshot(snapshot, expectedWorkspace, expectedSupabase) {
  exactKeys(snapshot,['payload','sha256']); const payload = normalize(snapshot.payload);
  if (payload.workspaceId !== workspaceId(expectedWorkspace) || payload.supabaseUrl !== httpsOrigin(expectedSupabase)) throw new TransferError('Este respaldo pertenece a otro espacio o instancia de Supabase.');
  if (typeof snapshot.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot.sha256) || await checksum(payload) !== snapshot.sha256) throw new TransferError('El respaldo está incompleto o fue modificado.');
  return {payload,sha256:snapshot.sha256};
}
export function snapshotSummary(snapshot) {
  return {exportedAt:snapshot.payload.exportedAt,sha256:snapshot.sha256,
    counts:Object.fromEntries(Object.entries(snapshot.payload.tables).map(([table,rows]) => [table,rows.length])),
    pending:Object.fromEntries(Object.entries(snapshot.payload.tables).map(([table,rows]) => [table,rows.filter(row => ['pending','processing'].includes(row.status)).length])),
  };
}
