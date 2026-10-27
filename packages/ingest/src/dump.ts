/**
 * A SQL dump of the database, for Cloudflare D1. D1 cannot import a raw .sqlite file: the
 * database is loaded with `wrangler d1 execute <db> --file=out/shotmap.sql`. The dump is
 * literal SQL (no bound parameters), with no BEGIN TRANSACTION or COMMIT (they make D1 fail
 * with "cannot start a transaction within a transaction"), and every statement stays under
 * D1's 100,000-byte limit. The SQLite file stays the source of truth; D1 is a deploy target.
 *
 * Limits, from Cloudflare's documentation (checked 2026-10-26 and 2026-10-27): 100,000 bytes per
 * SQL statement, 2,000,000 bytes per row, 100 bound parameters (not used here), a 5 GB import
 * file, and on the Free plan 100,000 rows written a day, index entries included (a dump of the
 * whole catalogue is several times that, so it can also be cut into parts, see `cutIntoParts`).
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

export interface DumpOptions {
  /**
   * For loading in parts: the indexes are created while the tables are empty (which writes
   * nothing), so every part's rows write their own index entries and no part has to build an index
   * for a whole table at once; and each row is INSERT OR REPLACE, so a part that stopped halfway
   * can be run again.
   */
  partsFriendly?: boolean;
}

/** The dump's statements, and what each costs D1 in rows written (0 for anything that is not an insert). */
export interface DumpPlan {
  statements: string[];
  writes: number[];
}

export function buildDump(db: DatabaseSync, options: DumpOptions = {}): string[] {
  return planDump(db, options).statements;
}

export function planDump(db: DatabaseSync, options: DumpOptions = {}): DumpPlan {
  const statements: string[] = [];
  const writes: number[] = [];
  const push = (sql: string, cost = 0) => {
    statements.push(sql);
    writes.push(cost);
  };
  push('PRAGMA defer_foreign_keys = true;');
  for (const table of [...TABLE_ORDER].reverse()) push(`DROP TABLE IF EXISTS ${table};`);

  const tableSql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
  );
  for (const table of TABLE_ORDER) {
    const row = tableSql.get(table) as { sql: string } | undefined;
    if (!row) throw new Error(`the database has no table ${table}`);
    push(clean(row.sql));
  }

  const indexes = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name",
    )
    .all() as { sql: string }[];
  if (options.partsFriendly) for (const index of indexes) push(clean(index.sql));

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
    // A row writes itself and one entry in each index that is not its own primary key.
    const perRow =
      1 +
      (db.prepare(`PRAGMA index_list(${table})`).all() as { origin: string }[]).filter(
        (i) => i.origin !== 'pk',
      ).length;
    const verb = options.partsFriendly ? 'INSERT OR REPLACE' : 'INSERT';
    const head = `${verb} INTO ${table} (${columns.join(', ')}) VALUES\n`;
    const select = db.prepare(
      `SELECT ${columns.join(', ')} FROM ${table}${order ? ` ORDER BY ${order}` : ''}`,
    );
    let batch: string[] = [];
    let size = bytes(head);
    const flush = () => {
      if (batch.length) push(`${head}${batch.join(',\n')};`, batch.length * perRow);
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

  // In a dump loaded in one go the indexes come last: building them after the rows are in is much faster.
  if (!options.partsFriendly) for (const index of indexes) push(clean(index.sql));
  return { statements, writes };
}

export interface Part {
  statements: string[];
  /** Rows this part writes into D1. */
  writes: number;
}

/**
 * Splits a dump into parts that each write at most `budget` rows, cut between statements. Every
 * part starts with the pragma, so it stands alone; the first also holds the DDL. The Free plan
 * allows 100,000 rows written a day (index entries count), so a part is run a day.
 */
export function cutIntoParts(plan: DumpPlan, budget: number): Part[] {
  const pragma = plan.statements[0] ?? '';
  const parts: Part[] = [{ statements: [], writes: 0 }];
  plan.statements.forEach((sql, i) => {
    const cost = plan.writes[i] ?? 0;
    if (cost > budget)
      throw new Error(`one statement writes ${cost} rows, over a part's ${budget}`);
    let part = parts[parts.length - 1] as Part;
    if (part.writes + cost > budget) {
      part = { statements: [pragma], writes: 0 };
      parts.push(part);
    }
    part.statements.push(sql);
    part.writes += cost;
  });
  return parts;
}

export interface DumpSummary {
  statements: number;
  bytes: number;
  largestStatement: number;
}

export function writeDump(
  dbPath: string,
  outPath: string,
  options: DumpOptions = {},
): DumpSummary {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const statements = buildDump(db, options);
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
