import type { Outcome } from '../lib/geometry';

/** Bump when the shape of any generated file changes. */
export const SCHEMA_VERSION = 1;

/** Where the generated files live, relative to the site base. */
export const DATA_DIR = 'data';

/**
 * Pitch facts confirmed against the real data (see CLAUDE.md and DATA.md).
 * Event coordinates are normalised so every team attacks toward x = 120.
 */
export const PITCH = {
  length: 120,
  width: 80,
  /** y of the two goalposts. The goal mouth spans between them. */
  goalY: [36, 44],
} as const;

/** One value of an enum. `id` is the StatsBomb id, which is what the shot columns store. */
export interface EnumEntry {
  id: number;
  name: string;
  label: string;
}

export interface OutcomeEntry extends EnumEntry {
  /** Which of the five UI marks this outcome is drawn as. Our mapping, not StatsBomb's. */
  group: Outcome;
}

export interface Enums {
  outcome: OutcomeEntry[];
  bodyPart: EnumEntry[];
  shotType: EnumEntry[];
  technique: EnumEntry[];
}

/**
 * Shots as struct-of-arrays: column `k` of shot `i` is `col[k][i]`. Columns share one length.
 * Rows are in match order. Coordinates are StatsBomb yards, rounded to 1 decimal.
 */
export interface ShotColumns {
  /** Match minute, counting through extra time (a goal at 107 is in the second period of ET). */
  min: number[];
  sec: number[];
  /** 1 and 2 are normal time, 3 and 4 extra time, 5 the shootout. */
  per: number[];
  /** 0 is the home team, 1 the away team. */
  team: number[];
  /** Index into MatchFile.players. */
  player: number[];
  /** Where the shot was taken. */
  x: number[];
  y: number[];
  /** Where it ended up. Always present; for blocked shots this is the block. */
  ex: number[];
  ey: number[];
  /**
   * Height in yards where the ball crossed the goal line, when StatsBomb recorded one
   * (on target, over the bar, hitting the frame). Null for blocked and most wide shots.
   * The crossbar is 2.67 yards up.
   */
  ez: (number | null)[];
  /** StatsBomb expected goals, 3 decimals. */
  xg: number[];
  /** Enum ids, see Enums in index.json. */
  out: number[];
  body: number[];
  type: number[];
  tech: number[];
}

export type ShotColumn = keyof ShotColumns;

export interface TeamMeta {
  id: number;
  name: string;
  /** Final score before any shootout. */
  score: number;
  /** Shootout goals, or null if there was no shootout. */
  pens: number | null;
}

export interface MatchMeta {
  id: number;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM local to the venue, or null. */
  kickoff: string | null;
  competition: { id: number; name: string };
  season: { id: number; name: string };
  stage: string;
  /** Home first, then away. Team index 0 and 1 in the shot columns. */
  teams: [TeamMeta, TeamMeta];
}

/** [display name, team index, shirt number or null]. Only players who took a shot. */
export type PlayerRow = [name: string, team: 0 | 1, shirt: number | null];

export interface MatchFile {
  v: typeof SCHEMA_VERSION;
  meta: MatchMeta;
  players: PlayerRow[];
  /** Normal time and extra time. */
  shots: ShotColumns;
  /** Penalty shootout kicks, kept apart so the default view never includes them. Null if none. */
  shootout: ShotColumns | null;
}

/**
 * [match id, date, home, away, home score, away score, stage index, home pens, away pens].
 * Stage index points into IndexFile.stages. Pens are null unless there was a shootout.
 */
export type MatchRow = [
  id: number,
  date: string,
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
  stage: number,
  homePens: number | null,
  awayPens: number | null,
];

export interface IndexSeason {
  id: number;
  name: string;
  /** Chronological. */
  matches: MatchRow[];
}

export interface IndexCompetition {
  id: number;
  name: string;
  seasons: IndexSeason[];
}

export interface IndexFile {
  v: typeof SCHEMA_VERSION;
  /** Match id of the hero match (the 2022 World Cup final). */
  hero: number;
  pitch: { length: number; width: number; goalY: [number, number] };
  enums: Enums;
  stages: string[];
  competitions: IndexCompetition[];
}
