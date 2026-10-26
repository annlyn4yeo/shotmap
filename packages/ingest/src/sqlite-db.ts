import { DatabaseSync } from 'node:sqlite';
import type { Db, Row, Statement } from '@shotmap/queries';

/** The shared queries over node:sqlite, read-only. Used by the tests and by tools. */
export function openDb(path: string): Db & { raw: DatabaseSync } {
  const raw = new DatabaseSync(path, { readOnly: true });
  const all = (sql: string, params: readonly (string | number | null)[] = []): Row[] =>
    raw.prepare(sql).all(...params);
  return {
    raw,
    all: (sql, params) => Promise.resolve(all(sql, params)),
    batch: (statements: readonly Statement[]) =>
      Promise.resolve(statements.map((s) => all(s.sql, s.params))),
  };
}
