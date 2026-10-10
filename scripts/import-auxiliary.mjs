import { DatabaseSync } from 'node:sqlite';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openSqlite, migrate } from '../runtime/sqlite.mjs';
import { MAX_BACKUP_BYTES } from '../runtime/transfer-contract.mjs';
import { importAuxiliary } from '../runtime/import-auxiliary.mjs';
const args = process.argv.slice(2);
if (![1,2].includes(args.length) || (args[1] && args[1] !== '--apply')) throw new Error('Usage: node scripts/import-auxiliary.mjs /private/backup.json [--apply]. Default: dry-run.');
const workspace = process.env.PROJECT_OS_WORKSPACE_ID, supabase = process.env.SUPABASE_URL;
if (!workspace || !supabase || !process.env.PROJECT_OS_DATA_DIR) throw new Error('Set PROJECT_OS_WORKSPACE_ID, SUPABASE_URL and PROJECT_OS_DATA_DIR for the destination.');
const backup = resolve(args[0]), file = join(resolve(process.env.PROJECT_OS_DATA_DIR),'project-os.sqlite');
if (statSync(backup).size > MAX_BACKUP_BYTES) throw new Error('Backup too large');
const snapshot = JSON.parse(readFileSync(backup,'utf8')), apply = args[1] === '--apply';
const sql = apply ? openSqlite(file) : existsSync(file) ? new DatabaseSync(file,{readOnly:true}) : openSqlite(':memory:');
try {
  if (apply || !existsSync(file)) migrate(sql);
  console.log(JSON.stringify(await importAuxiliary(sql,snapshot,workspace,supabase,{apply})));
} finally { sql.close(); }
