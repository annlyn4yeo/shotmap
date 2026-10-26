import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
// The Workers tests load the dump into D1 with this splitter: it must give back the statements.
import { splitDump } from '../../../apps/api/test/workers/split-dump';
import { checkDatabase } from './checks';
import {
  MAX_ROWS_PER_INSERT,
  MAX_STATEMENT_BYTES,
  TABLE_ORDER,
  buildDump,
  sqlLiteral,
} from './dump';
import { DB_PATH, haveDb } from './testdb';

describe('sqlLiteral', () => {
  it('quotes text and doubles apostrophes', () => {
    expect(sqlLiteral("O'Brien")).toBe("'O''Brien'");
    expect(sqlLiteral('Ángel Di María')).toBe("'Ángel Di María'");
    expect(sqlLiteral("'; DROP TABLE shots; --")).toBe("'''; DROP TABLE shots; --'");
  });

  it('writes numbers and null as themselves', () => {
    expect(sqlLiteral(92.4)).toBe('92.4');
    expect(sqlLiteral(3869685003)).toBe('3869685003');
    expect(sqlLiteral(null)).toBe('NULL');
    expect(() => sqlLiteral(Number.NaN)).toThrow();
  });
});

// The dump is what D1 is loaded from. It must rebuild the database exactly, in statements D1 accepts.
describe.skipIf(!haveDb)('the SQL dump', () => {
  const source = new DatabaseSync(DB_PATH, { readOnly: true });
  const statements = buildDump(source);
  const encoder = new TextEncoder();

  it('stays inside D1 limits: under 100,000 bytes a statement, nothing but literal SQL', () => {
    const sizes = statements.map((s) => encoder.encode(s).length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(MAX_STATEMENT_BYTES);
    expect(MAX_STATEMENT_BYTES).toBeLessThan(100_000);
    const inserts = statements.filter((s) => s.startsWith('INSERT'));
    for (const s of inserts) {
      const rows = (s.match(/\n\(/g) ?? []).length + 0;
      expect(rows).toBeLessThanOrEqual(MAX_ROWS_PER_INSERT);
      // No bound parameters: strip the string literals, and no ? may be left.
      expect(s.replace(/'(?:[^']|'')*'/g, "''")).not.toContain('?');
    }
    expect(inserts.length).toBeGreaterThan(40);
  });

  it('has no transaction statements and no foreign_keys pragma, which D1 rejects', () => {
    for (const s of statements) {
      expect(s).not.toMatch(/^\s*(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i);
      expect(s).not.toMatch(/PRAGMA\s+foreign_keys/i);
      expect(s).not.toMatch(/^\s*--/m);
    }
    expect(statements[0]).toBe('PRAGMA defer_foreign_keys = true;');
  });

  it('puts parents before children, and indexes after the rows', () => {
    const firstInsert = (table: string) =>
      statements.findIndex((s) => s.startsWith(`INSERT INTO ${table} `));
    const order = TABLE_ORDER.map(firstInsert);
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const lastInsert = statements.map((s) => s.startsWith('INSERT')).lastIndexOf(true);
    const indexes = statements.flatMap((s, i) =>
      s.startsWith('CREATE') && /INDEX/.test(s) ? [i] : [],
    );
    expect(indexes.length).toBe(3);
    expect(indexes.every((i) => i > lastInsert)).toBe(true);
  });

  it('rebuilds the database exactly, and the rebuilt database passes every check', () => {
    const copy = new DatabaseSync(':memory:');
    copy.exec(statements.join('\n'));
    for (const table of TABLE_ORDER) {
      const cols = source.prepare(`PRAGMA table_info(${table})`).all() as {
        name: string;
        pk: number;
      }[];
      const order = cols
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name)
        .join(', ');
      const sql = `SELECT * FROM ${table} ORDER BY ${order}`;
      expect(copy.prepare(sql).all(), table).toEqual(source.prepare(sql).all());
    }
    const problems = checkDatabase(copy).filter((c) => c.problems.length);
    expect(problems).toEqual([]);
    // The indexes came across, so the planned queries use them.
    const plan = copy
      .prepare(
        'EXPLAIN QUERY PLAN SELECT * FROM shots WHERE player_id = 5503 ORDER BY match_id, seq',
      )
      .all() as { detail: string }[];
    expect(plan.map((p) => p.detail).join(' ')).toContain('shots_player_match');
  });

  it('splits back into the same statements, as the Workers tests and wrangler read it', () => {
    expect(splitDump(`${statements.join('\n')}\n`)).toEqual(statements);
  });

  it('can be loaded again over a database that already has a release', () => {
    const copy = new DatabaseSync(':memory:');
    copy.exec(statements.join('\n'));
    copy.exec(statements.join('\n'));
    expect(
      (copy.prepare('SELECT COUNT(*) AS n FROM shots').get() as { n: number }).n,
    ).toBe(3721);
  });
});
