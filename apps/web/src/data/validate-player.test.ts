import { describe, expect, it } from 'vitest';
import { DataError } from './validate';
import { assertPlayer, assertPlayerShots } from './validate-player';

const stats = { matches: 7, shots: 32, goals: 7, onTarget: 17, xg: 8.9 };
const profile = () => ({
  id: 5503,
  name: 'Lionel Messi',
  fullName: 'Lionel Andrés Messi Cuccittini',
  teams: [{ id: 779, name: 'Argentina', shots: 32 }],
  totals: { ...stats },
  seasons: [
    {
      competition: { id: 43, name: 'FIFA World Cup' },
      season: { id: 106, name: '2022' },
      ...stats,
    },
  ],
});

const shots = (n = 2) => {
  const col = (v: number) => Array.from({ length: n }, () => v);
  return {
    n,
    cols: {
      shot: Array.from({ length: n }, (_, i) => 3869685000 + i),
      seq: Array.from({ length: n }, (_, i) => i),
      side: col(0),
      team: col(779),
      player: col(5503),
      period: col(1),
      min: col(10),
      sec: col(0),
      x: col(105),
      y: col(40),
      ex: col(120),
      ey: col(40),
      ez: Array.from({ length: n }, () => null),
      xg: col(0.1),
      out: col(97),
      body: col(40),
      type: col(87),
      tech: col(93),
      match: col(3869685),
    },
    truncated: false,
  };
};

describe('a player from the API', () => {
  it('is accepted whole, and again with no seasons', () => {
    expect(assertPlayer(profile()).seasons).toHaveLength(1);
    expect(assertPlayer({ ...profile(), seasons: [] }).seasons).toEqual([]);
  });

  it('is refused, loudly, when anything is missing or the wrong kind', () => {
    const broken: [string, (p: ReturnType<typeof profile>) => unknown][] = [
      ['not an object', () => null],
      ['no name', (p) => ({ ...p, name: '' })],
      ['no full name', (p) => ({ ...p, fullName: undefined })],
      ['teams that are not a list', (p) => ({ ...p, teams: {} })],
      ['a team without a name', (p) => ({ ...p, teams: [{ id: 1, shots: 1 }] })],
      ['no totals', (p) => ({ ...p, totals: undefined })],
      ['a negative count', (p) => ({ ...p, totals: { ...p.totals, shots: -1 } })],
      ['xG that is not a number', (p) => ({ ...p, totals: { ...p.totals, xg: '8.9' } })],
      ['no seasons', (p) => ({ ...p, seasons: undefined })],
      ['a season without its competition', (p) => ({ ...p, seasons: [{ ...stats }] })],
      [
        'a season with a competition that has no name',
        (p) => ({
          ...p,
          seasons: [
            { ...stats, competition: { id: 43 }, season: { id: 106, name: '2022' } },
          ],
        }),
      ],
      [
        'a season whose goals are fractional',
        (p) => ({
          ...p,
          seasons: [
            {
              ...p.seasons[0],
              goals: 1.5,
            },
          ],
        }),
      ],
    ];
    for (const [what, make] of broken)
      expect(() => assertPlayer(make(profile())), what).toThrow(DataError);
  });
});

describe("a player's shots from the API", () => {
  it('is accepted, truncated or not, empty or not', () => {
    expect(assertPlayerShots(shots()).truncated).toBe(false);
    expect(assertPlayerShots({ ...shots(), truncated: true }).truncated).toBe(true);
    expect(assertPlayerShots(shots(0)).n).toBe(0);
  });

  it('is refused without the flag that says whether shots were left out', () => {
    const without = Object.fromEntries(
      Object.entries(shots()).filter(([key]) => key !== 'truncated'),
    );
    expect(() => assertPlayerShots(without)).toThrow(/truncated/);
    expect(() => assertPlayerShots({ ...shots(), truncated: 'no' })).toThrow(/truncated/);
  });

  it('is refused without the match column, or with one of the wrong length', () => {
    const noMatch = shots();
    const cols = Object.fromEntries(
      Object.entries(noMatch.cols).filter(([key]) => key !== 'match'),
    );
    expect(() => assertPlayerShots({ ...noMatch, cols })).toThrow(/match/);
    const short = shots();
    short.cols.match = [1];
    expect(() => assertPlayerShots(short)).toThrow(/match/);
    const words = shots();
    (words.cols as { match: unknown[] }).match = ['a', 'b'];
    expect(() => assertPlayerShots(words)).toThrow(/match/);
  });

  it('still has every check a match payload has', () => {
    const uneven = shots();
    uneven.cols.xg = [0.1];
    expect(() => assertPlayerShots(uneven)).toThrow(/column xg has 1 rows/);
    expect(() => assertPlayerShots(null)).toThrow(DataError);
  });
});
