/**
 * The only thing the queries need from a database. The Worker passes D1; ingest and the
 * tests pass node:sqlite. Rows come back as `unknown` values (that is what D1 gives under
 * this TypeScript strictness), and the queries read them through num, str and orNull.
 */
export type Value = string | number | null;
export type Row = Record<string, unknown>;

export interface Statement {
  sql: string;
  params?: readonly Value[];
}

export interface Db {
  all(sql: string, params?: readonly Value[]): Promise<Row[]>;
  /**
   * Independent statements in one round trip. On D1 a batch counts as a single query
   * toward the per-invocation limit (50 on Free, 1,000 on Paid).
   */
  batch(statements: readonly Statement[]): Promise<Row[][]>;
}

export const num = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new TypeError(`expected a number, got ${String(v)}`);
  return n;
};

export const str = (v: unknown): string => {
  if (typeof v !== 'string') throw new TypeError(`expected a string, got ${typeof v}`);
  return v;
};

export const orNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : num(v);
