/**
 * The /v1 answers, computed from the database. These are the queries the API will run
 * against D1; they run here, on node:sqlite, so the contract and the parity test can
 * exercise the real SQL against the real data. Each function returns the `data` part
 * of a response, shaped as @shotmap/schema/zod says.
 */
import { DatabaseSync } from 'node:sqlite';
import { LIMITS, OUTCOMES, wordsOf } from '@shotmap/schema';
import type {
  Competitions,
  Compare,
  Density,
  MatchDetail,
  MatchList,
  MatchShots,
  Outcome,
  Player,
  PlayerShots,
  SearchResult,
} from '@shotmap/schema';

type Row = Record<string, unknown>;
type Param = string | number;

const num = (v: unknown): number => Number(v);
const str = (v: unknown): string => String(v);
const orNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);
const round = (v: number, dp: number): number => Math.round(v * 10 ** dp) / 10 ** dp;
const rows = (db: DatabaseSync, sql: string, ...params: Param[]): Row[] =>
  db.prepare(sql).all(...params);

export function openDatabase(path: string): DatabaseSync {
  return new DatabaseSync(path, { readOnly: true });
}

/** The data release this database holds. */
export function releaseOf(db: DatabaseSync): string {
  return str(rows(db, "SELECT value FROM meta WHERE key = 'release'")[0]?.value);
}

export class TooManyRows extends Error {
  override readonly name = 'TooManyRows';
}

export function exportCompetitions(db: DatabaseSync): Competitions {
  const out: Competitions['competitions'] = [];
  for (const r of rows(
    db,
    `SELECT c.id AS cid, c.name AS cname, s.id AS sid, s.name AS sname,
            (SELECT COUNT(*) FROM matches m WHERE m.competition_id = c.id AND m.season_id = s.id) AS matches
     FROM competitions c JOIN seasons s ON s.competition_id = c.id
     ORDER BY c.sort, s.sort`,
  )) {
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
  const stages = rows(db, 'SELECT id, name FROM stages ORDER BY sort').map((r) => ({
    id: num(r.id),
    name: str(r.name),
  }));
  return { competitions: out, stages };
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
}

const TEAMS = `JOIN teams th ON th.id = m.home_team_id JOIN teams ta ON ta.id = m.away_team_id`;

/** Oldest first: by date, then kick-off, then id. The cursor is the last row's sort key. */
export function exportMatchList(db: DatabaseSync, q: MatchQuery = {}): MatchList {
  const limit = Math.min(q.limit ?? LIMITS.matchesPageDefault, LIMITS.matchesPageMax);
  const where: string[] = [];
  const params: Param[] = [];
  const add = (sql: string, ...values: Param[]) => {
    where.push(sql);
    params.push(...values);
  };
  if (q.competition !== undefined) add('m.competition_id = ?', q.competition);
  if (q.season !== undefined) add('m.season_id = ?', q.season);
  if (q.stage !== undefined) add('m.stage_id = ?', q.stage);
  if (q.team !== undefined)
    add('(m.home_team_id = ? OR m.away_team_id = ?)', q.team, q.team);
  if (q.from !== undefined) add('m.date >= ?', q.from);
  if (q.to !== undefined) add('m.date <= ?', q.to);
  if (q.cursor !== undefined) {
    const [date, kickoff, id] = JSON.parse(
      Buffer.from(q.cursor, 'base64url').toString(),
    ) as [string, string, number];
    add("(m.date, COALESCE(m.kickoff, ''), m.id) > (?, ?, ?)", date, kickoff, id);
  }
  const found = rows(
    db,
    `SELECT m.id, m.date, m.kickoff, m.competition_id, m.season_id, m.stage_id,
            m.home_team_id, th.name AS home, m.home_score, m.home_pens,
            m.away_team_id, ta.name AS away, m.away_score, m.away_pens
     FROM matches m ${TEAMS}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY m.date, COALESCE(m.kickoff, ''), m.id LIMIT ${limit + 1}`,
    ...params,
  );
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
        ? Buffer.from(
            JSON.stringify([
              str(last.date),
              last.kickoff === null ? '' : str(last.kickoff),
              num(last.id),
            ]),
          ).toString('base64url')
        : null,
  };
}

export function exportMatch(db: DatabaseSync, id: number): MatchDetail | undefined {
  const m = rows(
    db,
    `SELECT m.*, c.name AS competition, s.name AS season, st.name AS stage, th.name AS home, ta.name AS away
     FROM matches m ${TEAMS}
     JOIN competitions c ON c.id = m.competition_id
     JOIN seasons s ON s.competition_id = m.competition_id AND s.id = m.season_id
     JOIN stages st ON st.id = m.stage_id
     WHERE m.id = ?`,
    id,
  )[0];
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
    players: rows(
      db,
      'SELECT player_id, name, side, team_id, shirt FROM match_players WHERE match_id = ? ORDER BY first_seq',
      id,
    ).map((r) => ({
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

/** One match's shots, in seq order: open play, then the shootout kicks. */
export function exportMatchShots(db: DatabaseSync, id: number): MatchShots {
  return columnsOf(
    rows(db, `SELECT ${COLUMNS} FROM shots s WHERE s.match_id = ? ORDER BY s.seq`, id),
    false,
  ) as MatchShots;
}

export interface ShotFilters {
  competition?: number;
  season?: number;
  period?: 'open' | 'shootout';
  outcome?: Outcome[];
}

function filterSql(f: ShotFilters): { where: string; params: Param[] } {
  const parts: string[] = [];
  const params: Param[] = [];
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
  return { where: parts.map((p) => ` AND ${p}`).join(''), params };
}

/** A player's shots across matches, sorted by match then seq. */
export function exportPlayerShots(
  db: DatabaseSync,
  playerId: number,
  f: ShotFilters = {},
): PlayerShots {
  const { where, params } = filterSql(f);
  const from = `FROM shots s JOIN matches m ON m.id = s.match_id WHERE s.player_id = ?${where}`;
  const count = num(rows(db, `SELECT COUNT(*) AS n ${from}`, playerId, ...params)[0]?.n);
  if (count > LIMITS.playerShotsMax)
    throw new TooManyRows(
      `${count} shots is more than ${LIMITS.playerShotsMax}: ask for density`,
    );
  return columnsOf(
    rows(
      db,
      `SELECT ${COLUMNS}, s.match_id AS match ${from} ORDER BY s.match_id, s.seq`,
      playerId,
      ...params,
    ),
    true,
  ) as PlayerShots;
}

/** A player's shots counted into `step`-yard squares. Sparse. */
export function exportDensity(
  db: DatabaseSync,
  playerId: number,
  step = 2,
  f: ShotFilters = {},
): Density {
  if (!(LIMITS.densitySteps as readonly number[]).includes(step))
    throw new RangeError(`step must be one of ${LIMITS.densitySteps.join(', ')}`);
  const { where, params } = filterSql(f);
  const found = rows(
    db,
    `SELECT CAST(s.x / ? AS INTEGER) AS gx, CAST(s.y / ? AS INTEGER) AS gy, COUNT(*) AS n,
            SUM(s.xg) AS xg, SUM(s.outcome_group = 0) AS goals
     FROM shots s JOIN matches m ON m.id = s.match_id
     WHERE s.player_id = ?${where}
     GROUP BY gx, gy ORDER BY gx, gy`,
    step,
    step,
    playerId,
    ...params,
  );
  return {
    step,
    gx: found.map((r) => num(r.gx)),
    gy: found.map((r) => num(r.gy)),
    n: found.map((r) => num(r.n)),
    xg: found.map((r) => round(num(r.xg), 3)),
    goals: found.map((r) => num(r.goals)),
  };
}

/** A player, summed over every team. Open play only, as the product counts it. */
export function exportPlayer(db: DatabaseSync, id: number): Player | undefined {
  const p = rows(db, 'SELECT id, name, full_name FROM players WHERE id = ?', id)[0];
  if (!p) return undefined;
  const totals = rows(
    db,
    `SELECT COUNT(DISTINCT match_id) AS matches, COUNT(*) AS shots, COALESCE(SUM(outcome_group = 0), 0) AS goals,
            COALESCE(SUM(outcome_group IN (0, 1)), 0) AS onTarget, COALESCE(SUM(xg), 0) AS xg
     FROM shots WHERE player_id = ? AND period <= 4`,
    id,
  )[0] as Row;
  return {
    id: num(p.id),
    name: str(p.name),
    fullName: str(p.full_name),
    teams: rows(
      db,
      `SELECT t.id, t.name, COUNT(*) AS shots FROM shots s JOIN teams t ON t.id = s.team_id
       WHERE s.player_id = ? AND s.period <= 4 GROUP BY t.id ORDER BY shots DESC, t.name`,
      id,
    ).map((r) => ({ id: num(r.id), name: str(r.name), shots: num(r.shots) })),
    totals: {
      matches: num(totals.matches),
      shots: num(totals.shots),
      goals: num(totals.goals),
      onTarget: num(totals.onTarget),
      xg: round(num(totals.xg), 3),
    },
  };
}

export function exportCompare(
  db: DatabaseSync,
  a: number,
  b: number,
): Compare | undefined {
  const pa = exportPlayer(db, a);
  const pb = exportPlayer(db, b);
  return pa && pb ? { a: pa, b: pb } : undefined;
}

/** Players, teams and matches whose words start with every word typed. */
export function exportSearch(
  db: DatabaseSync,
  q: string,
  limit: number = LIMITS.searchPerKind,
): SearchResult {
  const words = wordsOf(q);
  const empty: SearchResult = { q, players: [], teams: [], matches: [] };
  if (words.length === 0) return empty;
  const refs = () =>
    words
      .map(() => 'SELECT ref FROM search_terms WHERE kind = ? AND term >= ? AND term < ?')
      .join(' INTERSECT ');
  const params = (kind: number): Param[] =>
    words.flatMap((w): Param[] => [kind, w, `${w}￿`]);
  const cap = Math.min(limit, LIMITS.searchPerKind);
  return {
    q,
    players: rows(
      db,
      `SELECT id, name FROM players WHERE id IN (${refs()}) ORDER BY name LIMIT ${cap}`,
      ...params(1),
    ).map((r) => ({ id: num(r.id), name: str(r.name) })),
    teams: rows(
      db,
      `SELECT id, name FROM teams WHERE id IN (${refs()}) ORDER BY name LIMIT ${cap}`,
      ...params(2),
    ).map((r) => ({ id: num(r.id), name: str(r.name) })),
    matches: rows(
      db,
      `SELECT m.id, m.date, th.name AS home, ta.name AS away FROM matches m ${TEAMS}
       WHERE m.id IN (${refs()}) ORDER BY m.date, m.id LIMIT ${cap}`,
      ...params(3),
    ).map((r) => ({
      id: num(r.id),
      date: str(r.date),
      home: str(r.home),
      away: str(r.away),
    })),
  };
}
