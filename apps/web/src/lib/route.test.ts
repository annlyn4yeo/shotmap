import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTE, formatHash, isFiltered, parseHash } from './route';

describe('route in the URL hash', () => {
  it('has an empty hash for the defaults, so the plain page stays clean', () => {
    expect(formatHash(DEFAULT_ROUTE)).toBe('');
    expect(parseHash('')).toEqual(DEFAULT_ROUTE);
    expect(parseHash('#')).toEqual(DEFAULT_ROUTE);
  });

  it('round-trips a full view', () => {
    const route = {
      m: 3869685,
      team: 'away' as const,
      player: 4,
      hide: ['blocked', 'off'] as const,
      shootout: true,
      shot: 12,
    };
    const hash = formatHash(route);
    expect(hash).toBe('#m=3869685&team=away&p=4&hide=blocked,off&so=1&shot=12');
    expect(parseHash(hash)).toEqual(route);
  });

  it('ignores anything it does not understand instead of failing', () => {
    expect(
      parseHash('#m=abc&team=sideways&p=-3&hide=goal,nonsense,goal&so=yes&shot=1.5'),
    ).toEqual({
      ...DEFAULT_ROUTE,
      hide: ['goal'],
    });
  });

  it('writes outcomes in a fixed order, so the same view is always the same URL', () => {
    expect(formatHash({ ...DEFAULT_ROUTE, hide: ['saved', 'goal'] })).toBe(
      formatHash({ ...DEFAULT_ROUTE, hide: ['goal', 'saved'] }),
    );
  });

  it('does not count the match or the selected shot as a filter', () => {
    expect(isFiltered({ ...DEFAULT_ROUTE, m: 5, shot: 2 })).toBe(false);
    expect(isFiltered({ ...DEFAULT_ROUTE, shootout: true })).toBe(true);
    expect(isFiltered({ ...DEFAULT_ROUTE, team: 'both' })).toBe(true);
  });
});
