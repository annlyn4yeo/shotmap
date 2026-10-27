/**
 * A release, kept: the dump D1 is loaded from, gzipped, and a manifest that says what is in it and
 * what loading it costs. `out/releases/<release>/` is what `pnpm --filter @shotmap/api release`
 * deploys and rolls back to, so a release can be put back without the source data or a rebuild.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { planDump, cutIntoParts } from './dump';

/**
 * The most rows a part writes: the Free plan's 100,000 a day, less room for anything else that day
 * (a deploy's own writes, a retried part). A release that writes more is loaded a part a day.
 */
export const PART_BUDGET = 90_000;

export interface RowsWritten {
  /** Rows in the tables. */
  rows: number;
  /** Entries in their secondary indexes. */
  indexEntries: number;
  /** What D1 bills as rows written for a load: both, since an index entry is a row written. */
  total: number;
  perTable: Record<string, { rows: number; indexes: number; written: number }>;
}

/**
 * How many rows loading this database writes into D1. A row in a table is one; so is each entry
 * in each secondary index of that table (docs: "an index adds an extra row written"). The
 * primary key of a table that has no rowid is the table, and costs nothing more. Checked against
 * the first staging load, which wrote 18,495 rows for what this counts as 18,471.
 */
export function rowsWritten(db: DatabaseSync): RowsWritten {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { name: string }[];
  const perTable: RowsWritten['perTable'] = {};
  let rows = 0;
  let indexEntries = 0;
  for (const { name } of tables) {
    const count = (db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get() as { n: number })
      .n;
    // Every index on the table except the one that is the primary key itself.
    const indexes = (
      db.prepare(`PRAGMA index_list(${name})`).all() as { name: string; origin: string }[]
    ).filter((i) => i.origin !== 'pk').length;
    perTable[name] = { rows: count, indexes, written: count * (1 + indexes) };
    rows += count;
    indexEntries += count * indexes;
  }
  return { rows, indexEntries, total: rows + indexEntries, perTable };
}

export interface Manifest {
  release: string;
  releaseDate: string;
  contentHash: string;
  sourceRef: string;
  builtAt: string;
  scope: 'static-three' | 'catalogue';
  counts: Record<string, number>;
  rowsWritten: RowsWritten;
  dump: {
    file: string;
    statements: number;
    bytes: number;
    gzipBytes: number;
    sha256: string;
  };
  sqliteBytes: number;
  /** The release cut into pieces that each fit a Free day (see release.mjs --chunked). */
  parts: { file: string; statements: number; rowsWritten: number; sha256: string }[];
  checks: { name: string; problems: number; note?: string }[];
  excluded: { match: number; reason: string }[];
  /** What the ingest repaired or settled, in numbers; the report has every case. */
  quirks: Record<string, number>;
}

export function archiveRelease(options: {
  root: string;
  dbPath: string;
  dumpPath: string;
  statements: number;
  scope: Manifest['scope'];
  checks: Manifest['checks'];
  excluded: Manifest['excluded'];
  quirks: Manifest['quirks'];
}): { dir: string; manifest: Manifest } {
  const db = new DatabaseSync(options.dbPath, { readOnly: true });
  try {
    const meta = Object.fromEntries(
      (
        db.prepare('SELECT key, value FROM meta').all() as {
          key: string;
          value: string;
        }[]
      ).map((r) => [r.key, r.value]),
    );
    const release = meta.release ?? '';
    if (!release) throw new Error('the database has no release');
    const dir = join(options.root, release);
    mkdirSync(dir, { recursive: true });
    const sql = readFileSync(options.dumpPath);
    const gz = gzipSync(sql, { level: 9 });
    writeFileSync(join(dir, 'shotmap.sql.gz'), gz);
    const parts = cutIntoParts(planDump(db, { partsFriendly: true }), PART_BUDGET).map(
      (part, i) => {
        const text = `${part.statements.join('\n')}\n`;
        const file = `part-${String(i + 1).padStart(2, '0')}.sql.gz`;
        mkdirSync(join(dir, 'parts'), { recursive: true });
        writeFileSync(join(dir, 'parts', file), gzipSync(text, { level: 9 }));
        return {
          file: `parts/${file}`,
          statements: part.statements.length,
          rowsWritten: part.writes,
          sha256: createHash('sha256').update(text).digest('hex'),
        };
      },
    );
    const counts = Object.fromEntries(
      Object.entries(rowsWritten(db).perTable).map(([table, v]) => [table, v.rows]),
    );
    const manifest: Manifest = {
      release,
      releaseDate: meta.release_date ?? '',
      contentHash: meta.content_hash ?? '',
      sourceRef: meta.source_ref ?? '',
      builtAt: meta.built_at ?? '',
      scope: options.scope,
      counts,
      rowsWritten: rowsWritten(db),
      dump: {
        file: 'shotmap.sql.gz',
        statements: options.statements,
        bytes: sql.length,
        gzipBytes: gz.length,
        sha256: createHash('sha256').update(sql).digest('hex'),
      },
      sqliteBytes: statSync(options.dbPath).size,
      parts,
      checks: options.checks,
      excluded: options.excluded,
      quirks: options.quirks,
    };
    writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return { dir, manifest };
  } finally {
    db.close();
  }
}
