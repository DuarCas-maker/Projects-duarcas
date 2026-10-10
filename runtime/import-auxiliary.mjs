import { TABLES, validateSnapshot, snapshotSummary, TransferError } from './transfer-contract.mjs';
export function requireAuxiliaryImport(sql, workspace) {
  const exists = sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_auxiliary_imports'").get();
  if (!exists || !sql.prepare('SELECT 1 FROM _auxiliary_imports WHERE workspace_id = ?').get(workspace)) throw new Error('Import the authenticated auxiliary backup for this workspace before starting Docker.');
}
export async function importAuxiliary(sql, snapshot, workspace, supabase, {apply = false} = {}) {
  const verified = await validateSnapshot(snapshot,workspace,supabase), summary = snapshotSummary(verified);
  // Only initial transfer or identical replay. Never overwrite/merge live histories.
  if (apply) sql.exec('BEGIN IMMEDIATE');
  try {
    const exists = sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_auxiliary_imports'").get();
    const marker = exists && sql.prepare('SELECT sha256 FROM _auxiliary_imports WHERE workspace_id = ?').get(workspace);
    if (marker && marker.sha256 !== verified.sha256) throw new TransferError('Ya hay un historial importado. No se sobrescribe ni combina con otra copia.');
    const inserts = [];
    for (const [table,columns] of Object.entries(TABLES)) {
      if (sql.prepare(`PRAGMA table_info("${table}")`).all().map(column => column.name).join('|') !== columns.join('|')) throw new TransferError('El esquema de destino no coincide con la versión del respaldo.');
      if (sql.prepare(`SELECT 1 FROM "${table}" WHERE user_id <> ? LIMIT 1`).get(workspace)) throw new TransferError('El volumen contiene datos de otro espacio.');
      const count = Number(sql.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE user_id = ?`).get(workspace).n);
      if (!marker && count) throw new TransferError('El destino no está vacío. Usa un volumen nuevo y conserva el anterior.');
      if (marker && count !== verified.payload.tables[table].length) throw new TransferError('El historial ya cambió después de la importación. No se restaura sobre él.');
      for (const row of verified.payload.tables[table]) {
        const existing = sql.prepare(`SELECT ${columns.map(column => `"${column}"`).join(',')} FROM "${table}" WHERE id = ?`).get(row.id);
        if (existing) { if (columns.some(column => existing[column] !== row[column])) throw new TransferError('Hay registros distintos con el mismo identificador. No se modifica el destino.'); }
        else inserts.push({table,columns,row});
      }
    }
    if (apply) {
      for (const {table,columns,row} of inserts) sql.prepare(`INSERT INTO "${table}" (${columns.map(column => `"${column}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map(column => row[column]));
      sql.exec('CREATE TABLE IF NOT EXISTS _auxiliary_imports (workspace_id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, exported_at TEXT NOT NULL, imported_at TEXT NOT NULL)');
      sql.prepare('INSERT INTO _auxiliary_imports VALUES (?,?,?,?) ON CONFLICT(workspace_id) DO NOTHING').run(workspace,verified.sha256,verified.payload.exportedAt,new Date().toISOString());
      sql.exec('COMMIT');
    }
    return {...summary,mode:apply ? 'imported' : 'dry-run',inserted:inserts.length};
  } catch (error) { if (apply) sql.exec('ROLLBACK'); throw error; }
}
