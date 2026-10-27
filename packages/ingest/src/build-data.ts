/**
 * Build-time data pipeline: StatsBomb open data in, tiny static JSON out.
 *
 *   pnpm data
 *
 * Raw downloads are cached (gzipped) in packages/ingest/.cache/, so a re-run, or a run
 * that was interrupted, only fetches what is missing. Output goes to
 * apps/web/public/data and is committed, so deploys never depend on the network.
 *
 * This is the static path's build: the three competitions in `include`, which the golden master
 * (docs/golden) pins. The whole catalogue is `pnpm catalogue` (catalogue.ts).
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  PITCH,
  SCHEMA_VERSION,
  type IndexCompetition,
  type IndexFile,
  type MatchRow,
} from '@shotmap/schema';
import { IndexFileSchema, MatchFileSchema } from '@shotmap/schema/zod';
import { budgets, concurrency, hero, include, retries, source } from './data.config';
import {
  buildMatch,
  goalsOf,
  legend,
  sortStages,
  stats,
  type Built,
  type RawCompetition,
  type RawEvent,
  type RawLineupTeam,
  type RawMatch,
} from './build-match';
import { archiveRelease } from './archive';
import { runChecks } from './checks';
import { writeDatabase } from './db';
import { writeDump } from './dump';
import { createSource, pool } from './source';

// Paths do not depend on where the script is run from.
const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(PACKAGE, '.cache', 'statsbomb');
const OUT = resolve(PACKAGE, '..', '..', 'apps', 'web', 'public', 'data');
// The SQLite database (git-ignored).
const DB = join(PACKAGE, 'out', 'shotmap.sqlite');
// The SQL dump of it, for D1 (git-ignored).
const DUMP = join(PACKAGE, 'out', 'shotmap.sql');

const gz = (text: string) => gzipSync(text, { level: 9 }).length;
const kb = (n: number) => (n / 1024).toFixed(2).padStart(8);

async function main() {
  const started = Date.now();
  const data = createSource({
    base: source.base,
    ref: source.ref,
    cacheDir: CACHE,
    politeness: { concurrency, retries },
  });
  await data.checkCache();
  console.log(`StatsBomb open data @ ${source.ref}, cache ${CACHE}`);

  const all = await data.json<RawCompetition[]>('competitions.json');
  const resolved = include.map((want) => {
    const hit = all.find(
      (c) => c.competition_name === want.competition && c.season_name === want.season,
    );
    if (!hit) {
      const near = all
        .filter((c) => c.competition_name === want.competition)
        .map((c) => c.season_name)
        .join(', ');
      throw new Error(
        `Not in competitions.json: "${want.competition}" "${want.season}". Seasons for that competition: ${near || 'none'}`,
      );
    }
    return hit;
  });

  const jobs: RawMatch[] = [];
  for (const c of resolved) {
    const list = await data.json<RawMatch[]>(
      `matches/${c.competition_id}/${c.season_id}.json`,
    );
    const ok = list.filter((m) => m.match_status === 'available');
    if (ok.length < list.length)
      console.warn(
        `  ${c.competition_name} ${c.season_name}: ${list.length - ok.length} matches not available, skipped`,
      );
    console.log(
      `${c.competition_name} ${c.season_name}: ${ok.length} matches (competition ${c.competition_id}, season ${c.season_id})`,
    );
    jobs.push(...ok);
  }

  let done = 0;
  const built = await pool(jobs, concurrency, async (raw) => {
    const [events, lineups] = await Promise.all([
      data.json<RawEvent[]>(`events/${raw.match_id}.json`),
      data.jsonOrNull<RawLineupTeam[]>(`lineups/${raw.match_id}.json`),
    ]);
    const result = buildMatch(raw, events, lineups);
    done++;
    if (done % 10 === 0 || done === jobs.length)
      console.log(
        `  ${done}/${jobs.length} matches (${data.stats.fetched} downloaded, ${data.stats.cached} cached)`,
      );
    return result;
  });

  // Every final score should be explained by shot goals plus own goals.
  const unexplained = built.filter(({ file, ownGoals }) =>
    file.meta.teams.some(
      (t, i) => goalsOf(file.shots, i) + (ownGoals[i] ?? 0) !== t.score,
    ),
  );
  const ownGoalCount = built.reduce((n, b) => n + b.ownGoals[0] + b.ownGoals[1], 0);

  // Index

  const stageNames = sortStages(new Set(built.map((b) => b.stage)));
  const rowOf = ({ file, stage }: Built): MatchRow => {
    const [home, away] = file.meta.teams;
    return [
      file.meta.id,
      file.meta.date,
      home.name,
      away.name,
      home.score,
      away.score,
      stageNames.indexOf(stage),
      home.pens,
      away.pens,
    ];
  };
  const sortKey = (b: Built) =>
    `${b.file.meta.date} ${b.file.meta.kickoff ?? ''} ${String(b.file.meta.id).padStart(9, '0')}`;

  const competitions: IndexCompetition[] = [];
  for (const c of resolved) {
    let comp = competitions.find((x) => x.id === c.competition_id);
    if (!comp) {
      comp = { id: c.competition_id, name: c.competition_name, seasons: [] };
      competitions.push(comp);
    }
    const matches = built
      .filter(
        (b) =>
          b.file.meta.competition.id === c.competition_id &&
          b.file.meta.season.id === c.season_id,
      )
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
      .map(rowOf);
    comp.seasons.push({ id: c.season_id, name: c.season_name, matches });
  }

  const heroBuilt = built.find(
    (b) =>
      b.file.meta.competition.name === hero.competition &&
      b.file.meta.season.name === hero.season &&
      b.stage === hero.stage,
  );
  if (!heroBuilt) throw new Error(`Hero match not found: ${JSON.stringify(hero)}`);

  const index: IndexFile = {
    v: SCHEMA_VERSION,
    hero: heroBuilt.file.meta.id,
    pitch: {
      length: PITCH.length,
      width: PITCH.width,
      goalY: [PITCH.goalY[0], PITCH.goalY[1]],
    },
    enums: legend(),
    stages: stageNames,
    competitions,
  };

  // The output must match the schema the app and its tests rely on, before anything is written.
  for (const b of built) MatchFileSchema.parse(b.file);
  IndexFileSchema.parse(index);

  // Write, replacing whatever was there so removed matches do not linger.

  await mkdir(join(OUT, 'matches'), { recursive: true });
  const keep = new Set<string>();
  const sizes: { comp: string; raw: number; gzip: number; max: number; maxId: number }[] =
    [];
  const failures: string[] = [];

  for (const c of resolved) {
    const row = {
      comp: `${c.competition_name} ${c.season_name}`,
      raw: 0,
      gzip: 0,
      max: 0,
      maxId: 0,
    };
    for (const b of built) {
      if (
        b.file.meta.competition.id !== c.competition_id ||
        b.file.meta.season.id !== c.season_id
      )
        continue;
      const text = JSON.stringify(b.file);
      const size = gz(text);
      const name = `${b.file.meta.id}.json`;
      keep.add(name);
      await writeFile(join(OUT, 'matches', name), text);
      row.raw += Buffer.byteLength(text);
      row.gzip += size;
      if (size > row.max) {
        row.max = size;
        row.maxId = b.file.meta.id;
      }
      if (size > budgets.matchKB * 1024)
        failures.push(
          `matches/${name} is ${kb(size).trim()} KB gzip (budget ${budgets.matchKB})`,
        );
    }
    sizes.push(row);
  }
  for (const stale of await readdir(join(OUT, 'matches'))) {
    if (!keep.has(stale)) await rm(join(OUT, 'matches', stale));
  }

  const indexText = JSON.stringify(index);
  await writeFile(join(OUT, 'index.json'), indexText);
  const indexGz = gz(indexText);
  if (indexGz > budgets.indexKB * 1024)
    failures.push(
      `index.json is ${kb(indexGz).trim()} KB gzip (budget ${budgets.indexKB})`,
    );

  // The database, next to the JSON: the same shots, plus what the files drop.
  const summary = writeDatabase(DB, {
    ref: source.ref,
    hero: index.hero,
    competitions,
    stages: stageNames,
    matches: built,
  });

  // Report

  console.log('\nSize table (KB)');
  console.log(
    `${'output'.padEnd(34)} ${'files'.padStart(5)} ${'raw'.padStart(8)} ${'gzip'.padStart(8)} ${'largest gzip'.padStart(13)}  budget`,
  );
  for (const s of sizes) {
    const files = built.filter(
      (b) => `${b.file.meta.competition.name} ${b.file.meta.season.name}` === s.comp,
    ).length;
    console.log(
      `${s.comp.padEnd(34)} ${String(files).padStart(5)} ${kb(s.raw)} ${kb(s.gzip)} ${kb(s.max).padStart(13)}  <= ${budgets.matchKB} per file`,
    );
  }
  console.log(
    `${'index.json'.padEnd(34)} ${'1'.padStart(5)} ${kb(Buffer.byteLength(indexText))} ${kb(indexGz)} ${kb(indexGz).padStart(13)}  <= ${budgets.indexKB}`,
  );
  const total = sizes.reduce((n, s) => n + s.gzip, indexGz);
  console.log(
    `${'total shipped'.padEnd(34)} ${String(built.length + 1).padStart(5)} ${''.padStart(8)} ${kb(total)}`,
  );

  const mean = (a: { sum: number; n: number }) =>
    a.n ? (a.sum / a.n).toFixed(1) : 'n/a';
  const range = (r: number[]) => `${r[0]} to ${r[1]}`;
  console.log('\nCoordinate checks (non-shootout shots)');
  console.log(
    `  shots ${stats.shots}, shootout kicks ${stats.shootout}, skipped ${stats.skipped}, goals ${stats.goals}`,
  );
  console.log(
    `  shot x ${range(stats.x)}, y ${range(stats.y)}; ${stats.below60} shots from the own half (x < 60)`,
  );
  console.log(
    `  goals end x ${range(stats.goalEndX)}, y ${range(stats.goalEndY)}, height ${range(stats.goalEndZ)}`,
  );
  console.log(
    `  post hits within 1 yard of a post line (y 36 or 44): ${stats.postsNearPost}/${stats.posts}`,
  );
  console.log(
    `  mean y of Right Wing events ${mean(stats.rightWing)}, Left Wing ${mean(stats.leftWing)} (right > left means y grows toward the attacker's right, i.e. top-to-bottom when attacking toward +x)`,
  );

  console.log(
    `\nHero match ${index.hero}. Done in ${((Date.now() - started) / 1000).toFixed(1)} s.`,
  );
  console.log(
    `  score check: shot goals + own goals equal the final score in ${built.length - unexplained.length}/${built.length} matches (${ownGoalCount} own goals not drawn)`,
  );
  for (const u of unexplained) {
    console.error(
      `  unexplained score, match ${u.file.meta.id}: ${u.file.meta.teams.map((t) => `${t.name} ${t.score}`).join(' v ')}`,
    );
  }
  if (unexplained.length)
    failures.push(
      `${unexplained.length} matches have a score that shots plus own goals do not explain`,
    );

  console.log(`\nDatabase ${DB}`);
  console.log(
    `  release ${summary.release}; rows: ${Object.entries(summary.counts)
      .map(([table, n]) => `${table} ${n}`)
      .join(', ')}`,
  );
  const checks = runChecks(DB);
  for (const c of checks) {
    console.log(
      `  ${c.problems.length ? 'FAIL' : 'ok  '} ${c.name}${c.note ? ` (${c.note})` : ''}`,
    );
    for (const p of c.problems.slice(0, 10)) console.error(`        ${p}`);
    if (c.problems.length)
      failures.push(`database check "${c.name}": ${c.problems.length} problems`);
  }

  // The SQL dump D1 is loaded from (D1 cannot import a .sqlite file).
  const dump = writeDump(DB, DUMP);
  console.log(
    `  dump ${DUMP}: ${dump.statements} statements, ${(dump.bytes / 1024).toFixed(0)} KiB, largest ${dump.largestStatement} bytes (D1 allows 100,000)`,
  );
  const archived = archiveRelease({
    root: join(PACKAGE, 'out', 'releases'),
    dbPath: DB,
    dumpPath: DUMP,
    statements: dump.statements,
    scope: 'static-three',
    checks: checks.map((c) => ({
      name: c.name,
      problems: c.problems.length,
      ...(c.note ? { note: c.note } : {}),
    })),
    excluded: [],
    quirks: {},
  });
  console.log(`  release archived in ${archived.dir}`);
  if (failures.length) {
    console.error(`\nFailed:\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
