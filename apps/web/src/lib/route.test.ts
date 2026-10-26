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
      player: 5503,
      hide: ['blocked', 'off'] as const,
      shootout: true,
      shot: 12,
    };
    const hash = formatHash(route);
    expect(hash).toBe('#m=3869685&team=away&player=5503&hide=blocked,off&so=1&shot=12');
    expect(parseHash(hash)).toEqual(route);
  });

  it('ignores anything it does not understand instead of failing', () => {
    expect(
      parseHash('#m=abc&team=sideways&player=-3&hide=goal,nonsense,goal&so=yes&shot=1.5'),
    ).toEqual({
      ...DEFAULT_ROUTE,
      hide: ['goal'],
    });
  });

  // Links shared before the API: `p` was an index into the match's player list, which
  // means nothing now. Everything else in them still works, and `shot` still means the
  // position of the shot within the match, so the same shot is selected.
  describe('legacy links', () => {
    it('keeps the match, team, outcomes, shootout and selected shot, and drops p', () => {
      expect(parseHash('#m=3869685&team=home&p=4&hide=off,blocked&so=1&shot=12')).toEqual(
        {
          m: 3869685,
          team: 'home',
          player: null,
          hide: ['blocked', 'off'],
          shootout: true,
          shot: 12,
        },
      );
    });

    it('still selects the same shot from a link that only had a shot', () => {
      expect(parseHash('#shot=37')).toEqual({ ...DEFAULT_ROUTE, shot: 37 });
      expect(parseHash('#m=3857300&shot=0')).toEqual({
        ...DEFAULT_ROUTE,
        m: 3857300,
        shot: 0,
      });
    });

    it('does not read a small p as a player id', () => {
      for (const p of ['0', '4', '23', '5503'])
        expect(parseHash(`#m=3869685&p=${p}`).player).toBeNull();
    });

    it('never writes p again: opening an old link and changing a filter makes a new-style one', () => {
      const old = parseHash('#m=3869685&p=4&team=away&shot=12');
      expect(formatHash(old)).toBe('#m=3869685&team=away&shot=12');
      expect(formatHash({ ...old, player: 5503 })).toBe(
        '#m=3869685&team=away&player=5503&shot=12',
      );
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
