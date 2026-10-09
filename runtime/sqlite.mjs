import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

export function openSqlite(file) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const sql = new DatabaseSync(file);
  sql.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  return sql;
}

// Run once at process startup, never during an HTTP request. Existing migrations
// are immutable; an altered applied migration fails instead of rewriting data.
export function migrate(sql, directory = resolve(process.cwd(), "drizzle")) {
  sql.exec("CREATE TABLE IF NOT EXISTS _node_migrations (tag TEXT PRIMARY KEY, hash TEXT NOT NULL, applied_at TEXT NOT NULL)");
  const journal = JSON.parse(readFileSync(`${directory}/meta/_journal.json`, "utf8"));
  for (const entry of journal.entries) {
    const source = readFileSync(`${directory}/${entry.tag}.sql`, "utf8");
    const hash = createHash("sha256").update(source).digest("hex");
    const previous = sql.prepare("SELECT hash FROM _node_migrations WHERE tag = ?").get(entry.tag);
    if (previous) { if (previous.hash !== hash) throw new Error("An applied migration changed; restore the original migration."); continue; }
    sql.exec("BEGIN IMMEDIATE");
    try {
      sql.exec(source);
      sql.prepare("INSERT INTO _node_migrations VALUES (?, ?, ?)").run(entry.tag, hash, new Date().toISOString());
      sql.exec("COMMIT");
    } catch (error) { sql.exec("ROLLBACK"); throw error; }
  }
}

// Small D1 compatibility layer so the proven transactional queries remain the
// same in Workers and Node. batch is all-or-nothing, including SELECT guards.
export function d1Adapter(sql) {
  function prepare(query, values = []) {
    function execute(arrayRows = false) {
      const statement = sql.prepare(query);
      if (arrayRows) statement.setReturnArrays(true);
      const before = Number(sql.prepare("SELECT total_changes() AS n").get().n);
      const rows = statement.all(...values);
      const changes = Number(sql.prepare("SELECT total_changes() AS n").get().n) - before;
      const last = Number(sql.prepare("SELECT last_insert_rowid() AS n").get().n);
      return { results: rows, success: true, meta: { changes, last_row_id: last, duration: 0, rows_read: rows.length, rows_written: changes } };
    }
    return {
      bind(...args) { return prepare(query, args.map(value => value === undefined ? null : value)); },
      async first(column) { const row = execute().results[0]; return row ? (column ? row[column] : row) : null; },
      async all() { return execute(); },
      async raw(options) { const rows = execute(true).results; return options?.columnNames ? [sql.prepare(query).columns().map(c => c.name), ...rows] : rows; },
      async run() { return execute(); },
      _execute: execute,
    };
  }
  return {
    prepare,
    async batch(statements) {
      sql.exec("BEGIN IMMEDIATE");
      try { const results = statements.map(statement => statement._execute()); sql.exec("COMMIT"); return results; }
      catch (error) { sql.exec("ROLLBACK"); throw error; }
    },
    async exec(query) { sql.exec(query); return { count: 1, duration: 0 }; },
  };
}
