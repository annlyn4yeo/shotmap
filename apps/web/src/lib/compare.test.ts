import { describe, expect, it } from 'vitest';
import {
  EMPTY_COMPARE,
  compareUrl,
  formatCompareView,
  otherSlot,
  parseCompareView,
  playerIn,
} from './compare';

describe('the compare page’s address', () => {
  it('has nobody chosen at /compare', () => {
    expect(parseCompareView('')).toEqual(EMPTY_COMPARE);
    expect(formatCompareView(EMPTY_COMPARE)).toBe('');
    expect(compareUrl(EMPTY_COMPARE)).toBe('/compare');
  });

  it('reads both players and the scope they share', () => {
    expect(parseCompareView('?a=5503&b=5207&competition=11&season=27')).toEqual({
      a: 5503,
      b: 5207,
      competition: 11,
      season: 27,
    });
  });

  it('is the same link after a round trip, in one fixed order', () => {
    const view = { a: 5503, b: 5207, competition: 11, season: 27 };
    expect(formatCompareView(view)).toBe('?a=5503&b=5207&competition=11&season=27');
    expect(parseCompareView(formatCompareView(view))).toEqual(view);
    expect(
      formatCompareView(parseCompareView('?season=27&b=5207&competition=11&a=5503')),
    ).toBe('?a=5503&b=5207&competition=11&season=27');
  });

  it('lets one side be chosen before the other', () => {
    expect(parseCompareView('?a=5503')).toEqual({ ...EMPTY_COMPARE, a: 5503 });
    expect(parseCompareView('?b=5207')).toEqual({ ...EMPTY_COMPARE, b: 5207 });
  });

  it('keeps a season only with its competition, and a competition only with its season', () => {
    expect(parseCompareView('?a=1&b=2&season=27')).toMatchObject({
      competition: null,
      season: null,
    });
    expect(parseCompareView('?a=1&b=2&competition=11')).toMatchObject({
      competition: null,
      season: null,
    });
  });

  it('ignores what it does not understand', () => {
    expect(parseCompareView('?a=messi&b=-3&competition=1.5&season=x&z=1')).toEqual(
      EMPTY_COMPARE,
    );
    expect(parseCompareView('?a=1234567890&b=2')).toMatchObject({ a: null, b: 2 });
  });

  it('does not compare a player with themselves', () => {
    expect(parseCompareView('?a=5503&b=5503')).toEqual({ ...EMPTY_COMPARE, a: 5503 });
  });

  it('changes one thing and leaves the rest', () => {
    const view = { a: 5503, b: 5207, competition: 11, season: 27 };
    expect(compareUrl(view, { b: 3961 })).toBe(
      '/compare?a=5503&b=3961&competition=11&season=27',
    );
    expect(compareUrl(view, { competition: null, season: null })).toBe(
      '/compare?a=5503&b=5207',
    );
    expect(compareUrl(view, { a: null })).toBe(
      '/compare?b=5207&competition=11&season=27',
    );
  });
});

describe('the two sides', () => {
  it('names the player on a side, and the other side', () => {
    const view = { ...EMPTY_COMPARE, a: 1, b: 2 };
    expect(playerIn(view, 'a')).toBe(1);
    expect(playerIn(view, 'b')).toBe(2);
    expect(otherSlot('a')).toBe('b');
    expect(otherSlot('b')).toBe('a');
  });
});
