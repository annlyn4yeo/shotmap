import { describe, expect, it } from 'vitest';
import { seasonSpan, shortSeason } from './seasons';

describe('season names in words', () => {
  it('shortens a two-year season and leaves a single year alone', () => {
    expect(shortSeason('2014/2015')).toBe('2014/15');
    expect(shortSeason('2022')).toBe('2022');
  });

  it('says one season, two, or a run of them, oldest first whatever the order given', () => {
    expect(seasonSpan(['2015/2016'])).toBe('2015/16');
    expect(seasonSpan(['2022', '2018'])).toBe('2018 and 2022');
    expect(seasonSpan(['2017/2018', '2015/2016', '2016/2017'])).toBe(
      '2015/16 to 2017/18',
    );
    expect(seasonSpan([])).toBe('');
  });
});
