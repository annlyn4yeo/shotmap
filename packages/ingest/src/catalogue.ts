/**
 * The whole StatsBomb open catalogue into one database (MIGRATION.md step M9, decision Q1).
 *
 *   pnpm --filter @shotmap/ingest catalogue            # download what is missing, build, check, dump
 *   pnpm --filter @shotmap/ingest catalogue --fetch-only
 *
 * Every competition and season in competitions.json at the pinned commit, every match whose status
 * is "available". It is resumable (the cache is the progress: run it again and it fetches only what
 * is missing), polite (source.ts), verified (each download against the commit's blob hash), and it
 * writes nothing the checks have not passed: a match that fails is listed with its reason, and the
 * run fails unless the match is in `excluded` (catalogue.config.ts) with a reason of its own.
 *
 * Output (git-ignored) is packages/ingest/out/catalogue/: shotmap.sqlite, shotmap.sql (for D1),
 * report.json. The static build (`pnpm data`) is separate and unchanged: it is the golden master.
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENUMS } from '@shotmap/schema';
import { archiveRelease } from './archive';
import { ceiling, excluded, verifiedGoals } from './catalogue.config';
import {
  buildMatch,
  observed,
  sortStages,
  stats,
  type Built,
  type RawCompetition,
  type RawEvent,
  type RawLineupTeam,
  type RawMatch,
} from './build-match';
import { checkDatabase, type Check } from './checks';
import { hero, source } from './data.config';
import { writeDatabase } from './db';
import { writeDump } from './dump';
import { isLowResolution, repairGoalEnds } from './repairs';
import { createSource, pool } from './source';
import { loadTree } from './tree';

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(PACKAGE, '.cache', 'statsbomb');

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

const fetchOnly = flag('fetch-only');
const limit = Number(option('limit') ?? 0);
const OUT = resolve(option('out') ?? join(PACKAGE, 'out', 'catalogue'));
const DB = join(OUT, 'shotmap.sqlite');
const DUMP = join(OUT, 'shotmap.sql');
const REPORT = join(OUT, 'report.json');

interface Failure {
  match: number;
  competition: string;
  season: string;
  phase: 'download' | 'build';
  reason: string;
}

const mib = (n: number) => `${(n / 1048576).toFixed(1)} MiB`;
const minutes = (ms: number) => `${(ms / 60000).toFixed(1)} min`;

async function main() {
  const started = Date.now();
  const phases: Record<string, number> = {};
  const lap = (name: string, since: number) => {
    phases[name] = Date.now() - since;
  };

  const data = createSource({
    base: source.base,
    ref: source.ref,
    cacheDir: CACHE,
    politeness: {
      ...(process.env.INGEST_CONCURRENCY
        ? { concurrency: Number(process.env.INGEST_CONCURRENCY) }
        : {}),
      ...(process.env.INGEST_RATE
        ? { ratePerSecond: Number(process.env.INGEST_RATE) }
        : {}),
    },
  });
  await data.checkCache();
  console.log(
    `StatsBomb open data @ ${source.ref}\n  cache ${CACHE}\n  politeness: ${data.politeness.concurrency} in flight, at most ${data.politeness.ratePerSecond} requests a second, ${data.politeness.retries} retries`,
  );

  // 1. What there is: the commit's file tree, competitions.json, every match list.
  let t = Date.now();
  const tree = await loadTree(source.ref, CACHE);
  data.useTree(tree);
  const all = await data.json<RawCompetition[]>('competitions.json');
  const lists = await pool(all, 4, async (c) => ({
    c,
    list: await data.json<RawMatch[]>(`matches/${c.competition_id}/${c.season_id}.json`),
  }));
  lap('inventory', t);

  const failures: Failure[] = [];
  const notAvailable: { match: number; status: string }[] = [];
  const noEvents: number[] = [];
  const jobs: { raw: RawMatch; competition: string; season: string }[] = [];
  const seen = new Set<number>();
  for (const { c, list } of lists) {
    for (const raw of list) {
      if (seen.has(raw.match_id)) {
        failures.push({
          match: raw.match_id,
          competition: c.competition_name,
          season: c.season_name,
          phase: 'build',
          reason: 'listed twice in the match lists',
        });
        continue;
      }
      seen.add(raw.match_id);
      if (raw.match_status !== 'available') {
        notAvailable.push({ match: raw.match_id, status: raw.match_status });
        continue;
      }
      if (!tree.has(`events/${raw.match_id}.json`)) {
        noEvents.push(raw.match_id);
        continue;
      }
      jobs.push({ raw, competition: c.competition_name, season: c.season_name });
    }
  }
  const listed = lists.reduce((n, l) => n + l.list.length, 0);
  console.log(
    `\n${all.length} competition seasons, ${listed} matches listed: ${jobs.length} available with events, ${notAvailable.length} not available, ${noEvents.length} available but with no events file`,
  );

  // The design ceiling, before a byte of events is downloaded.
  if (jobs.length > ceiling.matches) {
    console.error(
      `\nSTOP: ${jobs.length} matches is over the design ceiling of ${ceiling.matches} (MIGRATION.md Q1). Nothing was written; tell the owner.`,
    );
    process.exit(2);
  }
  const wanted = jobs.flatMap((j) => [
    `events/${j.raw.match_id}.json`,
    `lineups/${j.raw.match_id}.json`,
  ]);
  const missing = wanted.filter((p) => !data.has(p));
  const sizeOf = (paths: string[]) =>
    paths.reduce((n, p) => n + (tree.get(p)?.size ?? 0), 0);
  console.log(
    `${wanted.length} files to read (${mib(sizeOf(wanted))} as stored in the repository), ${missing.length} not in the cache yet (${mib(sizeOf(missing))})`,
  );

  // 2. Read every match, fetching what is missing. A failure is recorded, not thrown: the run
  // finishes, lists them all, and the next run resumes where this one stopped.
  const chosen = limit > 0 ? jobs.slice(0, limit) : jobs;
  const built: Built[] = [];
  let done = 0;
  let lastPrint = 0;
  t = Date.now();
  await pool(chosen, data.politeness.concurrency, async (job) => {
    const id = job.raw.match_id;
    try {
      const events = await data.json<RawEvent[]>(`events/${id}.json`);
      const lineups = await data.jsonOrNull<RawLineupTeam[]>(`lineups/${id}.json`);
      if (!fetchOnly) built.push(buildMatch(job.raw, events, lineups));
    } catch (error) {
      failures.push({
        match: id,
        competition: job.competition,
        season: job.season,
        phase: data.has(`events/${id}.json`) ? 'build' : 'download',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    done++;
    const now = Date.now();
    if (now - lastPrint > 10_000 || done === chosen.length) {
      lastPrint = now;
      const elapsed = now - t;
      const rate = done / (elapsed / 1000);
      const left = chosen.length - done;
      console.log(
        `  ${done}/${chosen.length} matches, ${data.stats.fetched} downloaded, ${data.stats.cached} from the cache, ${mib(data.stats.rawBytes)} read, ${data.stats.retries} retries, gap ${Math.round(data.gapMs())} ms, ${rate.toFixed(1)}/s, ${left ? `about ${minutes((left / Math.max(rate, 0.01)) * 1000)} left` : 'done'}`,
      );
    }
  });
  lap('read', t);
  const read = {
    downloaded: data.stats.fetched,
    cached: data.stats.cached,
    rawBytes: data.stats.rawBytes,
    wireBytes: data.stats.wireBytes,
    retries: data.stats.retries,
    slowdowns: data.stats.slowdowns,
    notFound: data.stats.notFound,
  };
  console.log(
    `\nRead ${chosen.length} matches in ${minutes(phases.read ?? 0)}: ${read.downloaded} files downloaded, ${read.cached} from the cache, ${read.retries} retries, the pace was slowed ${read.slowdowns} times`,
  );
  if (fetchOnly) {
    printFailures(failures);
    process.exit(failures.length ? 1 : 0);
  }

  // 3. Explicit exclusions, then anything that failed and is not one.
  const out = new Set(Object.keys(excluded).map(Number));
  const unexplained = failures.filter((f) => !out.has(f.match));
  const listedMissing = noEvents.filter((id) => !out.has(id));
  if (unexplained.length || listedMissing.length) {
    printFailures(unexplained);
    for (const id of listedMissing)
      console.error(
        `  match ${id}: listed as available, but the commit has no events file`,
      );
    console.error(
      '\nFailed. Nothing was written. Fix the cause, or list the match in catalogue.config.ts with its reason, then run again (it resumes).',
    );
    process.exit(1);
  }
  const kept = built.filter((b) => !out.has(b.file.meta.id));

  // 4. The ceiling again, now with the real shot count.
  const shotTotal = kept.reduce(
    (n, b) => n + b.file.shots.x.length + (b.file.shootout?.x.length ?? 0),
    0,
  );
  console.log(
    `${kept.length} matches, ${shotTotal} shots (ceiling ${ceiling.matches} and ${ceiling.shots})`,
  );
  if (shotTotal > ceiling.shots || kept.length > ceiling.matches) {
    console.error(
      `\nSTOP: ${kept.length} matches and ${shotTotal} shots is over the design ceiling (${ceiling.matches} and ${ceiling.shots}, MIGRATION.md Q1). Nothing was written; tell the owner.`,
    );
    process.exit(2);
  }

  // 5. Any value the code does not know is named here, all at once, before the database is written.
  const unknownEnums = unknownValues(kept);
  if (unknownEnums.length) {
    console.error(
      `\n${unknownEnums.length} enum values are not in @shotmap/schema's ENUMS:\n  ${unknownEnums.join('\n  ')}`,
    );
    process.exit(1);
  }

  // 6. The database.
  t = Date.now();
  const lowResolution = kept.filter(isLowResolution).length;
  const repairs = repairGoalEnds(kept);
  console.log(
    `
${lowResolution} matches record shots in whole yards; in them ${repairs.length} goals (in ${new Set(repairs.map((r) => r.match)).size} matches) ended short of the goal line and were set to it (each original is in the report)`,
  );
  const renamed = canonicalTeams(kept);
  if (renamed.length)
    console.log(
      `
${renamed.length} teams have been spelled more than one way; the newest is used, the others are searchable:`,
    );
  for (const r of renamed)
    console.log(
      `  team ${r.team}: ${r.names.map((x) => `"${x.name}" (${x.matches}, to ${x.last})`).join(', ')} -> "${r.used}"`,
    );
  const competitions = competitionsOf(kept, all);
  const stages = sortStages(new Set(kept.map((b) => b.stage)));
  const heroMatch = kept.find(
    (b) =>
      b.file.meta.competition.name === hero.competition &&
      b.file.meta.season.name === hero.season &&
      b.stage === hero.stage,
  );
  if (!heroMatch) throw new Error(`Hero match not found: ${JSON.stringify(hero)}`);
  mkdirSync(OUT, { recursive: true });
  const summary = writeDatabase(DB, {
    ref: source.ref,
    hero: heroMatch.file.meta.id,
    competitions,
    stages,
    matches: kept,
    extraMeta: {
      goal_ends_repaired: String(repairs.length),
      low_resolution_matches: String(lowResolution),
      matches_excluded: String(Object.keys(excluded).length),
      teams_respelled: String(renamed.length),
    },
    teamAliases: new Map(
      renamed.map((r) => [
        r.team,
        r.names.map((x) => x.name).filter((n) => n !== r.used),
      ]),
    ),
  });
  lap('database', t);
  console.log(
    `\nDatabase ${DB}: ${mib(statSync(DB).size)}\n  release ${summary.release}; rows: ${Object.entries(
      summary.counts,
    )
      .map(([table, n]) => `${table} ${n}`)
      .join(', ')}`,
  );

  // 7. Every check, on everything.
  t = Date.now();
  const checks = await runAllChecks(DB);
  lap('checks', t);
  let problems = 0;
  for (const c of checks) {
    console.log(
      `  ${c.problems.length ? 'FAIL' : 'ok  '} ${c.name}${c.note ? ` (${c.note})` : ''}`,
    );
    for (const p of c.problems.slice(0, 20)) console.error(`        ${p}`);
    problems += c.problems.length;
  }

  // 8. The dump D1 is loaded from.
  t = Date.now();
  const dump = writeDump(DB, DUMP);
  lap('dump', t);
  console.log(
    `  dump ${DUMP}: ${dump.statements} statements, ${mib(dump.bytes)}, largest ${dump.largestStatement} bytes (D1 allows 100,000)`,
  );

  const archived = archiveRelease({
    root: join(PACKAGE, 'out', 'releases'),
    dbPath: DB,
    dumpPath: DUMP,
    statements: dump.statements,
    scope: 'catalogue',
    checks: checks.map((c) => ({
      name: c.name,
      problems: c.problems.length,
      ...(c.note ? { note: c.note } : {}),
    })),
    excluded: Object.entries(excluded).map(([id, q]) => ({
      match: Number(id),
      reason: q.reason,
    })),
    quirks: {
      lowResolutionMatches: lowResolution,
      goalEndsRepaired: repairs.length,
      matchesExcluded: Object.keys(excluded).length,
      goalsVerifiedByHand: Object.keys(verifiedGoals).length,
      teamsRespelled: renamed.length,
    },
  });
  const written = archived.manifest.rowsWritten;
  console.log(
    `  loading it into D1 writes ${written.total.toLocaleString('en')} rows (${written.rows.toLocaleString('en')} in tables, ${written.indexEntries.toLocaleString('en')} in indexes); the Free plan allows 100,000 a day, so ${Math.ceil(written.total / 100_000)} days of it`,
  );
  console.log(`  release archived in ${archived.dir}`);

  const report = {
    ref: source.ref,
    release: summary.release,
    finished: new Date().toISOString(),
    seconds: Math.round((Date.now() - started) / 1000),
    phasesSeconds: Object.fromEntries(
      Object.entries(phases).map(([k, v]) => [k, Math.round(v / 1000)]),
    ),
    catalogue: {
      competitionSeasons: all.length,
      matchesListed: listed,
      matchesIngested: kept.length,
      notAvailable: notAvailable.length,
      noEventsFile: noEvents.length,
      excluded: Object.entries(excluded).map(([id, q]) => ({ match: Number(id), ...q })),
      renamedTeams: renamed,
      repairedGoalEnds: repairs,
      verifiedGoals,
      shots: shotTotal,
      shootoutKicks: stats.shootout,
    },
    rows: summary.counts,
    rowsWritten: written,
    read,
    files: {
      sqliteBytes: statSync(DB).size,
      dumpBytes: dump.bytes,
      statements: dump.statements,
    },
    checks: checks.map((c) => ({
      name: c.name,
      problems: c.problems.length,
      note: c.note,
    })),
    coordinates: {
      shotX: stats.x,
      shotY: stats.y,
      below60: stats.below60,
      goalEndX: stats.goalEndX,
      goalEndY: stats.goalEndY,
      goalEndZ: stats.goalEndZ,
    },
  };
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `\nDone in ${minutes(Date.now() - started)} (read ${minutes(phases.read ?? 0)}). Report: ${REPORT}`,
  );
  if (problems) {
    console.error(`\nFailed: ${problems} problems in the checks above.`);
    process.exitCode = 1;
  }
}

function printFailures(failures: Failure[]) {
  if (!failures.length) return;
  console.error(`\n${failures.length} matches failed:`);
  for (const f of failures)
    console.error(
      `  match ${f.match} (${f.competition} ${f.season}), ${f.phase}: ${f.reason}`,
    );
}

interface Renamed {
  team: number;
  names: { name: string; matches: number; last: string }[];
  used: string;
}

/**
 * A team id has one name in the database. The source sometimes spells a team two ways (a club that
 * changed its name, a typo fixed in later seasons), so every match's team is given the spelling of
 * its newest match, and the list of what was changed is returned, for the report. A match's own
 * file is not altered in any other way.
 */
function canonicalTeams(matches: Built[]): Renamed[] {
  const seen = new Map<number, Map<string, { matches: number; last: string }>>();
  for (const { file } of matches)
    for (const t of file.meta.teams) {
      const names =
        seen.get(t.id) ?? new Map<string, { matches: number; last: string }>();
      const known = names.get(t.name) ?? { matches: 0, last: '' };
      known.matches++;
      if (file.meta.date > known.last) known.last = file.meta.date;
      names.set(t.name, known);
      seen.set(t.id, names);
    }
  const renamed: Renamed[] = [];
  const used = new Map<number, string>();
  for (const [team, names] of [...seen].sort(([a], [b]) => a - b)) {
    const ranked = [...names]
      .map(([name, v]) => ({ name, ...v }))
      .sort(
        (a, b) =>
          b.last.localeCompare(a.last) ||
          b.matches - a.matches ||
          a.name.localeCompare(b.name),
      );
    const newest = ranked[0]?.name ?? '';
    used.set(team, newest);
    if (ranked.length > 1) renamed.push({ team, names: ranked, used: newest });
  }
  for (const { file } of matches)
    for (const t of file.meta.teams) t.name = used.get(t.id) ?? t.name;
  return renamed;
}

/** Competitions and their seasons as the database lists them: by name, newest season first. */
function competitionsOf(matches: Built[], all: RawCompetition[]) {
  const names = new Map<number, { name: string; latest: string }>();
  const seasons = new Map<number, Map<number, string>>();
  for (const { file } of matches) {
    const { competition, season } = file.meta;
    const known = names.get(competition.id);
    if (!known || season.name > known.latest)
      names.set(competition.id, { name: competition.name, latest: season.name });
    const forCompetition = seasons.get(competition.id) ?? new Map<number, string>();
    forCompetition.set(season.id, season.name);
    seasons.set(competition.id, forCompetition);
  }
  // A competition seen under two names across seasons is reported, and the newest name is used.
  const spellings = new Map<number, Set<string>>();
  for (const c of all)
    spellings.set(
      c.competition_id,
      (spellings.get(c.competition_id) ?? new Set()).add(c.competition_name),
    );
  for (const [id, set] of spellings)
    if (set.size > 1 && names.has(id))
      console.warn(`  competition ${id} has ${set.size} names: ${[...set].join(' | ')}`);
  return [...names]
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
    .map(([id, { name }]) => ({
      id,
      name,
      seasons: [...(seasons.get(id) ?? [])]
        .sort(([, a], [, b]) => b.localeCompare(a))
        .map(([sid, sname]) => ({ id: sid, name: sname })),
    }));
}

/** Enum values the data uses that the schema package does not know (by id, or by id and name). */
function unknownValues(matches: Built[]): string[] {
  const problems: string[] = [];
  for (const kind of ['outcome', 'bodyPart', 'shotType', 'technique'] as const) {
    for (const [id, name] of observed[kind]) {
      const known = ENUMS[kind].find((e) => e.id === id);
      if (!known) problems.push(`${kind} ${id} "${name}" is new`);
      else if (known.name !== name)
        problems.push(
          `${kind} ${id} is "${known.name}" in ENUMS and "${name}" in the data`,
        );
    }
  }
  const patterns = new Set<number>(ENUMS.playPattern.map((e) => e.id));
  const unseen = new Set<number>();
  for (const m of matches)
    for (const s of m.rich.shots)
      if (!patterns.has(s.playPattern)) unseen.add(s.playPattern);
  for (const id of unseen) problems.push(`playPattern ${id} is new`);
  return problems;
}

async function runAllChecks(path: string): Promise<Check[]> {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return checkDatabase(db, { limit: 100_000 });
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
