import { TABLES, MAX_ROWS, MAX_RAW_BYTES, TransferError, createSnapshot } from './transfer-contract.mjs';
export async function exportAuxiliary(db, configuration, workspaceId) {
  if (!db) throw new TransferError('El historial no está disponible.',503);
  if (configuration.PROJECT_OS_BACKEND !== 'supabase') throw new TransferError('La transferencia solo está habilitada para el espacio de producción en Supabase.',409);
  const entries = Object.entries(TABLES);
  // One D1 batch transaction; guards prevent an unbounded or partial download.
  const metrics = entries.map(([table,columns]) => `SELECT COUNT(*) AS rows, COALESCE(SUM(${columns.map(column => `COALESCE(length(CAST("${column}" AS BLOB)),0)`).join('+')}),0) AS bytes FROM "${table}" WHERE user_id = ?`);
  const statements = metrics.map(query => db.prepare(query).bind(workspaceId));
  entries.forEach(([table,columns]) => {
    const guard = metrics.map(query => `SELECT rows,bytes FROM (${query})`).join(' UNION ALL ');
    statements.push(db.prepare(`SELECT ${columns.map(column => `"${column}"`).join(',')} FROM "${table}" WHERE user_id = ? AND (SELECT MAX(rows) <= ? AND SUM(bytes) <= ? FROM (${guard})) ORDER BY id LIMIT ?`).bind(workspaceId,MAX_ROWS,MAX_RAW_BYTES,...entries.map(() => workspaceId),MAX_ROWS));
  });
  const results = await db.batch(statements);
  const sizes = results.slice(0,entries.length).map(result => result.results[0]);
  if (sizes.some(size => size.rows > MAX_ROWS) || sizes.reduce((sum,size) => sum + size.bytes,0) > MAX_RAW_BYTES) throw new TransferError('El historial supera el límite de esta transferencia. No se ha descargado una copia parcial.',413);
  const tables = Object.fromEntries(entries.map(([table],index) => [table,results[index + entries.length].results]));
  return createSnapshot({workspaceId,supabaseUrl:configuration.SUPABASE_URL,sourceUrl:configuration.PROJECT_OS_APP_URL,exportedAt:new Date().toISOString()},tables);
}
