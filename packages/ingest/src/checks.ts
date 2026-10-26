/**
 * The checks the static data passes, run against the database. Each is one SQL query
 * (or two) that returns the rows that break a rule. `runChecks` is called by the
 * ingest, which fails on any problem, and by db.test.ts, which asserts the same
 * things plus the facts about the 2022 final.
 */
import { DatabaseSync } from 'node:sqlite';
import { ENUMS, PITCH, SHOT_ID_FACTOR, normalise } from '@shotmap/schema';

export interface Check {
  name: string;
  problems: string[];
  /** A figure worth printing next to a passing check. */
  note?: string;
}

/** Event coordinates run a hair past the pitch (x reaches 120.1 in the real data). */
const SLACK = 0.5;
const ids = (kind: keyof typeof ENUMS) => ENUMS[kind].map((e) => e.id).join(',');

type Row = Record<string, unknown>;

export function checkDatabase(db: DatabaseSync): Check[] {
  const rows = (sql: string): Row[] => db.prepare(sql).all();
  const scalar = (sql: string): number => Number(Object.values(rows(sql)[0] ?? {})[0]);
  const listed = (sql: string, say: (r: Row) => string): string[] =>
    rows(`${sql} LIMIT 20`).map(say);
  const checks: Check[] = [];
  const check = (name: string, problems: string[], note?: string) =>
    checks.push(note === undefined ? { name, problems } : { name, problems, note });

  // The index
  const hero = scalar("SELECT value FROM meta WHERE key = 'hero_match'");
  check(
    'index: the hero match is listed',
    scalar(`SELECT COUNT(*) FROM matches WHERE id = ${hero}`) === 1
      ? []
      : [`match ${hero} is not in matches`],
  );
  check(
    'index: foreign keys hold (stages, teams, seasons, players)',
    listed(
      'SELECT * FROM pragma_foreign_key_check',
      (r) => `${String(r.table)} row ${String(r.rowid)} -> ${String(r.parent)}`,
    ),
  );

  // Enums
  const enumProblems = [
    ...listed(
      `SELECT id, seq, match_id FROM shots WHERE outcome NOT IN (${ids('outcome')})`,
      (r) => `shot ${String(r.id)}: unknown outcome`,
    ),
    ...listed(
      `SELECT id FROM shots WHERE body NOT IN (${ids('bodyPart')})`,
      (r) => `shot ${String(r.id)}: unknown body part`,
    ),
    ...listed(
      `SELECT id FROM shots WHERE type NOT IN (${ids('shotType')})`,
      (r) => `shot ${String(r.id)}: unknown shot type`,
    ),
    ...listed(
      `SELECT id FROM shots WHERE tech NOT IN (${ids('technique')})`,
      (r) => `shot ${String(r.id)}: unknown technique`,
    ),
    ...listed(
      `SELECT id FROM shots WHERE play_pattern NOT IN (${ids('playPattern')})`,
      (r) => `shot ${String(r.id)}: unknown play pattern`,
    ),
  ];
  check(
    'enums: every shot names a known outcome, body part, type, technique and play pattern',
    enumProblems,
  );
  const named = new Set<string | undefined>(
    rows('SELECT DISTINCT outcome FROM shots').map(
      (r) => ENUMS.outcome.find((e) => e.id === r.outcome)?.name,
    ),
  );
  check(
    'enums: Goal, Saved, Off T, Blocked and Post all occur',
    ['Goal', 'Saved', 'Off T', 'Blocked', 'Post']
      .filter((n) => !named.has(n))
      .map((n) => `no ${n} shots`),
  );
  const groupCase = ENUMS.outcome
    .map(
      (o) =>
        `WHEN ${o.id} THEN ${['goal', 'saved', 'off', 'blocked', 'post'].indexOf(o.group)}`,
    )
    .join(' ');
  check(
    'enums: outcome_group agrees with the outcome',
    listed(
      `SELECT id FROM shots WHERE outcome_group != CASE outcome ${groupCase} END`,
      (r) => `shot ${String(r.id)}`,
    ),
  );

  // Players and teams
  check(
    "players: a shot's player is on that match's list, on the same side and team",
    listed(
      `SELECT s.id, s.side, mp.side AS mside, s.team_id, mp.team_id AS mteam FROM shots s LEFT JOIN match_players mp ON mp.match_id = s.match_id AND mp.player_id = s.player_id WHERE mp.player_id IS NULL OR mp.side != s.side OR mp.team_id != s.team_id`,
      (r) => `shot ${String(r.id)}: not on its match list, or the other side`,
    ),
  );
  check(
    "teams: a shot's team is its side's team in the match",
    listed(
      `SELECT s.id FROM shots s JOIN matches m ON m.id = s.match_id WHERE s.team_id != CASE s.side WHEN 0 THEN m.home_team_id ELSE m.away_team_id END`,
      (r) => `shot ${String(r.id)}`,
    ),
  );
  check(
    'players: first_seq is the position of the first shot, and every name is set',
    listed(
      `SELECT mp.match_id, mp.player_id FROM match_players mp WHERE mp.first_seq != (SELECT MIN(seq) FROM shots s WHERE s.match_id = mp.match_id AND s.player_id = mp.player_id) OR mp.name = ''`,
      (r) => `match ${String(r.match_id)} player ${String(r.player_id)}`,
    ),
  );

  // The pitch
  const { length: L, width: W } = PITCH;
  check(
    'pitch: shots start and end on the pitch (0.5 yard slack)',
    listed(
      `SELECT id FROM shots WHERE NOT (x BETWEEN 0 AND ${L + SLACK} AND y BETWEEN 0 AND ${W + SLACK} AND ex BETWEEN 0 AND ${L + SLACK} AND ey BETWEEN 0 AND ${W + SLACK})`,
      (r) => `shot ${String(r.id)}`,
    ),
  );
  check(
    'pitch: heights are between 0 and 10 yards',
    listed(
      'SELECT id FROM shots WHERE ez IS NOT NULL AND NOT (ez >= 0 AND ez < 10)',
      (r) => `shot ${String(r.id)}`,
    ),
  );
  const dp = (col: string, n: number) =>
    `ABS(${col} * ${10 ** n} - ROUND(${col} * ${10 ** n})) > 0.000001`;
  check(
    'rounding: coordinates have 1 decimal, xG has 3 and lies in 0 to 1',
    listed(
      `SELECT id FROM shots WHERE ${['x', 'y', 'ex', 'ey'].map((c) => dp(c, 1)).join(' OR ')} OR (ez IS NOT NULL AND ${dp('ez', 1)}) OR ${dp('xg', 3)} OR NOT (xg BETWEEN 0 AND 1)`,
      (r) => `shot ${String(r.id)}`,
    ),
  );

  // Time and order
  check('time: open play is in periods 1 to 4, kicks in period 5 and sit last', [
    ...listed(
      `SELECT s.id FROM shots s WHERE s.period NOT BETWEEN 1 AND 5 OR s.second NOT BETWEEN 0 AND 59 OR s.minute < 0`,
      (r) => `shot ${String(r.id)}: bad time`,
    ),
    ...listed(
      `SELECT match_id FROM shots GROUP BY match_id HAVING MIN(seq) != 0 OR MAX(seq) != COUNT(*) - 1`,
      (r) => `match ${String(r.match_id)}: seq is not 0 to n-1`,
    ),
  ]);
  const when = 'period * 1000000 + minute * 100 + second';
  check(
    'time: shots are chronological within a match (the shootout is last)',
    listed(
      `SELECT match_id, seq FROM (SELECT match_id, seq, ${when} AS t, LAG(${when}) OVER (PARTITION BY match_id ORDER BY seq) AS prev FROM shots) WHERE prev IS NOT NULL AND t < prev`,
      (r) => `match ${String(r.match_id)} seq ${String(r.seq)}`,
    ),
  );
  check(
    'ids: a shot id is match * 1000 + seq, and seq stays under 1000',
    listed(
      `SELECT id FROM shots WHERE id != match_id * ${SHOT_ID_FACTOR} + seq OR seq >= ${SHOT_ID_FACTOR}`,
      (r) => `shot ${String(r.id)}`,
    ),
  );

  // Shootouts and scores
  check(
    'shootout: pens exist exactly when there are kicks, and equal the goals among them',
    listed(
      `SELECT m.id FROM matches m LEFT JOIN (SELECT match_id, COUNT(*) AS kicks, SUM(side = 0 AND outcome_group = 0) AS g0, SUM(side = 1 AND outcome_group = 0) AS g1 FROM shots WHERE period = 5 GROUP BY match_id) k ON k.match_id = m.id WHERE (m.home_pens IS NULL) != (m.away_pens IS NULL) OR (m.home_pens IS NULL) != (k.kicks IS NULL) OR (k.kicks IS NOT NULL AND (m.home_pens != k.g0 OR m.away_pens != k.g1))`,
      (r) => `match ${String(r.id)}`,
    ),
  );
  const goals = `SELECT m.id, m.home_score, m.away_score, m.home_own_goals AS ho, m.away_own_goals AS ao, COALESCE(g.g0, 0) AS g0, COALESCE(g.g1, 0) AS g1 FROM matches m LEFT JOIN (SELECT match_id, SUM(side = 0 AND outcome_group = 0) AS g0, SUM(side = 1 AND outcome_group = 0) AS g1 FROM shots WHERE period <= 4 GROUP BY match_id) g ON g.match_id = m.id`;
  check(
    'score: shot goals never exceed the score',
    listed(
      `SELECT * FROM (${goals}) WHERE g0 > home_score OR g1 > away_score`,
      (r) => `match ${String(r.id)}`,
    ),
  );
  const unexplained = listed(
    `SELECT * FROM (${goals}) WHERE g0 + ho != home_score OR g1 + ao != away_score`,
    (r) =>
      `match ${String(r.id)}: ${String(r.g0)}+${String(r.ho)} v ${String(r.g1)}+${String(r.ao)}, score ${String(r.home_score)}-${String(r.away_score)}`,
  );
  const total = scalar('SELECT COUNT(*) FROM matches');
  check(
    'score: shot goals + own goals equal the final score',
    unexplained,
    `${total - scalar(`SELECT COUNT(*) FROM (${goals}) WHERE g0 + ho != home_score OR g1 + ao != away_score`)}/${total} matches`,
  );

  // The coordinate system, from the goals we ship
  const goalRows = scalar(
    'SELECT COUNT(*) FROM shots WHERE outcome_group = 0 AND period <= 4',
  );
  const [post1, post2] = PITCH.goalY;
  check(
    'coordinates: every team attacks toward x = 120; goals are between the posts, under the bar',
    [
      ...(goalRows > 300 ? [] : [`only ${goalRows} goals to check`]),
      ...listed(
        `SELECT id FROM shots WHERE outcome_group = 0 AND period <= 4 AND (x <= ${L / 2} OR ex < 119.5 OR ey < ${post1 - 0.5} OR ey > ${post2 + 0.5} OR (ez IS NOT NULL AND ez > 2.67))`,
        (r) => `goal ${String(r.id)}`,
      ),
    ],
    `${goalRows} goals`,
  );

  // Search
  const terms = rows('SELECT DISTINCT term FROM search_terms').map((r) => String(r.term));
  check('search: terms are normalised, and every player, team and match has some', [
    ...terms
      .filter((t) => t !== normalise(t) || t === '')
      .slice(0, 20)
      .map((t) => `term "${t}" is not normalised`),
    ...listed(
      `SELECT p.id FROM players p WHERE NOT EXISTS (SELECT 1 FROM search_terms t WHERE t.kind = 1 AND t.ref = p.id)`,
      (r) => `player ${String(r.id)} has no terms`,
    ),
    ...listed(
      `SELECT t.id FROM teams t WHERE NOT EXISTS (SELECT 1 FROM search_terms s WHERE s.kind = 2 AND s.ref = t.id)`,
      (r) => `team ${String(r.id)} has no terms`,
    ),
    ...listed(
      `SELECT m.id FROM matches m WHERE NOT EXISTS (SELECT 1 FROM search_terms s WHERE s.kind = 3 AND s.ref = m.id)`,
      (r) => `match ${String(r.id)} has no terms`,
    ),
  ]);

  return checks;
}

export function runChecks(path: string): Check[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return checkDatabase(db);
  } finally {
    db.close();
  }
}
