import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUTE,
  formatUrl,
  fromLegacyHash,
  isFiltered,
  parseUrl,
  type Route,
} from './route';

describe('the match view in the URL', () => {
  it('is just / for the defaults, so the plain page stays clean', () => {
    expect(formatUrl(DEFAULT_ROUTE)).toBe('/');
    expect(parseUrl('/', '')).toEqual(DEFAULT_ROUTE);
    expect(parseUrl('/', '?')).toEqual(DEFAULT_ROUTE);
  });

  it('puts the match in the path and the filters in the query, and round-trips them', () => {
    const route: Route = {
      m: 3869685,
      team: 'away',
      player: 5503,
      hide: ['blocked', 'off'],
      shootout: true,
      shot: 12,
    };
    const url = formatUrl(route);
    expect(url).toBe(
      '/match/3869685?team=away&player=5503&hide=blocked,off&so=1&shot=12',
    );
    const [path = '', query = ''] = url.split('?');
    expect(parseUrl(path, `?${query}`)).toEqual(route);
  });

  it('knows the hero by the missing match, and any other match by its path', () => {
    expect(parseUrl('/', '?team=home').m).toBeNull();
    expect(parseUrl('/match/3857291', '').m).toBe(3857291);
    expect(parseUrl('/match/3857291/', '').m).toBe(3857291);
    expect(formatUrl({ ...DEFAULT_ROUTE, m: 3857291 })).toBe('/match/3857291');
  });

  it('ignores anything it does not understand instead of failing', () => {
    expect(
      parseUrl(
        '/match/abc',
        '?team=sideways&player=-3&hide=goal,nonsense,goal&so=yes&shot=1.5',
      ),
    ).toEqual({ ...DEFAULT_ROUTE, hide: ['goal'] });
    expect(parseUrl('/match/12345678901', '').m).toBeNull();
  });

  it('writes outcomes in a fixed order, so the same view is always the same URL', () => {
    expect(formatUrl({ ...DEFAULT_ROUTE, hide: ['saved', 'goal'] })).toBe(
      formatUrl({ ...DEFAULT_ROUTE, hide: ['goal', 'saved'] }),
    );
  });

  it('does not count the match or the selected shot as a filter', () => {
    expect(isFiltered({ ...DEFAULT_ROUTE, m: 5, shot: 3 })).toBe(false);
    expect(isFiltered({ ...DEFAULT_ROUTE, team: 'home' })).toBe(true);
    expect(isFiltered({ ...DEFAULT_ROUTE, player: 5503 })).toBe(true);
    expect(isFiltered({ ...DEFAULT_ROUTE, hide: ['off'] })).toBe(true);
    expect(isFiltered({ ...DEFAULT_ROUTE, shootout: true })).toBe(true);
  });
});

// Links shared before path routes kept everything in the hash. The page turns one into the URL
// that means the same, once, with replaceState; `p` was an index into the match's player list,
// which means nothing now, so it is dropped, and `shot` is still the position within the match.
describe('legacy hash links', () => {
  it('become the path and query that mean the same', () => {
    expect(fromLegacyHash('#m=3869685&team=home&p=4&hide=off,blocked&so=1&shot=12')).toBe(
      '/match/3869685?team=home&hide=blocked,off&so=1&shot=12',
    );
  });

  it('keep a link that was only a shot, and a link to the hero', () => {
    expect(fromLegacyHash('#shot=37')).toBe('/?shot=37');
    expect(fromLegacyHash('#m=3857300&shot=0')).toBe('/match/3857300?shot=0');
    expect(fromLegacyHash('#team=away')).toBe('/?team=away');
  });

  it('never read p as a player id, whatever its size', () => {
    for (const p of ['0', '4', '23', '5503'])
      expect(fromLegacyHash(`#m=3869685&p=${p}`)).toBe('/match/3869685');
  });

  it('read the player= of the format on the branch before this one', () => {
    expect(fromLegacyHash('#m=3869685&player=5503&team=home')).toBe(
      '/match/3869685?team=home&player=5503',
    );
  });

  it('drop what is not understood, as the URL does', () => {
    expect(fromLegacyHash('#m=abc&team=sideways&hide=nonsense&shot=1.5')).toBe('/');
  });

  it('leave an ordinary hash alone, so a #fragment is not redirected', () => {
    for (const hash of ['', '#', '#footer', '#section-2', '#a=1'])
      expect(fromLegacyHash(hash), hash).toBeNull();
  });

  it('end up on a URL that parses to the view the old link described', () => {
    const url = fromLegacyHash('#m=3857291&team=away&hide=goal&so=1&shot=5') ?? '';
    const [path = '', query = ''] = url.split('?');
    expect(parseUrl(path, `?${query}`)).toEqual({
      m: 3857291,
      team: 'away',
      player: null,
      hide: ['goal'],
      shootout: true,
      shot: 5,
    });
  });
});
