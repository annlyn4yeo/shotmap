// What each endpoint's SQL costs on the real D1: the rows it reads, which is what the Free plan
// bills (5 million a day) and what a scan makes expensive, and how long the database took.
//
//   node packages/ingest/node_modules/.bin/tsx packages/ingest/src/explain.ts <db> --emit statements.json
//   node scripts/rows-read.mjs statements.json --env staging
//
// Each statement is run with `wrangler d1 execute --remote --json`, whose answer carries D1's own
// meta.rows_read and meta.duration. Read-only: every statement is a SELECT. It spends rows read
// (the total is printed first, from the file, before anything runs).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [file, ...rest] = process.argv.slice(2);
const env = rest[rest.indexOf('--env') + 1];
const DATABASES = { staging: 'shotmap-staging', production: 'shotmap' };
if (!file || !DATABASES[env]) {
  console.error(
    'Usage: node scripts/rows-read.mjs statements.json --env staging|production',
  );
  process.exit(1);
}
const statements = JSON.parse(readFileSync(file, 'utf8'));
if (!statements.every((s) => /^\s*SELECT\b/i.test(s.sql))) {
  console.error('Refusing: not every statement is a SELECT.');
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'rows-read-'));
const rows = [];
for (const [i, s] of statements.entries()) {
  const path = join(dir, `${i}.sql`);
  writeFileSync(path, `${s.sql};\n`);
  const run = spawnSync(
    'pnpm',
    [
      'exec',
      'wrangler',
      'd1',
      'execute',
      DATABASES[env],
      '--remote',
      '--env',
      env,
      '--json',
      `--file=${path}`,
    ],
    {
      cwd: API,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const text = `${run.stdout ?? ''}`;
  try {
    const meta = JSON.parse(text.slice(text.indexOf('[')))[0].meta;
    rows.push({
      endpoint: s.endpoint,
      read: meta.rows_read,
      ms: meta.duration,
      sql: s.sql,
    });
    console.log(
      `${String(meta.rows_read).padStart(8)} rows read  ${String(meta.duration).padStart(6)} ms  ${s.endpoint}`,
    );
  } catch {
    console.error(
      `could not read the answer for ${s.endpoint}: ${(run.stderr || text).slice(0, 200)}`,
    );
    rows.push({ endpoint: s.endpoint, read: null, ms: null, sql: s.sql });
  }
}

const by = new Map();
for (const r of rows) {
  const e = by.get(r.endpoint) ?? { read: 0, ms: 0, statements: 0 };
  e.read += r.read ?? 0;
  e.ms += r.ms ?? 0;
  e.statements++;
  by.set(r.endpoint, e);
}
console.log('\nPer endpoint (all its statements):');
for (const [endpoint, e] of [...by].sort((a, b) => b[1].read - a[1].read))
  console.log(
    `${String(e.read).padStart(8)} rows read  ${e.ms.toFixed(1).padStart(7)} ms in the database  ${endpoint}`,
  );
const total = rows.reduce((n, r) => n + (r.read ?? 0), 0);
console.log(
  `\n${total} rows read by one request to each: ${((total / 5_000_000) * 100).toFixed(2)}% of a Free day.`,
);
writeFileSync(
  file.replace(/\.json$/, '.rows-read.json'),
  `${JSON.stringify(rows, null, 2)}\n`,
);
