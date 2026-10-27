/**
 * One match of raw StatsBomb data in, one `MatchRecord` out: the shots (open play and shootout),
 * the players who took them, the own goals, and what the static files drop. Shared by the static
 * build (`pnpm data`) and the catalogue ingest (`pnpm catalogue`), so a match is read the same way
 * wherever it comes from.
 */
import {
  OUTCOME_TABLE,
  PITCH,
  SCHEMA_VERSION,
  type EnumEntry,
  type Enums,
  type MatchFile,
  type OutcomeEntry,
  type PlayerRow,
  type ShotColumns,
} from '@shotmap/schema';
import { stageOrder } from './data.config';
import type { MatchRecord, RichShot, RosterRow } from './rich';

// Only the parts of the raw files we read.
export interface RawCompetition {
  competition_id: number;
  season_id: number;
  competition_name: string;
  season_name: string;
}
export interface RawMatch {
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
export interface RawNamed {
  id: number;
  name: string;
}
export interface RawShot {
  statsbomb_xg?: number;
  first_time?: boolean;
  end_location?: number[];
  body_part: RawNamed;
  type: RawNamed;
  technique: RawNamed;
  outcome: RawNamed;
}
export interface RawEvent {
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
export interface RawLineupTeam {
  team_id: number;
  lineup: {
    player_id: number;
    player_name: string;
    player_nickname: string | null;
    jersey_number: number | null;
  }[];
}

// Normalising

export const r1 = (n: number) => Math.round(n * 10) / 10;
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

export type EnumKey = keyof Enums;
export const observed: Record<EnumKey, Map<number, string>> = {
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
export const stats = {
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

export type Built = MatchRecord;

/**
 * A stage's name as the data spells it, minus stray whitespace: the source has "1st Round" and
 * "1st Round " (a trailing space) as two stages, which are one. Nothing else about a name is changed.
 */
export const stageName = (raw: Pick<RawMatch, 'competition_stage'>): string =>
  raw.competition_stage.name.trim().replace(/\s+/g, ' ');

export function buildMatch(
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
      stage: stageName(raw),
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
    stage: stageName(raw),
    ownGoals,
    rich: { shots: [...richOpen, ...richKick], roster },
  };
}

export const goalsOf = (cols: ShotColumns, team: number) =>
  cols.out.filter((o, i) => observed.outcome.get(o) === 'Goal' && cols.team[i] === team)
    .length;

function enumEntries(kind: 'bodyPart' | 'shotType' | 'technique'): EnumEntry[] {
  return [...observed[kind]]
    .sort(([a], [b]) => a - b)
    .map(([id, name]) => ({ id, name, label: name }));
}

export function legend(): Enums {
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

export function sortStages(stages: Set<string>): string[] {
  const rank = (s: string) => {
    const i = stageOrder.indexOf(s);
    return i < 0 ? stageOrder.length : i;
  };
  return [...stages].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
