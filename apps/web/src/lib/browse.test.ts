import { describe, expect, it } from 'vitest';
import {
  EMPTY_BROWSE,
  PAGE_SIZES,
  apiPathOf,
  browseUrl,
  formatBrowse,
  opensGroup,
  parseBrowse,
  tallyOf,
} from './browse';
import { WINDOW_FROM, windowOf } from './windowing';

describe('how many matches the choice holds', () => {
  const meta = {
    counts: { matches: 1205, shots: 1, players: 1, teams: 1 },
    competitions: [
      {
        id: 11,
        name: 'La Liga',
        seasons: [
          { id: 27, name: '2015/2016', matches: 380 },
          { id: 4, name: '2018/2019', matches: 34 },
        ],
      },
    ],
  };
  const of = (change: Partial<typeof EMPTY_BROWSE>) =>
    tallyOf({ ...EMPTY_BROWSE, ...change }, meta);

  it('is the release, a competition or one season', () => {
    expect(of({})).toEqual({ value: 1205, label: 'Every competition' });
    expect(of({ competition: 11 })).toEqual({ value: 414, label: 'La Liga' });
    expect(of({ competition: 11, season: 4 })).toEqual({
      value: 34,
      label: 'La Liga 2018/2019',
    });
  });

  it('says nothing it cannot count, or before it knows', () => {
    expect(of({ competition: 11, stage: 3 })).toBeNull();
    expect(of({ team: 217 })).toBeNull();
    expect(of({ from: '2020-01-01' })).toBeNull();
    expect(of({ to: '2020-01-01' })).toBeNull();
    expect(of({ competition: 99 })).toBeNull();
    expect(of({ competition: 11, season: 99 })).toBeNull();
    expect(tallyOf(EMPTY_BROWSE, null)).toBeNull();
  });
});

describe('where the list draws a rule', () => {
  const match = (date: string, stage = 3, competition = 55, season = 282) => ({
    date,
    stage,
    competition,
    season,
  });

  it('never above the first row: the list has its own', () => {
    expect(opensGroup(undefined, match('2024-07-14'), 'Final')).toBe(false);
  });

  it('where a knockout moves to another round, and not between two games of one', () => {
    const quarter = match('2024-07-06', 3);
    const otherQuarter = match('2024-07-05', 3);
    expect(opensGroup(quarter, otherQuarter, 'Quarter-finals')).toBe(false);
    expect(opensGroup(match('2024-07-09', 4), quarter, 'Quarter-finals')).toBe(true);
  });

  it('at each new day of a group stage', () => {
    const a = match('2024-06-20', 1);
    expect(opensGroup(a, match('2024-06-20', 1), 'Group Stage')).toBe(false);
    expect(opensGroup(a, match('2024-06-19', 1), 'Group Stage')).toBe(true);
  });

  it('at each new month of a league, not at each day', () => {
    const a = match('2016-05-14', 0, 11, 27);
    expect(opensGroup(a, match('2016-05-08', 0, 11, 27), 'Regular Season')).toBe(false);
    expect(opensGroup(a, match('2016-04-30', 0, 11, 27), 'Regular Season')).toBe(true);
  });

  it('where the list moves to another season or competition', () => {
    const final = match('2024-07-14', 6);
    expect(opensGroup(final, match('2022-12-18', 6, 43, 106), 'Final')).toBe(true);
    expect(opensGroup(final, match('2020-07-11', 6, 55, 43), 'Final')).toBe(true);
  });
});

describe('the browse page in the URL', () => {
  it('has no query for the defaults', () => {
    expect(parseBrowse('')).toEqual(EMPTY_BROWSE);
    expect(formatBrowse(EMPTY_BROWSE)).toBe('');
    expect(browseUrl(EMPTY_BROWSE)).toBe('/matches');
  });

  it('round-trips every filter, the page size and the cursor', () => {
    const query = {
      competition: 43,
      season: 106,
      stage: 7,
      team: 779,
      from: '2022-11-20',
      to: '2022-12-18',
      order: 'oldest' as const,
      limit: 100,
      cursor: '2022-12-18_1700_3869685',
    };
    const search = formatBrowse(query);
    expect(search).toBe(
      '?competition=43&season=106&stage=7&team=779&from=2022-11-20&to=2022-12-18&order=oldest&limit=100&cursor=2022-12-18_1700_3869685',
    );
    expect(parseBrowse(search)).toEqual(query);
  });

  it('ignores what it does not understand, so a hand-edited URL never breaks the page', () => {
    expect(
      parseBrowse(
        '?competition=abc&stage=-1&team=1.5&from=yesterday&to=2022-13&limit=7&cursor=a b;c',
      ),
    ).toEqual(EMPTY_BROWSE);
    expect(parseBrowse('?limit=200').limit).toBe(200);
    expect(parseBrowse('?limit=999').limit).toBe(PAGE_SIZES[0]);
  });

  it('shows the latest matches first, and writes the order down only when it is the other way', () => {
    expect(EMPTY_BROWSE.order).toBe('newest');
    expect(parseBrowse('?order=oldest').order).toBe('oldest');
    expect(parseBrowse('?order=newest').order).toBe('newest');
    expect(parseBrowse('?order=sideways').order).toBe('newest');
    expect(formatBrowse({ ...EMPTY_BROWSE, order: 'oldest' })).toBe('?order=oldest');
    expect(formatBrowse({ ...EMPTY_BROWSE, order: 'newest' })).toBe('');
    // Another order is another list: it starts again from the first page.
    const at = { ...EMPTY_BROWSE, cursor: 'x_y_1' };
    expect(browseUrl(at, { order: 'oldest' })).toBe('/matches?order=oldest');
  });

  it('keeps a season only inside its competition', () => {
    expect(parseBrowse('?season=106').season).toBeNull();
    expect(parseBrowse('?competition=43&season=106').season).toBe(106);
    expect(formatBrowse({ ...EMPTY_BROWSE, season: 106 })).toBe('');
  });

  it('starts again from the first page when a filter changes, and forgets the old season', () => {
    const at = { ...EMPTY_BROWSE, competition: 43, season: 106, cursor: 'x_y_1' };
    expect(browseUrl(at, { stage: 7 })).toBe(
      '/matches?competition=43&season=106&stage=7',
    );
    expect(browseUrl(at, { competition: 55 })).toBe('/matches?competition=55');
    expect(browseUrl(at, { competition: 43 })).toBe('/matches?competition=43&season=106');
    expect(browseUrl(at, { cursor: 'a_b_2' })).toBe(
      '/matches?competition=43&season=106&cursor=a_b_2',
    );
  });

  it('asks the API for the same list, always with a limit', () => {
    expect(apiPathOf(EMPTY_BROWSE)).toBe('/v1/matches?order=newest&limit=50');
    expect(apiPathOf({ ...EMPTY_BROWSE, order: 'oldest' })).toBe(
      '/v1/matches?order=oldest&limit=50',
    );
    expect(
      apiPathOf({
        ...EMPTY_BROWSE,
        team: 779,
        limit: 200,
        cursor: 'a_b_2',
        from: '2022-01-01',
      }),
    ).toBe('/v1/matches?team=779&from=2022-01-01&cursor=a_b_2&order=newest&limit=200');
  });
});

describe('windowing a long list', () => {
  it('draws the rows on screen and a few around them', () => {
    expect(windowOf(200, 64, 0, 640, 8)).toEqual({ start: 0, end: 18 });
    expect(windowOf(200, 64, 6400, 640, 8)).toEqual({ start: 92, end: 118 });
  });

  it('never goes past either end of the list', () => {
    expect(windowOf(200, 64, 99999, 640, 8)).toEqual({ start: 200, end: 200 });
    expect(windowOf(10, 64, 0, 5000, 8)).toEqual({ start: 0, end: 10 });
    expect(windowOf(0, 64, 0, 640, 8)).toEqual({ start: 0, end: 0 });
  });

  it('draws everything when it cannot tell how tall a row is', () => {
    expect(windowOf(200, 0, 500, 640)).toEqual({ start: 0, end: 200 });
  });

  it('draws a screenful, not the whole page, of the largest page size', () => {
    const { start, end } = windowOf(200, 64, 3000, 800);
    expect(end - start).toBeLessThan(40);
    expect(WINDOW_FROM).toBeLessThan(PAGE_SIZES[1]);
  });
});
