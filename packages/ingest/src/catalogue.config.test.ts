import { describe, expect, it } from 'vitest';
import { inScope, scope, seasonYear } from './catalogue.config';

describe('what is kept of the catalogue', () => {
  it('reads the year a season starts, whichever way the source writes it', () => {
    expect(seasonYear('2015/2016')).toBe(2015);
    expect(seasonYear('2022')).toBe(2022);
    expect(seasonYear('1958')).toBe(1958);
    expect(seasonYear('')).toBeNaN();
    expect(seasonYear('winter')).toBeNaN();
  });

  it('is five competitions from the 2014 seasons on', () => {
    expect(scope.map((s) => s.competition)).toEqual([
      'Premier League',
      'La Liga',
      'Champions League',
      'FIFA World Cup',
      'UEFA Euro',
    ]);
    expect(scope.every((s) => s.since === 2014)).toBe(true);
  });

  it('keeps the original 149 matches: the 2022 World Cup, Euro 2024 and La Liga 2018/19', () => {
    expect(inScope('FIFA World Cup', '2022')).toBe(true);
    expect(inScope('UEFA Euro', '2024')).toBe(true);
    expect(inScope('La Liga', '2018/2019')).toBe(true);
  });

  it('keeps the recent tournaments and seasons, and the first one at the edge', () => {
    for (const [c, s] of [
      ['FIFA World Cup', '2018'],
      ['UEFA Euro', '2020'],
      ['Premier League', '2015/2016'],
      ['La Liga', '2014/2015'],
      ['La Liga', '2020/2021'],
      ['Champions League', '2014/2015'],
      ['Champions League', '2018/2019'],
    ] as const)
      expect(inScope(c, s), `${c} ${s}`).toBe(true);
  });

  it('leaves out older seasons, the older World Cups, other competitions and the women', () => {
    for (const [c, s] of [
      ['La Liga', '2013/2014'],
      ['La Liga', '2004/2005'],
      ['Premier League', '2003/2004'],
      ['Champions League', '2013/2014'],
      ['Champions League', '1999/2000'],
      ['FIFA World Cup', '1990'],
      ['FIFA World Cup', '1958'],
      ['Serie A', '2015/2016'],
      ['Bundesliga', '2023/2024'],
      ['1. Bundesliga', '2023/2024'],
      ["Women's World Cup", '2023'],
      ["UEFA Women's Euro", '2022'],
      ['Copa America', '2024'],
      ['UEFA Europa League', '2020/2021'],
    ] as const)
      expect(inScope(c, s), `${c} ${s}`).toBe(false);
  });
});
