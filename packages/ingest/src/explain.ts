/**
 * What the database does for each endpoint: the real queries (`@shotmap/queries`), run against a
 * database, each statement's EXPLAIN QUERY PLAN, and a flag on any that scans a big table.
 *
 *   pnpm --filter @shotmap/ingest explain [path/to/shotmap.sqlite]
 *
 * On D1 a scan is billed by the row (the Free plan reads 5 million a day), so a statement that
 * reads a table end to end is a bug at 100,000 shots even though it takes a millisecond here.
 * The sample inputs are the heaviest the data has: the busiest player, the biggest season, the
 * team with the most matches, the match with the most shots.
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  exportCompare,
  exportDensity,
  exportMatch,
  exportMatchList,
  exportMatchShots,
  exportMeta,
  exportPlayer,
  exportPlayerShots,
  exportSearch,
  type Db,
  type Row,
  type Statement,
  type Value,
} from '@shotmap/queries';

const argv = process.argv.slice(2);
const emitAt = argv.indexOf('--emit');
const emitTo = emitAt >= 0 ? argv[emitAt + 1] : undefined;
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--emit');
const path = resolve(
  positional[0] ?? join(import.meta.dirname, '..', 'out', 'catalogue', 'shotmap.sqlite'),
);
const raw = new DatabaseSync(path, { readOnly: true });
const one = (sql: string): Row => raw.prepare(sql).get() ?? {};
const n = (v: unknown) => Number(v);

/** Tables big enough that reading one end to end is a problem. */
const BIG = ['shots', 'matches', 'match_players', 'search_terms', 'players'];

interface Seen {
  sql: string;
  params: readonly Value[];
  endpoint: string;
}
const seen = new Map<string, Seen>();
let endpoint = '';

const record = (s: Statement) => {
  const key = s.sql.replace(/\s+/g, ' ').trim();
  if (!seen.has(`${endpoint}|${key}`))
    seen.set(`${endpoint}|${key}`, { sql: key, params: s.params ?? [], endpoint });
};
const db: Db = {
  all: (sql, params) => {
    record({ sql, ...(params ? { params } : {}) });
    return Promise.resolve(raw.prepare(sql).all(...(params ?? [])));
  },
  batch: (statements) => {
    for (const s of statements) record(s);
    return Promise.resolve(
      statements.map((s) => raw.prepare(s.sql).all(...(s.params ?? []))),
    );
  },
};

const heaviest = {
  player: n(
    one(
      'SELECT player_id AS v FROM shots GROUP BY player_id ORDER BY COUNT(*) DESC LIMIT 1',
    ).v,
  ),
  match: n(
    one(
      'SELECT match_id AS v FROM shots GROUP BY match_id ORDER BY COUNT(*) DESC LIMIT 1',
    ).v,
  ),
  team: n(
    one(
      'SELECT t AS v FROM (SELECT home_team_id AS t FROM matches UNION ALL SELECT away_team_id FROM matches) GROUP BY t ORDER BY COUNT(*) DESC LIMIT 1',
    ).v,
  ),
  season: one(
    'SELECT competition_id AS c, season_id AS s FROM matches GROUP BY competition_id, season_id ORDER BY COUNT(*) DESC LIMIT 1',
  ),
  stage: n(one("SELECT id AS v FROM stages WHERE name = 'Final'").v),
  common: String(
    one(
      'SELECT term AS v FROM search_terms WHERE kind = 3 GROUP BY term ORDER BY COUNT(*) DESC LIMIT 1',
    ).v,
  ),
};
const heavySeason = { competition: n(heaviest.season.c), season: n(heaviest.season.s) };

async function run() {
  const step = async (name: string, work: () => Promise<unknown>) => {
    endpoint = name;
    await work();
  };
  await step('/v1/meta', () => exportMeta(db));
  await step('/v1/matches (all, oldest)', () => exportMatchList(db, { limit: 50 }));
  await step('/v1/matches (all, newest)', () =>
    exportMatchList(db, { limit: 50, order: 'newest' }),
  );
  const page = await exportMatchList(db, { limit: 50, order: 'newest' });
  if (page.next)
    await step('/v1/matches (newest, a later page)', () =>
      exportMatchList(db, { limit: 50, order: 'newest', cursor: page.next as string }),
    );
  await step('/v1/matches (one season)', () =>
    exportMatchList(db, { ...heavySeason, limit: 50, order: 'newest' }),
  );
  await step('/v1/matches (season + stage)', () =>
    exportMatchList(db, {
      ...heavySeason,
      stage: heaviest.stage,
      limit: 50,
      order: 'newest',
    }),
  );
  await step('/v1/matches (one competition)', () =>
    exportMatchList(db, {
      competition: heavySeason.competition,
      limit: 50,
      order: 'newest',
    }),
  );
  await step('/v1/matches (one stage)', () =>
    exportMatchList(db, { stage: heaviest.stage, limit: 50, order: 'newest' }),
  );
  await step('/v1/matches (one team)', () =>
    exportMatchList(db, { team: heaviest.team, limit: 50, order: 'newest' }),
  );
  await step('/v1/matches (a date range)', () =>
    exportMatchList(db, { from: '2018-01-01', to: '2018-01-31', limit: 50 }),
  );
  await step('/v1/matches/:id', () => exportMatch(db, heaviest.match));
  await step('/v1/matches/:id/shots', () => exportMatchShots(db, heaviest.match));
  await step('/v1/players/:id', () => exportPlayer(db, heaviest.player));
  await step('/v1/players/:id/shots (all)', () => exportPlayerShots(db, heaviest.player));
  await step('/v1/players/:id/shots (one season)', () =>
    exportPlayerShots(db, heaviest.player, heavySeason),
  );
  await step('/v1/players/:id/shots (open play, goals, penalties)', () =>
    exportPlayerShots(db, heaviest.player, {
      period: 'open',
      outcome: ['goal'],
      type: [88],
    }),
  );
  await step('/v1/players/:id/density', () => exportDensity(db, heaviest.player, 2));
  await step('/v1/players/:id/density (one season)', () =>
    exportDensity(db, heaviest.player, 2, heavySeason),
  );
  await step('/v1/compare', () => exportCompare(db, heaviest.player, heaviest.player));
  await step('/v1/search (one word)', () => exportSearch(db, 'mes'));
  await step('/v1/search (a common word)', () =>
    exportSearch(db, heaviest.common.slice(0, 3)),
  );
  await step('/v1/search (two words)', () => exportSearch(db, 'lionel mes'));
  await step('/v1/search (an accent)', () => exportSearch(db, 'ÁNGEL'));
  await step('/v1/search (no match)', () => exportSearch(db, 'zzzzq'));
}

function timeMs(sql: string, params: readonly Value[]): number {
  const stmt = raw.prepare(sql);
  const times: number[] = [];
  for (let i = 0; i < 9; i++) {
    const t = performance.now();
    stmt.all(...params);
    times.push(performance.now() - t);
  }
  return times.sort((a, b) => a - b)[4] ?? 0;
}

await run();
console.log(`Database ${path}`);
const tableRows = Object.fromEntries(
  BIG.map((t) => [t, n(one(`SELECT COUNT(*) AS v FROM ${t}`).v)]),
);
console.log(`Rows: ${BIG.map((t) => `${t} ${tableRows[t]}`).join(', ')}`);
console.log(
  `Heaviest inputs: player ${heaviest.player}, match ${heaviest.match}, team ${heaviest.team}, season ${heavySeason.competition}/${heavySeason.season}, stage ${heaviest.stage}\n`,
);

let flagged = 0;
let last = '';
for (const s of seen.values()) {
  if (s.endpoint !== last) {
    console.log(`\n${s.endpoint}`);
    last = s.endpoint;
  }
  const plan = (
    raw.prepare(`EXPLAIN QUERY PLAN ${s.sql}`).all(...s.params) as { detail: string }[]
  ).map((p) => p.detail);
  // The plan names a table by its alias (SCAN m), so the statement says which table that is.
  const tables = new Map<string, string>();
  for (const m of s.sql.matchAll(
    /\b(?:FROM|JOIN)\s+(\w+)(?:\s+(?:AS\s+)?(?!ON\b|WHERE\b|JOIN\b|LEFT\b|ORDER\b|GROUP\b|UNION\b)(\w+))?/gi,
  ))
    tables.set(m[2] ?? m[1] ?? '', m[1] ?? '');
  const scans = plan.filter((d) => {
    const m = /^SCAN (?:TABLE )?(\w+)(?: AS \w+)?( USING (?:COVERING )?INDEX \w+)?/.exec(
      d,
    );
    const table = tables.get(m?.[1] ?? '') ?? m?.[1] ?? '';
    return m !== null && BIG.includes(table) && m[2] === undefined;
  });
  const ordered = plan.filter((d) => /USE TEMP B-TREE FOR (?!RIGHT|LAST)/.test(d));
  if (scans.length) flagged++;
  console.log(
    `  ${scans.length ? 'SCAN' : 'ok  '} ${timeMs(s.sql, s.params).toFixed(2).padStart(7)} ms  ${s.sql.slice(0, 96)}${s.sql.length > 96 ? '...' : ''}`,
  );
  for (const d of plan) console.log(`          ${d}`);
  if (ordered.length) console.log('          (sorts the whole result before the limit)');
}
console.log(`\n${seen.size} statements, ${flagged} read a big table end to end.`);
if (emitTo) {
  // The statements with their values written in, for `wrangler d1 execute --command` (which takes
  // no bound parameters), so each can be run on the real service and its rows_read read back.
  const literal = (v: Value) =>
    typeof v === 'number'
      ? String(v)
      : v === null
        ? 'NULL'
        : `'${v.replaceAll("'", "''")}'`;
  const out = [...seen.values()].map((s) => {
    let at = 0;
    return {
      endpoint: s.endpoint,
      sql: s.sql.replace(/\?/g, () => literal(s.params[at++] ?? null)),
    };
  });
  writeFileSync(emitTo, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`wrote ${out.length} statements to ${emitTo}`);
}
process.exitCode = flagged ? 1 : 0;
