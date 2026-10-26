/**
 * Build-time data pipeline: StatsBomb open data in, tiny static JSON out.
 *
 *   pnpm data
 *
 * Raw downloads are cached (gzipped) in packages/ingest/.cache/, so a re-run, or a run
 * that was interrupted, only fetches what is missing. Output goes to
 * apps/web/public/data and is committed, so deploys never depend on the network.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  OUTCOME_TABLE,
  PITCH,
  SCHEMA_VERSION,
  type EnumEntry,
  type Enums,
  type IndexCompetition,
  type IndexFile,
  type MatchFile,
  type MatchRow,
  type OutcomeEntry,
  type PlayerRow,
  type ShotColumns,
} from '@shotmap/schema';
import { IndexFileSchema, MatchFileSchema } from '@shotmap/schema/zod';
import {
  budgets,
  concurrency,
  hero,
  include,
  retries,
  source,
  stageOrder,
} from './data.config';
import { runChecks } from './checks';
import { writeDatabase } from './db';
import type { MatchRecord, RichShot, RosterRow } from './rich';

// Paths do not depend on where the script is run from.
const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(PACKAGE, '.cache', 'statsbomb');
const OUT = resolve(PACKAGE, '..', '..', 'apps', 'web', 'public', 'data');
// The SQLite database (git-ignored).
const DB = join(PACKAGE, 'out', 'shotmap.sqlite');

// Only the parts of the raw files we read.
interface RawCompetition {
  competition_id: number;
  season_id: number;
  competition_name: string;
  season_name: string;
}
interface RawMatch {
  match_id: number;
  match_date: string;
  kick_off: string | null;
  match_status: string;
  home_score: number | null;
  away_score: number | null;
  competition: { competition_id: number; competition_name: string };
  season: { season_id: number; season_name: string };
  home_team: { home_team_id: number; home_team_name: string };
  away_team: { away_team_id: number; away_team_name: string };
  competition_stage: { name: string };
}
interface RawNamed {
  id: number;
  name: string;
}
interface RawShot {
  statsbomb_xg?: number;
  first_time?: boolean;
  end_location?: number[];
  body_part: RawNamed;
  type: RawNamed;
  technique: RawNamed;
  outcome: RawNamed;
}
interface RawEvent {
  id: string;
  play_pattern: RawNamed;
  period: number;
  minute: number;
  second: number;
  type: { name: string };
  team: RawNamed;
  player?: RawNamed;
  position?: { name: string };
  location?: number[];
  shot?: RawShot;
}
interface RawLineupTeam {
  team_id: number;
  lineup: {
    player_id: number;
    player_name: string;
    player_nickname: string | null;
    jersey_number: number | null;
  }[];
}

// Downloading

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

class NotFoundError extends Error {}
class FatalHttpError extends Error {}

async function download(path: string): Promise<Buffer> {
  const url = `${source.base}/${source.ref}/data/${path}`;
  let lastError = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    let wait = Math.min(30_000, 500 * 2 ** attempt) + Math.random() * 250;
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'shotmap-build-data' } });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      if (res.status === 404) throw new NotFoundError(url);
      if (res.status !== 429 && res.status < 500)
        throw new FatalHttpError(`${res.status} ${url}`);
      lastError = `HTTP ${res.status}`;
      const retryAfter = Number(res.headers.get('retry-after'));
      if (retryAfter > 0) wait = Math.max(wait, retryAfter * 1000);
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof FatalHttpError) throw error;
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < retries) {
      console.warn(
        `  retry ${attempt + 1}/${retries} in ${Math.round(wait)} ms: ${path} (${lastError})`,
      );
      await sleep(wait);
    }
  }
  throw new Error(`Giving up on ${path} after ${retries} retries: ${lastError}`);
}

/**
 * The cache is only valid for the ref it was filled from. A marker file records that
 * ref, and a cache from another ref (or a non-empty one with no marker) is refused, so
 * the dataset can never be a mix of two versions of the source.
 */
async function checkCacheRef(): Promise<void> {
  const marker = join(CACHE, 'REF');
  if (existsSync(marker)) {
    const was = (await readFile(marker, 'utf8')).trim();
    if (was !== source.ref) {
      throw new Error(
        `The cache was filled from ${was} but source.ref is ${source.ref}. Delete ${CACHE} or restore the ref.`,
      );
    }
    return;
  }
  if (existsSync(CACHE) && (await readdir(CACHE)).length > 0) {
    throw new Error(
      `${CACHE} has files but no REF marker, so its source is unknown. Delete it, or write the ref it came from into ${marker} once you have checked.`,
    );
  }
  await mkdir(CACHE, { recursive: true });
  await writeFile(
    marker,
    `${source.ref}
`,
  );
}

let fetched = 0;
let fromCache = 0;

/** Fetch a raw JSON file, through the on-disk cache. */
async function getJson<T>(path: string): Promise<T> {
  const file = join(CACHE, `${path}.gz`);
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(gunzipSync(await readFile(file)).toString('utf8')) as T;
      fromCache++;
      return parsed;
    } catch {
      await rm(file, { force: true }); // truncated or corrupt: fetch it again
    }
  }
  const body = await download(path);
  const parsed = JSON.parse(body.toString('utf8')) as T;
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, gzipSync(body));
  await rename(tmp, file);
  fetched++;
  return parsed;
}

async function getJsonOrNull<T>(path: string): Promise<T | null> {
  try {
    return await getJson<T>(path);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

async function pool<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await work(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Normalising

const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const emptyColumns = (): ShotColumns => ({
  min: [],
  sec: [],
  per: [],
  team: [],
  player: [],
  x: [],
  y: [],
  ex: [],
  ey: [],
  ez: [],
  xg: [],
  out: [],
  body: [],
  type: [],
  tech: [],
});

type EnumKey = keyof Enums;
const observed: Record<EnumKey, Map<number, string>> = {
  outcome: new Map(),
  bodyPart: new Map(),
  shotType: new Map(),
  technique: new Map(),
};

function observe(kind: EnumKey, value: RawNamed): number {
  const known = observed[kind].get(value.id);
  if (known !== undefined && known !== value.name) {
    throw new Error(`${kind} id ${value.id} is both "${known}" and "${value.name}"`);
  }
  observed[kind].set(value.id, value.name);
  return value.id;
}

/** Evidence for the coordinate system, accumulated over every event we read. */
const stats = {
  shots: 0,
  shootout: 0,
  skipped: 0,
  x: [Infinity, -Infinity],
  y: [Infinity, -Infinity],
  below60: 0,
  goals: 0,
  goalEndX: [Infinity, -Infinity],
  goalEndY: [Infinity, -Infinity],
  goalEndZ: [Infinity, -Infinity],
  posts: 0,
  postsNearPost: 0,
  rightWing: { sum: 0, n: 0 },
  leftWing: { sum: 0, n: 0 },
};

const widen = (range: number[], v: number) => {
  range[0] = Math.min(range[0] ?? v, v);
  range[1] = Math.max(range[1] ?? v, v);
};

type Built = MatchRecord;

function buildMatch(
  raw: RawMatch,
  events: RawEvent[],
  lineups: RawLineupTeam[] | null,
): Built {
  if (raw.home_score === null || raw.away_score === null) {
    throw new Error(`match ${raw.match_id} has no score`);
  }
  const homeId = raw.home_team.home_team_id;
  const awayId = raw.away_team.away_team_id;

  const teamIndex = (id: number): 0 | 1 => {
    if (id === homeId) return 0;
    if (id === awayId) return 1;
    throw new Error(`match ${raw.match_id}: shot by unknown team ${id}`);
  };

  const names = new Map<number, { name: string; full: string; shirt: number | null }>();
  for (const team of lineups ?? []) {
    for (const p of team.lineup) {
      names.set(p.player_id, {
        name: p.player_nickname ?? p.player_name,
        full: p.player_name,
        shirt: p.jersey_number,
      });
    }
  }

  const ownGoals: [number, number] = [0, 0];
  const players: PlayerRow[] = [];
  const playerIndex = new Map<number, number>();
  const shots = emptyColumns();
  const shootout = emptyColumns();
  // What the static files drop, for the database.
  const richOpen: RichShot[] = [];
  const richKick: RichShot[] = [];
  const roster: RosterRow[] = [];

  for (const e of events) {
    if (e.position && e.location) {
      const y = e.location[1];
      if (y !== undefined && e.position.name === 'Right Wing') {
        stats.rightWing.sum += y;
        stats.rightWing.n++;
      } else if (y !== undefined && e.position.name === 'Left Wing') {
        stats.leftWing.sum += y;
        stats.leftWing.n++;
      }
    }
    if (e.type.name === 'Own Goal For' && e.period !== 5)
      ownGoals[teamIndex(e.team.id)]++;
    if (e.type.name !== 'Shot') continue;

    const { shot, player, location } = e;
    const [sx, sy] = location ?? [];
    if (!shot || !player || sx === undefined || sy === undefined) {
      stats.skipped++;
      continue;
    }
    const team = teamIndex(e.team.id);
    if (typeof shot.statsbomb_xg !== 'number')
      throw new Error(`match ${raw.match_id}: shot without xG`);
    const [ex, ey, ez] = shot.end_location ?? [];
    if (ex === undefined || ey === undefined)
      throw new Error(`match ${raw.match_id}: shot without end location`);

    let index = playerIndex.get(player.id);
    if (index === undefined) {
      const known = names.get(player.id);
      index = players.length;
      playerIndex.set(player.id, index);
      players.push([known?.name ?? player.name, team, known?.shirt ?? null]);
      roster.push({
        playerId: player.id,
        teamId: e.team.id,
        side: team,
        name: known?.name ?? player.name,
        fullName: known?.full ?? player.name,
        shirt: known?.shirt ?? null,
      });
    }

    const out = observe('outcome', shot.outcome);
    const into = e.period === 5 ? shootout : shots;
    into.min.push(e.minute);
    into.sec.push(e.second);
    into.per.push(e.period);
    into.team.push(team);
    into.player.push(index);
    into.x.push(r1(sx));
    into.y.push(r1(sy));
    into.ex.push(r1(ex));
    into.ey.push(r1(ey));
    into.ez.push(ez === undefined ? null : r1(ez));
    into.xg.push(r3(shot.statsbomb_xg));
    into.out.push(out);
    into.body.push(observe('bodyPart', shot.body_part));
    into.type.push(observe('shotType', shot.type));
    into.tech.push(observe('technique', shot.technique));
    (e.period === 5 ? richKick : richOpen).push({
      uuid: e.id,
      playerId: player.id,
      teamId: e.team.id,
      playPattern: e.play_pattern.id,
      firstTime: shot.first_time === true,
    });

    if (e.period === 5) {
      stats.shootout++;
      continue;
    }
    stats.shots++;
    widen(stats.x, sx);
    widen(stats.y, sy);
    if (sx < PITCH.length / 2) stats.below60++;
    if (shot.outcome.name === 'Goal') {
      stats.goals++;
      widen(stats.goalEndX, ex);
      widen(stats.goalEndY, ey);
      if (ez !== undefined) widen(stats.goalEndZ, ez);
    }
    if (shot.outcome.name === 'Post') {
      stats.posts++;
      const [left, right] = PITCH.goalY;
      if (Math.min(Math.abs(ey - left), Math.abs(ey - right)) <= 1) stats.postsNearPost++;
    }
  }

  const hasShootout = shootout.min.length > 0;

  const file: MatchFile = {
    v: SCHEMA_VERSION,
    meta: {
      id: raw.match_id,
      date: raw.match_date,
      kickoff: raw.kick_off ? raw.kick_off.slice(0, 5) : null,
      competition: {
        id: raw.competition.competition_id,
        name: raw.competition.competition_name,
      },
      season: { id: raw.season.season_id, name: raw.season.season_name },
      stage: raw.competition_stage.name,
      teams: [
        {
          id: homeId,
          name: raw.home_team.home_team_name,
          score: raw.home_score,
          pens: hasShootout ? goalsOf(shootout, 0) : null,
        },
        {
          id: awayId,
          name: raw.away_team.away_team_name,
          score: raw.away_score,
          pens: hasShootout ? goalsOf(shootout, 1) : null,
        },
      ],
    },
    players,
    shots,
    shootout: hasShootout ? shootout : null,
  };
  return {
    file,
    stage: raw.competition_stage.name,
    ownGoals,
    rich: { shots: [...richOpen, ...richKick], roster },
  };
}

// Output

const goalsOf = (cols: ShotColumns, team: number) =>
  cols.out.filter((o, i) => observed.outcome.get(o) === 'Goal' && cols.team[i] === team)
    .length;

const gz = (text: string) => gzipSync(text, { level: 9 }).length;
const kb = (n: number) => (n / 1024).toFixed(2).padStart(8);

function enumEntries(kind: 'bodyPart' | 'shotType' | 'technique'): EnumEntry[] {
  return [...observed[kind]]
    .sort(([a], [b]) => a - b)
    .map(([id, name]) => ({ id, name, label: name }));
}

function legend(): Enums {
  const outcome: OutcomeEntry[] = [...observed.outcome]
    .sort(([a], [b]) => a - b)
    .map(([id, name]) => {
      const known = OUTCOME_TABLE[name];
      if (!known) {
        throw new Error(
          `Unknown shot outcome "${name}" (id ${id}). Add it to \`outcomes\` in scripts/data.config.ts.`,
        );
      }
      return { id, name, label: known.label, group: known.group };
    });
  return {
    outcome,
    bodyPart: enumEntries('bodyPart'),
    shotType: enumEntries('shotType'),
    technique: enumEntries('technique'),
  };
}

function sortStages(stages: Set<string>): string[] {
  const rank = (s: string) => {
    const i = stageOrder.indexOf(s);
    return i < 0 ? stageOrder.length : i;
  };
  return [...stages].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

async function main() {
  const started = Date.now();
  await checkCacheRef();
  console.log(`StatsBomb open data @ ${source.ref}, cache ${CACHE}`);

  const all = await getJson<RawCompetition[]>('competitions.json');
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
    const list = await getJson<RawMatch[]>(
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
      getJson<RawEvent[]>(`events/${raw.match_id}.json`),
      getJsonOrNull<RawLineupTeam[]>(`lineups/${raw.match_id}.json`),
    ]);
    const result = buildMatch(raw, events, lineups);
    done++;
    if (done % 10 === 0 || done === jobs.length)
      console.log(
        `  ${done}/${jobs.length} matches (${fetched} downloaded, ${fromCache} cached)`,
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
  for (const c of runChecks(DB)) {
    console.log(
      `  ${c.problems.length ? 'FAIL' : 'ok  '} ${c.name}${c.note ? ` (${c.note})` : ''}`,
    );
    for (const p of c.problems.slice(0, 10)) console.error(`        ${p}`);
    if (c.problems.length)
      failures.push(`database check "${c.name}": ${c.problems.length} problems`);
  }
  if (failures.length) {
    console.error(`\nFailed:\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
