import type { Player } from '@shotmap/schema';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEW,
  MARK_LIMIT,
  formatPlayerView,
  matchHref,
  narrowTo,
  parsePlayerView,
  playerUrl,
  selectedSeason,
  shotsIn,
  sortSeasons,
  type SeasonRow,
} from './player';

const row = (
  competition: number,
  name: string,
  season: number,
  year: string,
  stats: [matches: number, shots: number, goals: number, onTarget: number, xg: number],
): SeasonRow => ({
  competition: { id: competition, name },
  season: { id: season, name: year },
  matches: stats[0],
  shots: stats[1],
  goals: stats[2],
  onTarget: stats[3],
  xg: stats[4],
});

/** Oldest first, as the API gives them. */
const SEASONS: SeasonRow[] = [
  row(11, 'La Liga', 4, '2018/2019', [34, 171, 36, 86, 23.1]),
  row(55, 'UEFA Euro', 282, '2024', [5, 20, 3, 9, 2.5]),
  row(43, 'FIFA World Cup', 106, '2022', [7, 32, 7, 17, 8.9]),
];
const PROFILE: Player = {
  id: 5503,
  name: 'Lionel Messi',
  fullName: 'Lionel Andrés Messi Cuccittini',
  teams: [],
  totals: { matches: 46, shots: 223, goals: 46, onTarget: 112, xg: 34.5 },
  seasons: SEASONS,
};

describe('the player page in the URL', () => {
  it('is just the path for the defaults', () => {
    expect(formatPlayerView(DEFAULT_VIEW)).toBe('');
    expect(parsePlayerView('')).toEqual(DEFAULT_VIEW);
    expect(playerUrl(5503, DEFAULT_VIEW)).toBe('/players/5503');
  });

  it('round-trips a full view, with a shot id of ten digits', () => {
    const view = {
      competition: 43,
      season: 106,
      hide: ['blocked', 'off'] as const,
      shot: 3869685012,
      sort: 'shots' as const,
      dir: 'asc' as const,
    };
    const search = formatPlayerView(view);
    expect(search).toBe(
      '?competition=43&season=106&hide=blocked,off&shot=3869685012&sort=shots&dir=asc',
    );
    expect(parsePlayerView(search)).toEqual(view);
  });

  it('keeps a season only with its competition, and the other way round', () => {
    expect(parsePlayerView('?season=106').season).toBeNull();
    expect(parsePlayerView('?competition=43').competition).toBeNull();
    expect(parsePlayerView('?competition=43&season=106')).toMatchObject({
      competition: 43,
      season: 106,
    });
    expect(formatPlayerView({ ...DEFAULT_VIEW, competition: 43, season: null })).toBe('');
  });

  it('ignores what it does not understand, so a hand-edited URL never breaks the page', () => {
    expect(
      parsePlayerView(
        '?competition=x&season=-1&hide=goal,nonsense,goal&shot=12abc&sort=popularity&dir=sideways',
      ),
    ).toEqual({ ...DEFAULT_VIEW, hide: ['goal'] });
    expect(parsePlayerView('?shot=99999999999999999').shot).toBeNull();
  });

  it('forgets the selected shot when the selection changes, and only then', () => {
    const view = { ...DEFAULT_VIEW, shot: 3869685012 };
    expect(playerUrl(1, view, { competition: 43, season: 106 })).toBe(
      '/players/1?competition=43&season=106',
    );
    expect(playerUrl(1, view, { hide: ['off'] })).toBe('/players/1?hide=off');
    expect(playerUrl(1, view, { sort: 'xg' })).toBe('/players/1?shot=3869685012&sort=xg');
    expect(playerUrl(1, view, { shot: 3857291003 })).toBe('/players/1?shot=3857291003');
    expect(playerUrl(1, view, { shot: null })).toBe('/players/1');
  });
});

describe('the season table in order', () => {
  const names = (rows: SeasonRow[]) => rows.map((r) => r.season.name);

  it('puts the oldest first or last by time, as the API gives them', () => {
    expect(names(sortSeasons(SEASONS, 'when', 'asc'))).toEqual([
      '2018/2019',
      '2024',
      '2022',
    ]);
    expect(names(sortSeasons(SEASONS, 'when', 'desc'))).toEqual([
      '2022',
      '2024',
      '2018/2019',
    ]);
  });

  it('sorts by each figure, either way', () => {
    expect(names(sortSeasons(SEASONS, 'shots', 'desc'))).toEqual([
      '2018/2019',
      '2022',
      '2024',
    ]);
    expect(names(sortSeasons(SEASONS, 'shots', 'asc'))).toEqual([
      '2024',
      '2022',
      '2018/2019',
    ]);
    expect(names(sortSeasons(SEASONS, 'matches', 'desc'))).toEqual([
      '2018/2019',
      '2022',
      '2024',
    ]);
    expect(names(sortSeasons(SEASONS, 'goals', 'desc'))).toEqual([
      '2018/2019',
      '2022',
      '2024',
    ]);
    expect(names(sortSeasons(SEASONS, 'goals', 'asc'))).toEqual([
      '2024',
      '2022',
      '2018/2019',
    ]);
    expect(names(sortSeasons(SEASONS, 'onTarget', 'asc'))).toEqual([
      '2024',
      '2022',
      '2018/2019',
    ]);
    expect(names(sortSeasons(SEASONS, 'xg', 'desc'))).toEqual([
      '2018/2019',
      '2022',
      '2024',
    ]);
  });

  it('breaks a tie by time, oldest first, whichever way the figure goes', () => {
    const tied = [
      row(1, 'A', 1, 'a', [1, 10, 1, 1, 1]),
      row(1, 'A', 2, 'b', [1, 10, 1, 1, 1]),
      row(1, 'A', 3, 'c', [1, 5, 1, 1, 1]),
    ];
    expect(names(sortSeasons(tied, 'shots', 'desc'))).toEqual(['a', 'b', 'c']);
    expect(names(sortSeasons(tied, 'shots', 'asc'))).toEqual(['c', 'a', 'b']);
  });

  it('does not change the list it was given', () => {
    const before = [...SEASONS];
    sortSeasons(SEASONS, 'xg', 'desc');
    expect(SEASONS).toEqual(before);
  });
});

describe('choosing a season', () => {
  it('finds the selected row, and counts its shots, or the career when none is selected', () => {
    const view = { ...DEFAULT_VIEW, competition: 43, season: 106 };
    expect(selectedSeason(SEASONS, view)?.season.name).toBe('2022');
    expect(shotsIn(PROFILE, view)).toBe(32);
    expect(selectedSeason(SEASONS, DEFAULT_VIEW)).toBeUndefined();
    expect(shotsIn(PROFILE, DEFAULT_VIEW)).toBe(223);
    expect(
      selectedSeason(SEASONS, { ...DEFAULT_VIEW, competition: 43, season: 999 }),
    ).toBeUndefined();
  });

  it('offers the seasons small enough to draw, busiest first', () => {
    expect(MARK_LIMIT).toBe(300);
    expect(narrowTo(PROFILE).map((r) => r.season.name)).toEqual([
      '2018/2019',
      '2022',
      '2024',
    ]);
    const big = {
      ...PROFILE,
      seasons: [row(1, 'Big', 1, 'one', [50, 301, 1, 1, 1]), ...SEASONS],
    };
    // One shot over the limit is not offered; exactly at it would be.
    expect(narrowTo(big).map((r) => r.season.name)).not.toContain('one');
    const exact = {
      ...PROFILE,
      seasons: [row(1, 'Edge', 1, 'edge', [50, 300, 1, 1, 1])],
    };
    expect(narrowTo(exact)).toHaveLength(1);
    expect(narrowTo({ ...PROFILE, seasons: [] })).toEqual([]);
  });
});

describe('a shot away from its match', () => {
  it('links to the match with the shot selected and its side in view', () => {
    expect(matchHref(3869685, 12, 1)).toBe('/match/3869685?team=away&shot=12');
    expect(matchHref(3857291, 0, 0)).toBe('/match/3857291?team=home&shot=0');
  });
});
