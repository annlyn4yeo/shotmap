import { existsSync } from 'node:fs';
import { env } from 'node:process';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** The database `pnpm data` writes. */
export const DB_PATH = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'packages',
  'ingest',
  'out',
  'shotmap.sqlite',
);
export const haveDb = existsSync(DB_PATH);

if (!haveDb) {
  if (env.CI) throw new Error(`${DB_PATH} is missing: CI must run \`pnpm data\` first.`);
  console.warn(
    `\n  ${DB_PATH} is missing, so the Worker tests are skipped. Run \`pnpm data\`.\n`,
  );
}

type Param = string | number | null;

export interface Recorded {
  sql: string;
  params: readonly Param[];
}

/**
 * A SQLite-backed stand-in for D1: the part of the D1Database API the Worker uses
 * (prepare, bind, all, first, run, batch), over the real database file. The Workers-aware
 * Vitest pool needs Vitest 4.1 and this repo is on Vitest 5, so the Hono app is tested
 * against this shim instead (docs/adr/0007). It records every statement, so tests can say
 * what the Worker asked D1, how many times, and with which bound values.
 */
export class D1Shim {
  readonly db = new DatabaseSync(DB_PATH, { readOnly: true });
  /** Round trips: one per all(), first(), run() and one per batch(), as D1 counts queries. */
  roundTrips = 0;
  statements: Recorded[] = [];

  prepare(sql: string): Statement {
    return new Statement(this, sql, []);
  }

  batch(list: Statement[]): Promise<unknown[]> {
    this.roundTrips++;
    return Promise.resolve(list.map((s) => s.execute()));
  }

  reset(): void {
    this.roundTrips = 0;
    this.statements = [];
  }

  asD1(): D1Database {
    return this as unknown as D1Database;
  }
}

class Statement {
  constructor(
    private readonly shim: D1Shim,
    readonly sql: string,
    readonly params: readonly Param[],
  ) {}

  bind(...params: Param[]): Statement {
    return new Statement(this.shim, this.sql, params);
  }

  execute(): { results: unknown[]; success: true; meta: Record<string, unknown> } {
    this.shim.statements.push({ sql: this.sql, params: this.params });
    const results = this.shim.db.prepare(this.sql).all(...this.params);
    return { results, success: true, meta: { rows_read: results.length } };
  }

  all(): Promise<unknown> {
    this.shim.roundTrips++;
    return Promise.resolve(this.execute());
  }

  first(): Promise<unknown> {
    this.shim.roundTrips++;
    return Promise.resolve(this.execute().results[0] ?? null);
  }

  run(): Promise<unknown> {
    this.shim.roundTrips++;
    return Promise.resolve(this.execute());
  }
}
