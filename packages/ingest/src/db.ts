/**
 * The normalised SQLite database. It is built next to the static JSON, from the same
 * parsed data plus what the static files drop (player and team ids, event ids,
 * play_pattern, first_time). SQLite is the source of truth; D1 is loaded from a dump
 * of it (docs/adr/0001).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ENUMS,
  OUTCOMES,
  SCHEMA_VERSION,
  normalise,
  shotIdOf,
  wordsOf,
  type Outcome,
} from '@shotmap/schema';
import type { MatchRecord } from './rich';

/** Search term kinds, in `search_terms.kind`. */
export const TERM_KIND = { player: 1, team: 2, match: 3 } as const;

/** outcome_group is the position in OUTCOMES (goal 0, saved 1, off 2, blocked 3, post 4), so goals are a SUM. */
export const outcomeGroupId = (group: Outcome): number => OUTCOMES.indexOf(group);

export const DDL = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;

CREATE TABLE competitions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL
);

CREATE TABLE seasons (
  competition_id INTEGER NOT NULL REFERENCES competitions(id),
  id INTEGER NOT NULL,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL,
  PRIMARY KEY (competition_id, id)
) WITHOUT ROWID;

CREATE TABLE stages (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL
);

CREATE TABLE teams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

-- One row per StatsBomb player id who took a shot. No team: 30 of them shot for a club and a country.
CREATE TABLE players (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  search_text TEXT NOT NULL
);

CREATE TABLE matches (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  kickoff TEXT,
  competition_id INTEGER NOT NULL,
  season_id INTEGER NOT NULL,
  stage_id INTEGER NOT NULL REFERENCES stages(id),
  home_team_id INTEGER NOT NULL REFERENCES teams(id),
  away_team_id INTEGER NOT NULL REFERENCES teams(id),
  home_score INTEGER NOT NULL,
  away_score INTEGER NOT NULL,
  home_pens INTEGER,
  away_pens INTEGER,
  home_own_goals INTEGER NOT NULL,
  away_own_goals INTEGER NOT NULL,
  FOREIGN KEY (competition_id, season_id) REFERENCES seasons(competition_id, id)
);
CREATE INDEX matches_date ON matches(date);

-- The players who shot in a match, as that match's lineup names them, in order of first shot.
CREATE TABLE match_players (
  match_id INTEGER NOT NULL REFERENCES matches(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  side INTEGER NOT NULL CHECK (side IN (0, 1)),
  name TEXT NOT NULL,
  shirt INTEGER,
  first_seq INTEGER NOT NULL,
  PRIMARY KEY (match_id, player_id)
) WITHOUT ROWID;

CREATE TABLE shots (
  id INTEGER PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id),
  seq INTEGER NOT NULL,
  event_uuid TEXT NOT NULL,
  period INTEGER NOT NULL CHECK (period BETWEEN 1 AND 5),
  minute INTEGER NOT NULL,
  second INTEGER NOT NULL,
  side INTEGER NOT NULL CHECK (side IN (0, 1)),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  x REAL NOT NULL,
  y REAL NOT NULL,
  ex REAL NOT NULL,
  ey REAL NOT NULL,
  ez REAL,
  xg REAL NOT NULL,
  outcome INTEGER NOT NULL,
  outcome_group INTEGER NOT NULL CHECK (outcome_group BETWEEN 0 AND 4),
  body INTEGER NOT NULL,
  type INTEGER NOT NULL,
  tech INTEGER NOT NULL,
  play_pattern INTEGER NOT NULL,
  first_time INTEGER NOT NULL CHECK (first_time IN (0, 1))
);
CREATE INDEX shots_player_match ON shots(player_id, match_id);
CREATE UNIQUE INDEX shots_match_seq ON shots(match_id, seq);

-- Typeahead: every word of a player, team or match name, normalised. A prefix is a range scan.
CREATE TABLE search_terms (
  term TEXT NOT NULL,
  kind INTEGER NOT NULL CHECK (kind IN (1, 2, 3)),
  ref INTEGER NOT NULL,
  PRIMARY KEY (term, kind, ref)
) WITHOUT ROWID;
`;

export interface DbInput {
  /** The StatsBomb commit the data came from. */
  ref: string;
  hero: number;
  competitions: { id: number; name: string; seasons: { id: number; name: string }[] }[];
  /** In sort order; a stage's id is its position. */
  stages: string[];
  matches: MatchRecord[];
}

const mostCommon = (values: string[]): string => {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))[0]?.[0] ?? '';
};

const idsOf = (kind: keyof typeof ENUMS): Set<number> =>
  new Set(ENUMS[kind].map((e) => e.id));

export interface DbSummary {
  release: string;
  counts: Record<string, number>;
}

export function writeDatabase(path: string, input: DbInput): DbSummary {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  rmSync(tmp, { force: true });
  const db = new DatabaseSync(tmp);
  db.exec(
    'PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA foreign_keys = ON;',
  );
  db.exec(DDL);

  // The release is a hash of every row, in the order written, so it changes exactly when the data does.
  const hash = createHash('sha256').update(`${SCHEMA_VERSION}\n${input.ref}\n`);
  const counts: Record<string, number> = {};
  const insert = (table: string, columns: string[]) => {
    const statement = db.prepare(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    );
    return (...row: (string | number | null)[]) => {
      statement.run(...row);
      hash.update(`${table}${JSON.stringify(row)}\n`);
      counts[table] = (counts[table] ?? 0) + 1;
    };
  };
  const term = insert('search_terms', ['term', 'kind', 'ref']);
  const seen = new Set<string>();
  const addTerms = (kind: number, ref: number, text: string, extra: string[] = []) => {
    for (const word of [...wordsOf(text), ...extra]) {
      const key = `${word}|${kind}|${ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      term(word, kind, ref);
    }
  };

  db.exec('BEGIN');

  const addCompetition = insert('competitions', ['id', 'name', 'sort']);
  const addSeason = insert('seasons', ['competition_id', 'id', 'name', 'sort']);
  input.competitions.forEach((c, i) => {
    addCompetition(c.id, c.name, i);
    c.seasons.forEach((s, j) => addSeason(c.id, s.id, s.name, j));
  });
  const addStage = insert('stages', ['id', 'name', 'sort']);
  input.stages.forEach((name, i) => addStage(i, name, i));

  const matches = [...input.matches].sort((a, b) => a.file.meta.id - b.file.meta.id);

  // Teams. One id, one name, or the data is not what we think it is.
  const teamNames = new Map<number, string>();
  for (const m of matches)
    for (const t of m.file.meta.teams) {
      const known = teamNames.get(t.id);
      if (known !== undefined && known !== t.name)
        throw new Error(`team ${t.id} is both "${known}" and "${t.name}"`);
      teamNames.set(t.id, t.name);
    }
  const addTeam = insert('teams', ['id', 'name']);
  for (const [teamId, name] of [...teamNames].sort(([a], [b]) => a - b)) {
    addTeam(teamId, name);
    addTerms(TERM_KIND.team, teamId, name);
  }

  // Players: StatsBomb id is the key. The display name is the one lineups use most often.
  const spellings = new Map<number, { names: string[]; full: string[] }>();
  for (const m of matches)
    for (const r of m.rich.roster) {
      const s = spellings.get(r.playerId) ?? { names: [], full: [] };
      s.names.push(r.name);
      s.full.push(r.fullName);
      spellings.set(r.playerId, s);
    }
  const addPlayer = insert('players', ['id', 'name', 'full_name', 'search_text']);
  for (const [playerId, s] of [...spellings].sort(([a], [b]) => a - b)) {
    const name = mostCommon(s.names);
    const fullName = mostCommon(s.full);
    // Every spelling is searchable, so "Philip Foden" finds Phil Foden.
    const everything = [...new Set([name, fullName, ...s.names, ...s.full])];
    addPlayer(playerId, name, fullName, normalise(everything.join(' ')));
    addTerms(TERM_KIND.player, playerId, everything.join(' '));
  }

  const stageId = new Map(input.stages.map((name, i) => [name, i]));
  const competitionOf = new Map(input.competitions.map((c) => [c.id, c]));
  const addMatch = insert('matches', [
    'id',
    'date',
    'kickoff',
    'competition_id',
    'season_id',
    'stage_id',
    'home_team_id',
    'away_team_id',
    'home_score',
    'away_score',
    'home_pens',
    'away_pens',
    'home_own_goals',
    'away_own_goals',
  ]);
  const addRoster = insert('match_players', [
    'match_id',
    'player_id',
    'team_id',
    'side',
    'name',
    'shirt',
    'first_seq',
  ]);
  const addShot = insert('shots', [
    'id',
    'match_id',
    'seq',
    'event_uuid',
    'period',
    'minute',
    'second',
    'side',
    'team_id',
    'player_id',
    'x',
    'y',
    'ex',
    'ey',
    'ez',
    'xg',
    'outcome',
    'outcome_group',
    'body',
    'type',
    'tech',
    'play_pattern',
    'first_time',
  ]);
  const outcomeById = new Map<number, { group: Outcome }>(
    ENUMS.outcome.map((o) => [o.id, o]),
  );
  const known = {
    outcome: idsOf('outcome'),
    body: idsOf('bodyPart'),
    type: idsOf('shotType'),
    tech: idsOf('technique'),
    pattern: idsOf('playPattern'),
  };

  for (const m of matches) {
    const { meta } = m.file;
    const [home, away] = meta.teams;
    const stage = stageId.get(m.stage);
    if (stage === undefined)
      throw new Error(`match ${meta.id}: unknown stage ${m.stage}`);
    addMatch(
      meta.id,
      meta.date,
      meta.kickoff,
      meta.competition.id,
      meta.season.id,
      stage,
      home.id,
      away.id,
      home.score,
      away.score,
      home.pens,
      away.pens,
      m.ownGoals[0],
      m.ownGoals[1],
    );
    const competition = competitionOf.get(meta.competition.id)?.name ?? '';
    addTerms(
      TERM_KIND.match,
      meta.id,
      `${home.name} ${away.name} ${m.stage} ${competition} ${meta.season.name} ${meta.date}`,
      [meta.date],
    );

    const columns = [m.file.shots, ...(m.file.shootout ? [m.file.shootout] : [])];
    const firstSeq = new Map<number, number>();
    let seq = 0;
    for (const cols of columns) {
      for (let i = 0; i < cols.x.length; i++, seq++) {
        const rich = m.rich.shots[seq];
        if (!rich) throw new Error(`match ${meta.id}: no event data for shot ${seq}`);
        const side = cols.team[i] as 0 | 1;
        if (rich.teamId !== meta.teams[side].id)
          throw new Error(`match ${meta.id}: shot ${seq} team does not match its side`);
        const out = cols.out[i] as number;
        const body = cols.body[i] as number;
        const type = cols.type[i] as number;
        const tech = cols.tech[i] as number;
        if (!known.outcome.has(out))
          throw new Error(`match ${meta.id}: outcome id ${out} is not in ENUMS`);
        if (!known.body.has(body))
          throw new Error(`match ${meta.id}: body part id ${body} is not in ENUMS`);
        if (!known.type.has(type))
          throw new Error(`match ${meta.id}: shot type id ${type} is not in ENUMS`);
        if (!known.tech.has(tech))
          throw new Error(`match ${meta.id}: technique id ${tech} is not in ENUMS`);
        if (!known.pattern.has(rich.playPattern))
          throw new Error(
            `match ${meta.id}: play pattern id ${rich.playPattern} is not in ENUMS`,
          );
        if (!firstSeq.has(rich.playerId)) firstSeq.set(rich.playerId, seq);
        addShot(
          shotIdOf(meta.id, seq),
          meta.id,
          seq,
          rich.uuid,
          cols.per[i] as number,
          cols.min[i] as number,
          cols.sec[i] as number,
          side,
          rich.teamId,
          rich.playerId,
          cols.x[i] as number,
          cols.y[i] as number,
          cols.ex[i] as number,
          cols.ey[i] as number,
          cols.ez[i] ?? null,
          cols.xg[i] as number,
          out,
          outcomeGroupId((outcomeById.get(out) as { group: Outcome }).group),
          body,
          type,
          tech,
          rich.playPattern,
          rich.firstTime ? 1 : 0,
        );
      }
    }
    for (const r of m.rich.roster)
      addRoster(
        meta.id,
        r.playerId,
        r.teamId,
        r.side,
        r.name,
        r.shirt,
        firstSeq.get(r.playerId) ?? -1,
      );
  }

  const release = `r${hash.digest('hex').slice(0, 12)}`;
  // The meta rows are not part of the hash: the release is one of them.
  const addMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
  for (const [key, value] of [
    ['release', release],
    ['source_ref', input.ref],
    ['schema_version', String(SCHEMA_VERSION)],
    ['hero_match', String(input.hero)],
  ] as const)
    addMeta.run(key, value);

  db.exec('COMMIT');
  db.exec('ANALYZE');
  db.close();
  rmSync(path, { force: true });
  renameSync(tmp, path);
  return { release, counts };
}
