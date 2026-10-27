import { describe, expect, it } from 'vitest';
import {
  EMPTY_BROWSE,
  PAGE_SIZES,
  apiPathOf,
  browseUrl,
  formatBrowse,
  parseBrowse,
} from './browse';
import { WINDOW_FROM, windowOf } from './windowing';

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
      limit: 100,
      cursor: '2022-12-18_1700_3869685',
    };
    const search = formatBrowse(query);
    expect(search).toBe(
      '?competition=43&season=106&stage=7&team=779&from=2022-11-20&to=2022-12-18&limit=100&cursor=2022-12-18_1700_3869685',
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
    expect(apiPathOf(EMPTY_BROWSE)).toBe('/v1/matches?limit=50');
    expect(
      apiPathOf({
        ...EMPTY_BROWSE,
        team: 779,
        limit: 200,
        cursor: 'a_b_2',
        from: '2022-01-01',
      }),
    ).toBe('/v1/matches?team=779&from=2022-01-01&cursor=a_b_2&limit=200');
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
