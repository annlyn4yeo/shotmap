import type { Player } from '@shotmap/schema';
import type { SeasonRow } from './player';

/** The numbers a player has over a span: the career's totals or one season's row. */
export type Figures = Player['totals'];

/** The span two players are compared over: every season, or one competition season. */
export interface Scope {
  competition: number | null;
  season: number | null;
}

/** The figures over the scope, or nothing if the player has no row for that season. */
export function figuresFor(player: Player, scope: Scope): Figures | undefined {
  if (scope.competition === null || scope.season === null) return player.totals;
  return player.seasons.find(
    (r) => r.competition.id === scope.competition && r.season.id === scope.season,
  );
}

/** The seasons both players have a row for, in the first player's order (oldest first). */
export const sharedSeasons = (a: Player, b: Player): SeasonRow[] =>
  a.seasons.filter((ra) =>
    b.seasons.some(
      (rb) => rb.competition.id === ra.competition.id && rb.season.id === ra.season.id,
    ),
  );

export interface StatRow {
  key: string;
  label: string;
  /** Digits after the point, as printed: a lead is decided on what is printed. */
  decimals: number;
  suffix?: string;
  /** Always show a sign: +0.24, −0.40. */
  signed?: boolean;
  /** A bigger figure is the better one. False for a figure that is neither better nor worse. */
  ranked: boolean;
  /** Per match or per shot, so it does not simply grow with the matches in the data. */
  rate?: boolean;
  /** The figure, or null when it cannot be worked out (a rate over no shots). */
  of: (f: Figures) => number | null;
}

const per = (n: number, over: number): number | null => (over > 0 ? n / over : null);

/** The table, top to bottom: the totals, then the rates, which do not favour the longer career. */
export const STAT_ROWS: readonly StatRow[] = [
  { key: 'matches', label: 'Matches', decimals: 0, ranked: false, of: (f) => f.matches },
  { key: 'shots', label: 'Shots', decimals: 0, ranked: true, of: (f) => f.shots },
  {
    key: 'onTarget',
    label: 'On target',
    decimals: 0,
    ranked: true,
    of: (f) => f.onTarget,
  },
  { key: 'goals', label: 'Goals', decimals: 0, ranked: true, of: (f) => f.goals },
  { key: 'xg', label: 'xG', decimals: 2, ranked: true, of: (f) => f.xg },
  {
    key: 'shotsPerMatch',
    label: 'Shots per match',
    decimals: 1,
    ranked: true,
    rate: true,
    of: (f) => per(f.shots, f.matches),
  },
  {
    key: 'goalsPerMatch',
    label: 'Goals per match',
    decimals: 2,
    ranked: true,
    rate: true,
    of: (f) => per(f.goals, f.matches),
  },
  {
    key: 'goalsPerShot',
    label: 'Goals per shot',
    decimals: 1,
    suffix: '%',
    ranked: true,
    rate: true,
    of: (f) => per(100 * f.goals, f.shots),
  },
  {
    key: 'xgPerShot',
    label: 'xG per shot',
    decimals: 2,
    ranked: true,
    rate: true,
    of: (f) => per(f.xg, f.shots),
  },
  {
    key: 'finishing',
    label: 'Goals v xG',
    decimals: 2,
    signed: true,
    ranked: true,
    of: (f) => f.goals - f.xg,
  },
];

/** The figure as the table prints it. A value that rounds to zero has no minus sign. */
export function printed(row: StatRow, value: number): string {
  const text = Math.abs(value).toFixed(row.decimals);
  const negative = value < 0 && Number(text) !== 0;
  const sign = negative ? '−' : row.signed ? '+' : '';
  return `${sign}${text}${row.suffix ?? ''}`;
}

export type Lead = 'a' | 'b' | null;

/**
 * Which side has the better figure, judged on the printed figures: two numbers that read alike
 * are a tie, whatever sits in the digits that are not shown. Nobody leads a row that is not
 * ranked, or one side of which cannot be worked out.
 */
export function leader(row: StatRow, a: number | null, b: number | null): Lead {
  if (!row.ranked || a === null || b === null) return null;
  const left = Number(a.toFixed(row.decimals));
  const right = Number(b.toFixed(row.decimals));
  return left > right ? 'a' : right > left ? 'b' : null;
}

export interface StatLine {
  key: string;
  label: string;
  /** What is printed for each side; null for a figure that cannot be worked out. */
  a: string | null;
  b: string | null;
  lead: Lead;
}

/** Under this many matches a rate says little: two Clásicos are not a season. */
const FEWEST_TO_RANK = 5;

/**
 * What the two sides' match counts allow to be ranked. The open data holds whole seasons of some
 * teams and a couple of matches of others, so one player can have 36 matches here and the other 2.
 * Past twice as many, totals only say whose matches are in the data; with very few, rates say
 * little too.
 */
export function rankable(a: Figures, b: Figures): 'all' | 'rates' | 'none' {
  const fewer = Math.min(a.matches, b.matches);
  if (fewer * 2 >= Math.max(a.matches, b.matches)) return 'all';
  return fewer < FEWEST_TO_RANK ? 'none' : 'rates';
}

/** Every row of the table for two players' figures. */
export function statLines(a: Figures, b: Figures): StatLine[] {
  const ranks = rankable(a, b);
  return STAT_ROWS.map((row) => {
    const left = row.of(a);
    const right = row.of(b);
    const ranked = ranks === 'all' || (ranks === 'rates' && row.rate === true);
    return {
      key: row.key,
      label: row.label,
      a: left === null ? null : printed(row, left),
      b: right === null ? null : printed(row, right),
      lead: ranked ? leader(row, left, right) : null,
    };
  });
}
