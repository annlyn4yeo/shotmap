import type { Player } from '@shotmap/schema';
import { describe, expect, it } from 'vitest';
import {
  STAT_ROWS,
  figuresFor,
  leader,
  printed,
  sharedSeasons,
  statLines,
  type StatRow,
} from './figures';

const season = (c: number, s: number, shots: number, goals: number, xg: number) => ({
  competition: { id: c, name: `Competition ${c}` },
  season: { id: s, name: `Season ${s}` },
  matches: 10,
  shots,
  goals,
  onTarget: Math.floor(shots / 2),
  xg,
});

const player = (id: number, seasons: ReturnType<typeof season>[]): Player => ({
  id,
  name: `Player ${id}`,
  fullName: `Player ${id}`,
  teams: [{ id: 1, name: 'Team', shots: 1 }],
  totals: {
    matches: seasons.reduce((n, r) => n + r.matches, 0),
    shots: seasons.reduce((n, r) => n + r.shots, 0),
    goals: seasons.reduce((n, r) => n + r.goals, 0),
    onTarget: seasons.reduce((n, r) => n + r.onTarget, 0),
    xg: seasons.reduce((n, r) => n + r.xg, 0),
  },
  seasons,
});

const A = player(1, [season(11, 27, 100, 20, 15.5), season(11, 4, 50, 5, 6)]);
const B = player(2, [season(11, 27, 80, 18, 12), season(43, 3, 60, 9, 7)]);

const row = (key: string): StatRow => {
  const found = STAT_ROWS.find((r) => r.key === key);
  if (!found) throw new Error(key);
  return found;
};

describe('the scope two players are compared over', () => {
  it('is the career’s totals, or the season’s own row', () => {
    expect(figuresFor(A, { competition: null, season: null })).toBe(A.totals);
    expect(figuresFor(A, { competition: 11, season: 27 })).toMatchObject({
      shots: 100,
      goals: 20,
    });
    expect(figuresFor(A, { competition: 43, season: 3 })).toBeUndefined();
  });

  it('shares only the seasons both have, in the first player’s order', () => {
    expect(sharedSeasons(A, B).map((r) => `${r.competition.id}:${r.season.id}`)).toEqual([
      '11:27',
    ]);
    expect(sharedSeasons(A, player(3, [season(43, 3, 1, 0, 0.1)]))).toEqual([]);
  });
});

describe('how a figure is printed', () => {
  it('uses the digits of its row, a percent sign and a real minus', () => {
    expect(printed(row('shots'), 2663)).toBe('2663');
    expect(printed(row('xg'), 12.3456)).toBe('12.35');
    expect(printed(row('shotsPerMatch'), 4.54)).toBe('4.5');
    expect(printed(row('goalsPerShot'), 13.04)).toBe('13.0%');
    expect(printed(row('finishing'), 2.5)).toBe('+2.50');
    expect(printed(row('finishing'), -1.2)).toBe('−1.20');
  });

  it('has no minus on a figure that rounds to zero', () => {
    expect(printed(row('finishing'), -0.004)).toBe('+0.00');
    expect(printed(row('finishing'), 0)).toBe('+0.00');
  });
});

describe('who leads a row', () => {
  it('is the side with the bigger figure on a ranked row', () => {
    expect(leader(row('goals'), 20, 18)).toBe('a');
    expect(leader(row('goals'), 18, 20)).toBe('b');
  });

  it('is nobody when the figures are equal', () => {
    expect(leader(row('goals'), 7, 7)).toBeNull();
  });

  it('judges what is printed: figures that read alike are a tie', () => {
    // 0.114 and 0.1149 are both 0.11 at two digits.
    expect(leader(row('xgPerShot'), 0.114, 0.1149)).toBeNull();
    // 0.116 prints as 0.12 and 0.114 as 0.11: a lead.
    expect(leader(row('xgPerShot'), 0.116, 0.114)).toBe('a');
  });

  it('is nobody on matches, which are neither better nor worse', () => {
    expect(leader(row('matches'), 41, 12)).toBeNull();
  });

  it('is nobody when one side cannot be worked out', () => {
    expect(leader(row('goalsPerShot'), null, 12)).toBeNull();
    expect(leader(row('goalsPerShot'), 12, null)).toBeNull();
  });
});

describe('the table', () => {
  it('has ten rows, the totals first, and only matches unranked', () => {
    expect(STAT_ROWS.map((r) => r.key)).toEqual([
      'matches',
      'shots',
      'onTarget',
      'goals',
      'xg',
      'shotsPerMatch',
      'goalsPerMatch',
      'goalsPerShot',
      'xgPerShot',
      'finishing',
    ]);
    expect(STAT_ROWS.filter((r) => !r.ranked).map((r) => r.key)).toEqual(['matches']);
    expect(new Set(STAT_ROWS.map((r) => r.key)).size).toBe(STAT_ROWS.length);
  });

  it('prints both sides of every row and says who leads', () => {
    const a = figuresFor(A, { competition: 11, season: 27 });
    const b = figuresFor(B, { competition: 11, season: 27 });
    if (!a || !b) throw new Error('no figures');
    const lines = Object.fromEntries(statLines(a, b).map((l) => [l.key, l]));
    expect(lines.matches).toMatchObject({ a: '10', b: '10', lead: null });
    expect(lines.shots).toMatchObject({ a: '100', b: '80', lead: 'a' });
    expect(lines.goals).toMatchObject({ a: '20', b: '18', lead: 'a' });
    expect(lines.xg).toMatchObject({ a: '15.50', b: '12.00', lead: 'a' });
    // 20 / 100 = 20.0 %, 18 / 80 = 22.5 %.
    expect(lines.goalsPerShot).toMatchObject({ a: '20.0%', b: '22.5%', lead: 'b' });
    // 20 - 15.5 = +4.50 against 18 - 12 = +6.00.
    expect(lines.finishing).toMatchObject({ a: '+4.50', b: '+6.00', lead: 'b' });
  });

  it('prints a dash’s worth of nothing for a rate over no shots', () => {
    const none = { matches: 0, shots: 0, goals: 0, onTarget: 0, xg: 0 };
    const lines = Object.fromEntries(statLines(none, none).map((l) => [l.key, l]));
    expect(lines.goalsPerShot).toMatchObject({ a: null, b: null, lead: null });
    expect(lines.shotsPerMatch).toMatchObject({ a: null, b: null, lead: null });
    expect(lines.shots).toMatchObject({ a: '0', b: '0', lead: null });
  });
});
