/**
 * A SQL dump of the database, for Cloudflare D1. D1 cannot import a raw .sqlite file: the
 * database is loaded with `wrangler d1 execute <db> --file=out/shotmap.sql`. The dump is
 * literal SQL (no bound parameters), with no BEGIN TRANSACTION or COMMIT (they make D1 fail
 * with "cannot start a transaction within a transaction"), and every statement stays under
 * D1's 100,000-byte limit. The SQLite file stays the source of truth; D1 is a deploy target.
 *
 * Limits, from Cloudflare's documentation (checked 2026-10-26): 100,000 bytes per SQL
 * statement, 2,000,000 bytes per row, 100 bound parameters (not used here), a 5 GB import file.
 */
import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/** Under D1's limit of 100,000 bytes per statement, with room to spare. */
export const MAX_STATEMENT_BYTES = 90_000;
export const MAX_ROWS_PER_INSERT = 100;

/** Parents before children, so foreign keys hold as the rows arrive. */
export const TABLE_ORDER = [
  'meta',
  'competitions',
  'seasons',
  'stages',
  'teams',
  'players',
  'matches',
  'match_players',
  'shots',
  'search_terms',
] as const;

export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`cannot write ${String(value)} as SQL`);
    return String(value);
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
  throw new Error(`cannot write a ${typeof value} as SQL`);
}

/** A CREATE statement as the database stores it, without comments, ending in a semicolon. */
function clean(sql: string): string {
  const lines = sql.split('\n').filter((line) => !line.trim().startsWith('--'));
  return `${lines.join('\n').trim().replace(/;$/, '')};`;
}

const bytes = (text: string): number => new TextEncoder().encode(text).length;

export function buildDump(db: DatabaseSync): string[] {
  const statements: string[] = ['PRAGMA defer_foreign_keys = true;'];
  for (const table of [...TABLE_ORDER].reverse())
    statements.push(`DROP TABLE IF EXISTS ${table};`);

  const tableSql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
  );
  for (const table of TABLE_ORDER) {
    const row = tableSql.get(table) as { sql: string } | undefined;
    if (!row) throw new Error(`the database has no table ${table}`);
    statements.push(clean(row.sql));
  }

  for (const table of TABLE_ORDER) {
    const info = db.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
      pk: number;
    }[];
    const columns = info.map((c) => c.name);
    const order = info
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name)
      .join(', ');
    const head = `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n`;
    const select = db.prepare(
      `SELECT ${columns.join(', ')} FROM ${table}${order ? ` ORDER BY ${order}` : ''}`,
    );
    let batch: string[] = [];
    let size = bytes(head);
    const flush = () => {
      if (batch.length) statements.push(`${head}${batch.join(',\n')};`);
      batch = [];
      size = bytes(head);
    };
    for (const row of select.iterate() as Iterable<Record<string, unknown>>) {
      const tuple = `(${columns.map((c) => sqlLiteral(row[c])).join(', ')})`;
      const add = bytes(tuple) + 2;
      if (batch.length >= MAX_ROWS_PER_INSERT || size + add + 1 > MAX_STATEMENT_BYTES)
        flush();
      batch.push(tuple);
      size += add;
    }
    flush();
  }

  // Indexes last: building them after the rows are in is much faster.
  const indexes = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name",
    )
    .all() as { sql: string }[];
  for (const index of indexes) statements.push(clean(index.sql));
  return statements;
}

export interface DumpSummary {
  statements: number;
  bytes: number;
  largestStatement: number;
}

export function writeDump(dbPath: string, outPath: string): DumpSummary {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const statements = buildDump(db);
    const text = `${statements.join('\n')}\n`;
    writeFileSync(outPath, text);
    return {
      statements: statements.length,
      bytes: bytes(text),
      largestStatement: Math.max(...statements.map(bytes)),
    };
  } finally {
    db.close();
  }
}
