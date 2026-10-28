/**
 * The /v1 answers, computed from the database: the `data` part of each response, shaped as
 * @shotmap/schema/zod says. One implementation runs on D1 in the Worker and on node:sqlite in
 * ingest and the tests, so what the parity test checks is what production runs.
 *
 * Every query binds its parameters, and every query has a bound on the rows it can return,
 * so no endpoint can answer more than a bounded page even at the design ceiling of about
 * 10,000 matches and 500,000 shots.
 */
import { LIMITS, OUTCOMES, wordsOf } from '@shotmap/schema';
import type {
  Competitions,
  Compare,
  Density,
  MatchDetail,
  MatchList,
  MatchShots,
  Meta,
  Outcome,
  Player,
  PlayerShots,
  SearchResult,
} from '@shotmap/schema';
import { num, orNull, str, type Db, type Row, type Value } from './db';

export class TooManyRows extends Error {
  override readonly name = 'TooManyRows';
}

const metaValues = (rows: Row[]): Record<string, string> =>
  Object.fromEntries(rows.map((r) => [str(r.key), str(r.value)]));

/** The data release this database holds. */
export async function releaseOf(db: Db): Promise<string> {
  const rows = await db.all("SELECT value FROM meta WHERE key = 'release'");
  return str(rows[0]?.value);
}

const COMPETITIONS_SQL = `SELECT c.id AS cid, c.name AS cname, s.id AS sid, s.name AS sname, s.match_count AS matches
  FROM competitions c JOIN seasons s ON s.competition_id = c.id
  ORDER BY c.sort, s.sort LIMIT ${LIMITS.metaRowsMax}`;
const STAGES_SQL = `SELECT id, name FROM stages ORDER BY sort LIMIT ${LIMITS.metaRowsMax}`;

function competitionsOf(seasons: Row[], stages: Row[]): Competitions {
  const out: Competitions['competitions'] = [];
  for (const r of seasons) {
    let competition = out.find((c) => c.id === num(r.cid));
    if (!competition) {
      competition = { id: num(r.cid), name: str(r.cname), seasons: [] };
      out.push(competition);
    }
    competition.seasons.push({
      id: num(r.sid),
      name: str(r.sname),
      matches: num(r.matches),
    });
  }
  return {
    competitions: out,
    stages: stages.map((r) => ({ id: num(r.id), name: str(r.name) })),
  };
}

export async function exportCompetitions(db: Db): Promise<Competitions> {
  const [seasons = [], stages = []] = await db.batch([
    { sql: COMPETITIONS_SQL },
    { sql: STAGES_SQL },
  ]);
  return competitionsOf(seasons, stages);
}

/** What /v1/meta answers: the release's source and size, and what it covers. Three small reads, no counting. */
export async function exportMeta(db: Db): Promise<Meta> {
  const [meta = [], seasons = [], stages = []] = await db.batch([
    { sql: 'SELECT key, value FROM meta' },
    { sql: COMPETITIONS_SQL },
    { sql: STAGES_SQL },
  ]);
  const m = metaValues(meta);
  return {
    source: { name: 'StatsBomb open data', ref: m.source_ref ?? '' },
    released: { date: m.release_date ?? '', hash: m.content_hash ?? '' },
    schemaVersion: num(m.schema_version),
    counts: {
      matches: num(m.count_matches),
      shots: num(m.count_shots),
      players: num(m.count_players),
      teams: num(m.count_teams),
    },
    ...competitionsOf(seasons, stages),
  };
}

export interface MatchQuery {
  competition?: number;
  season?: number;
  stage?: number;
  team?: number;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
  /** Oldest first unless this says newest. A cursor goes with the order that made it. */
  order?: 'oldest' | 'newest';
}

const TEAMS = `JOIN teams th ON th.id = m.home_team_id JOIN teams ta ON ta.id = m.away_team_id`;

/** A cursor that is not one of ours. */
export class BadCursor extends Error {
  override readonly name = 'BadCursor';
}

/** The cursor is the last row's sort key: 2022-12-18_1700_3869685. Clients treat it as opaque. */
function decodeCursor(cursor: string): [string, string, number] {
  const m = /^(\d{4}-\d{2}-\d{2})_(\d{4})?_(\d{1,9})$/.exec(cursor);
  if (!m) throw new BadCursor('the cursor is not valid');
  const hhmm = m[2];
  return [
    m[1] as string,
    hhmm ? `${hhmm.slice(0, 2)}:${hhmm.slice(2)}` : '',
    Number(m[3]),
  ];
}

const encodeCursor = (date: string, kickoff: string, id: number): string =>
  `${date}_${kickoff.replace(':', '')}_${id}`;

/** Oldest first (or newest first): by date, then kick-off, then id. The cursor is the last row's sort key. */
export async function exportMatchList(db: Db, q: MatchQuery = {}): Promise<MatchList> {
  const limit = Math.max(
    1,
    Math.min(q.limit ?? LIMITS.matchesPageDefault, LIMITS.matchesPageMax),
  );
  const where: string[] = [];
  const params: Value[] = [];
  const add = (sql: string, ...values: Value[]) => {
    where.push(sql);
    params.push(...values);
  };
  if (q.competition !== undefined) add('m.competition_id = ?', q.competition);
  if (q.season !== undefined) add('m.season_id = ?', q.season);
  if (q.stage !== undefined) add('m.stage_id = ?', q.stage);
  if (q.from !== undefined) add('m.date >= ?', q.from);
  if (q.to !== undefined) add('m.date <= ?', q.to);
  const newest = q.order === 'newest';
  if (q.cursor !== undefined) {
    const [date, kickoff, id] = decodeCursor(q.cursor);
    // The plain date bound lets SQLite start in the matches(date) index instead of at the first row.
    add(
      newest
        ? "m.date <= ? AND (m.date, COALESCE(m.kickoff, ''), m.id) < (?, ?, ?)"
        : "m.date >= ? AND (m.date, COALESCE(m.kickoff, ''), m.id) > (?, ?, ?)",
      date,
      date,
      kickoff,
      id,
    );
  }
  const direction = newest ? 'DESC' : 'ASC';
  // Plain kick-off, not COALESCE'd: a missing one sorts first going up and last going down, which is
  // where '' goes, and it lets the (date, kickoff, id) indexes give the order with no sorting.
  const order = `ORDER BY m.date ${direction}, m.kickoff ${direction}, m.id ${direction}`;
  const select = (extra: string[], values: Value[], count: number) => ({
    sql: `SELECT m.id, m.date, m.kickoff, m.competition_id, m.season_id, m.stage_id,
            m.home_team_id, th.name AS home, m.home_score, m.home_pens,
            m.away_team_id, ta.name AS away, m.away_score, m.away_pens
     FROM matches m ${TEAMS}
     ${where.length + extra.length ? `WHERE ${[...extra, ...where].join(' AND ')}` : ''}
     ${order} LIMIT ?`,
    params: [...values, ...params, count],
  });
  const wanted = limit + 1;
  let found: Row[];
  if (q.team === undefined) {
    const one = select([], [], wanted);
    found = await db.all(one.sql, one.params);
  } else {
    // A team's matches are home ones and away ones, each already in order in its own index: read a
    // page of each and merge them, instead of one OR that reads every match the team ever played.
    const home = select(['m.home_team_id = ?'], [q.team], wanted);
    const away = select(['m.away_team_id = ?'], [q.team], wanted);
    found = await db.all(
      `SELECT * FROM (SELECT * FROM (${home.sql}) UNION ALL SELECT * FROM (${away.sql}))
       ORDER BY date ${direction}, kickoff ${direction}, id ${direction} LIMIT ?`,
      [...home.params, ...away.params, wanted],
    );
  }
  const page = found.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      id: num(r.id),
      date: str(r.date),
      competition: num(r.competition_id),
      season: num(r.season_id),
      stage: num(r.stage_id),
      home: {
        id: num(r.home_team_id),
        name: str(r.home),
        score: num(r.home_score),
        pens: orNull(r.home_pens),
      },
      away: {
        id: num(r.away_team_id),
        name: str(r.away),
        score: num(r.away_score),
        pens: orNull(r.away_pens),
      },
    })),
    next:
      found.length > limit && last
        ? encodeCursor(
            str(last.date),
            last.kickoff === null ? '' : str(last.kickoff),
            num(last.id),
          )
        : null,
  };
}

export async function exportMatch(db: Db, id: number): Promise<MatchDetail | undefined> {
  const [found = [], players = []] = await db.batch([
    {
      sql: `SELECT m.*, c.name AS competition, s.name AS season, st.name AS stage, th.name AS home, ta.name AS away
            FROM matches m ${TEAMS}
            JOIN competitions c ON c.id = m.competition_id
            JOIN seasons s ON s.competition_id = m.competition_id AND s.id = m.season_id
            JOIN stages st ON st.id = m.stage_id
            WHERE m.id = ?`,
      params: [id],
    },
    {
      sql: `SELECT player_id, name, side, team_id, shirt FROM match_players
            WHERE match_id = ? ORDER BY first_seq LIMIT ${LIMITS.matchPlayersMax}`,
      params: [id],
    },
  ]);
  const m = found[0];
  if (!m) return undefined;
  return {
    id: num(m.id),
    date: str(m.date),
    kickoff: m.kickoff === null ? null : str(m.kickoff),
    competition: { id: num(m.competition_id), name: str(m.competition) },
    season: { id: num(m.season_id), name: str(m.season) },
    stage: { id: num(m.stage_id), name: str(m.stage) },
    teams: [
      {
        id: num(m.home_team_id),
        name: str(m.home),
        score: num(m.home_score),
        pens: orNull(m.home_pens),
      },
      {
        id: num(m.away_team_id),
        name: str(m.away),
        score: num(m.away_score),
        pens: orNull(m.away_pens),
      },
    ],
    players: players.map((r) => ({
      id: num(r.player_id),
      name: str(r.name),
      side: num(r.side) === 0 ? (0 as const) : (1 as const),
      team: num(r.team_id),
      shirt: orNull(r.shirt),
    })),
  };
}

const COLUMNS = `s.id AS shot, s.seq, s.side, s.team_id AS team, s.player_id AS player, s.period,
  s.minute AS min, s.second AS sec, s.x, s.y, s.ex, s.ey, s.ez, s.xg,
  s.outcome AS out, s.body, s.type, s.tech`;
const KEYS = [
  'shot',
  'seq',
  'side',
  'team',
  'player',
  'period',
  'min',
  'sec',
  'x',
  'y',
  'ex',
  'ey',
  'ez',
  'xg',
  'out',
  'body',
  'type',
  'tech',
] as const;

function columnsOf(found: Row[], withMatch: boolean) {
  const cols: Record<string, (number | null)[]> = {};
  for (const key of KEYS)
    cols[key] = found.map((r) => (key === 'ez' ? orNull(r[key]) : num(r[key])));
  if (withMatch) cols.match = found.map((r) => num(r.match));
  return { n: found.length, cols };
}

/** One match's shots, in seq order: open play, then the shootout kicks. Undefined if there is no such match. */
export async function exportMatchShots(
  db: Db,
  id: number,
): Promise<MatchShots | undefined> {
  const [exists = [], found = []] = await db.batch([
    { sql: 'SELECT 1 AS found FROM matches WHERE id = ?', params: [id] },
    {
      sql: `SELECT ${COLUMNS} FROM shots s WHERE s.match_id = ? ORDER BY s.seq LIMIT ${LIMITS.matchShotsMax + 1}`,
      params: [id],
    },
  ]);
  if (exists.length === 0) return undefined;
  if (found.length > LIMITS.matchShotsMax)
    throw new TooManyRows(`match ${id} has more than ${LIMITS.matchShotsMax} shots`);
  return columnsOf(found, false) as MatchShots;
}

export interface ShotFilters {
  competition?: number;
  season?: number;
  period?: 'open' | 'shootout';
  outcome?: Outcome[];
  /** StatsBomb shot type ids (ENUMS.shotType): corner, free kick, open play, penalty. */
  type?: number[];
}

function filterSql(f: ShotFilters): { where: string; params: Value[] } {
  const parts: string[] = [];
  const params: Value[] = [];
  if (f.competition !== undefined) {
    parts.push('m.competition_id = ?');
    params.push(f.competition);
  }
  if (f.season !== undefined) {
    parts.push('m.season_id = ?');
    params.push(f.season);
  }
  if (f.period === 'open') parts.push('s.period <= 4');
  if (f.period === 'shootout') parts.push('s.period = 5');
  if (f.outcome?.length)
    parts.push(
      `s.outcome_group IN (${f.outcome.map((o) => OUTCOMES.indexOf(o)).join(',')})`,
    );
  if (f.type?.length) {
    parts.push(`s.type IN (${f.type.map(() => '?').join(',')})`);
    params.push(...f.type);
  }
  return { where: parts.map((p) => ` AND ${p}`).join(''), params };
}

/**
 * A player's shots across matches, sorted by match then seq. At most `limit` of them, never more
 * than LIMITS.playerShotsMax; `truncated` says whether there were more, and what is returned is
 * the first ones. Undefined for a player who does not exist (an unknown id is not "no shots").
 */
export async function exportPlayerShots(
  db: Db,
  playerId: number,
  f: ShotFilters = {},
  limit: number = LIMITS.playerShotsDefault,
): Promise<PlayerShots | undefined> {
  const { where, params } = filterSql(f);
  const cap = Math.max(1, Math.min(Math.trunc(limit), LIMITS.playerShotsMax));
  // The match is only looked up when the filter needs it: a lookup per shot is a row read each.
  const needsMatch = f.competition !== undefined || f.season !== undefined;
  const from = `FROM shots s ${needsMatch ? 'JOIN matches m ON m.id = s.match_id ' : ''}WHERE s.player_id = ?${where}`;
  const [who = [], found = []] = await db.batch([
    { sql: 'SELECT 1 AS found FROM players WHERE id = ?', params: [playerId] },
    {
      // One more than asked for, to know whether there is more.
      sql: `SELECT ${COLUMNS}, s.match_id AS match ${from} ORDER BY s.match_id, s.seq LIMIT ${cap + 1}`,
      params: [playerId, ...params],
    },
  ]);
  if (who.length === 0) return undefined;
  const truncated = found.length > cap;
  const columns = columnsOf(truncated ? found.slice(0, cap) : found, true);
  return { ...columns, truncated } as PlayerShots;
}

/**
 * A player's shots counted into `step`-yard squares: a database does the counting, so a career of
 * thousands of shots is a few hundred cells. Sparse (only squares with a shot appear), ordered by
 * gx then gy. The bins are `floor(coordinate / step)` of the shot's start, which is the same for
 * every team because ingest turns each of them to attack toward x = 120. Undefined for a player
 * who does not exist, as for their shots.
 */
export async function exportDensity(
  db: Db,
  playerId: number,
  step = 2,
  f: ShotFilters = {},
): Promise<Density | undefined> {
  if (!(LIMITS.densitySteps as readonly number[]).includes(step))
    throw new RangeError(`step must be one of ${LIMITS.densitySteps.join(', ')}`);
  const { where, params } = filterSql(f);
  // As for the shots: the match is only looked up when the filter names a competition or season.
  const needsMatch = f.competition !== undefined || f.season !== undefined;
  const [who = [], found = []] = await db.batch([
    { sql: 'SELECT 1 AS found FROM players WHERE id = ?', params: [playerId] },
    {
      sql: `SELECT CAST(s.x / ? AS INTEGER) AS gx, CAST(s.y / ? AS INTEGER) AS gy, COUNT(*) AS n,
                   SUM(s.xg) AS xg, SUM(s.outcome_group = 0) AS goals
            FROM shots s ${needsMatch ? 'JOIN matches m ON m.id = s.match_id ' : ''}WHERE s.player_id = ?${where}
            GROUP BY gx, gy ORDER BY gx, gy`,
      params: [step, step, playerId, ...params],
    },
  ]);
  if (who.length === 0) return undefined;
  return {
    step,
    gx: found.map((r) => num(r.gx)),
    gy: found.map((r) => num(r.gy)),
    n: found.map((r) => num(r.n)),
    xg: found.map((r) => Math.round(num(r.xg) * 1000) / 1000),
    goals: found.map((r) => num(r.goals)),
  };
}

/** A player, summed over every team. Open play only, as the product counts it. */
export async function exportPlayer(db: Db, id: number): Promise<Player | undefined> {
  const [who = [], totals = [], teams = [], seasons = []] = await db.batch([
    { sql: 'SELECT id, name, full_name FROM players WHERE id = ?', params: [id] },
    {
      sql: `SELECT COUNT(DISTINCT match_id) AS matches, COUNT(*) AS shots, COALESCE(SUM(outcome_group = 0), 0) AS goals,
                   COALESCE(SUM(outcome_group IN (0, 1)), 0) AS onTarget, COALESCE(SUM(xg), 0) AS xg
            FROM shots WHERE player_id = ? AND period <= 4`,
      params: [id],
    },
    {
      sql: `SELECT t.id, t.name, COUNT(*) AS shots FROM shots s JOIN teams t ON t.id = s.team_id
            WHERE s.player_id = ? AND s.period <= 4 GROUP BY t.id ORDER BY shots DESC, t.name LIMIT 50`,
      params: [id],
    },
    {
      // One row per competition season the player shot in, oldest first.
      sql: `SELECT c.id AS cid, c.name AS cname, se.id AS sid, se.name AS sname,
                   COUNT(DISTINCT s.match_id) AS matches, COUNT(*) AS shots,
                   COALESCE(SUM(s.outcome_group = 0), 0) AS goals,
                   COALESCE(SUM(s.outcome_group IN (0, 1)), 0) AS onTarget,
                   COALESCE(SUM(s.xg), 0) AS xg, MIN(m.date) AS first
            FROM shots s JOIN matches m ON m.id = s.match_id
            JOIN competitions c ON c.id = m.competition_id
            JOIN seasons se ON se.competition_id = m.competition_id AND se.id = m.season_id
            WHERE s.player_id = ? AND s.period <= 4
            GROUP BY m.competition_id, m.season_id ORDER BY first, c.name LIMIT ${LIMITS.metaRowsMax}`,
      params: [id],
    },
  ]);
  const p = who[0];
  const t = totals[0];
  if (!p || !t) return undefined;
  return {
    id: num(p.id),
    name: str(p.name),
    fullName: str(p.full_name),
    teams: teams.map((r) => ({ id: num(r.id), name: str(r.name), shots: num(r.shots) })),
    totals: {
      matches: num(t.matches),
      shots: num(t.shots),
      goals: num(t.goals),
      onTarget: num(t.onTarget),
      xg: Math.round(num(t.xg) * 1000) / 1000,
    },
    seasons: seasons.map((r) => ({
      competition: { id: num(r.cid), name: str(r.cname) },
      season: { id: num(r.sid), name: str(r.sname) },
      matches: num(r.matches),
      shots: num(r.shots),
      goals: num(r.goals),
      onTarget: num(r.onTarget),
      xg: Math.round(num(r.xg) * 1000) / 1000,
    })),
  };
}

export async function exportCompare(
  db: Db,
  a: number,
  b: number,
): Promise<Compare | undefined> {
  const [pa, pb] = await Promise.all([exportPlayer(db, a), exportPlayer(db, b)]);
  return pa && pb ? { a: pa, b: pb } : undefined;
}

/** Players, teams and matches whose words start with every word typed. */
export async function exportSearch(
  db: Db,
  q: string,
  limit: number = LIMITS.searchPerKind,
): Promise<SearchResult> {
  const words = wordsOf(q).slice(0, 8);
  const empty: SearchResult = { q, players: [], teams: [], matches: [] };
  if (words.length === 0) return empty;
  const refs = () =>
    words
      .map(() => 'SELECT ref FROM search_terms WHERE kind = ? AND term >= ? AND term < ?')
      .join(' INTERSECT ');
  const params = (kind: number): Value[] =>
    words.flatMap((w): Value[] => [kind, w, `${w}￿`]);
  const cap = Math.max(1, Math.min(limit, LIMITS.searchPerKind));
  const [players = [], teams = [], matches = []] = await db.batch([
    {
      sql: `SELECT id, name FROM players WHERE id IN (${refs()}) ORDER BY name LIMIT ${cap}`,
      params: params(1),
    },
    {
      sql: `SELECT id, name FROM teams WHERE id IN (${refs()}) ORDER BY name LIMIT ${cap}`,
      params: params(2),
    },
    {
      sql: `SELECT m.id, m.date, th.name AS home, ta.name AS away FROM matches m ${TEAMS}
            WHERE m.id IN (${refs()}) ORDER BY m.date DESC, m.id DESC LIMIT ${cap}`,
      params: params(3),
    },
  ]);
  return {
    q,
    players: players.map((r) => ({ id: num(r.id), name: str(r.name) })),
    teams: teams.map((r) => ({ id: num(r.id), name: str(r.name) })),
    matches: matches.map((r) => ({
      id: num(r.id),
      date: str(r.date),
      home: str(r.home),
      away: str(r.away),
    })),
  };
}
