import type { Db, Row, Statement } from '@shotmap/queries';

/**
 * D1 behind the shared `Db` interface. D1 types its rows as `unknown` (the strictness this
 * repo compiles with), so every row is checked to be an object before the queries read
 * its columns through num, str and orNull, which throw on a wrong type.
 */
function toRows(result: D1Result): Row[] {
  return result.results.map((row) => {
    if (typeof row !== 'object' || row === null)
      throw new TypeError('D1 returned a row that is not an object');
    return row as Row;
  });
}

export function d1Db(d1: D1Database): Db {
  const prepare = (s: Statement) => d1.prepare(s.sql).bind(...(s.params ?? []));
  return {
    // Every value is bound; nothing is ever concatenated into SQL except fixed text and integers
    // the code itself chose.
    all: async (sql, params = []) =>
      toRows(
        await d1
          .prepare(sql)
          .bind(...params)
          .all(),
      ),
    // One round trip, and one query toward the per-invocation limit (50 Free, 1,000 Paid).
    batch: async (statements) => (await d1.batch(statements.map(prepare))).map(toRows),
  };
}
