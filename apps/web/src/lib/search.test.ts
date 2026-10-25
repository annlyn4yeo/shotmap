import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { IndexFile } from '../data/types';
import { entriesOf, groupEntries, normalise, searchEntries } from './search';

const index = JSON.parse(readFileSync('public/data/index.json', 'utf8')) as IndexFile;
const entries = entriesOf(index);
const names = (found: typeof entries) => found.map((e) => `${e.home} v ${e.away}`);

describe('match search', () => {
  it('flattens the whole index once', () => {
    expect(entries).toHaveLength(149);
    expect(entriesOf(index)).toBe(entries);
  });

  it('returns everything for an empty query', () => {
    expect(searchEntries(entries, '  ')).toHaveLength(149);
  });

  it('finds a team on either side, ignoring case', () => {
    const found = searchEntries(entries, 'argentina');
    expect(found.length).toBeGreaterThan(5);
    expect(found.every((e) => /argentina/i.test(`${e.home} ${e.away}`))).toBe(true);
    expect(names(searchEntries(entries, 'ARGENTINA FRANCE'))).toContain(
      'Argentina v France',
    );
  });

  it('needs every word to match, so a second word narrows the result', () => {
    const one = searchEntries(entries, 'france');
    const two = searchEntries(entries, 'france final');
    expect(two.length).toBeLessThan(one.length);
    expect(two.every((e) => /final/i.test(e.stage))).toBe(true);
  });

  it('ignores accents on both sides', () => {
    expect(normalise('Türkiye Curaçao')).toBe('turkiye curacao');
    expect(searchEntries(entries, 'turkiye').length).toBe(
      searchEntries(entries, 'türkiye').length,
    );
  });

  it('also matches stage, competition and year', () => {
    expect(searchEntries(entries, 'semi')[0]?.stage).toMatch(/Semi/);
    expect(
      searchEntries(entries, 'euro 2024').every((e) => e.competition === 'UEFA Euro'),
    ).toBe(true);
  });

  it('returns nothing for gibberish', () => {
    expect(searchEntries(entries, 'zzzzqq')).toEqual([]);
  });

  it('groups by competition and season, in index order', () => {
    const groups = groupEntries(entries);
    expect(groups.map((g) => g.title)).toEqual([
      'FIFA World Cup 2022',
      'UEFA Euro 2024',
      'La Liga 2018/2019',
    ]);
    expect(groups.reduce((n, g) => n + g.entries.length, 0)).toBe(149);
  });
});
