import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalise as shared, wordsOf } from '@shotmap/schema';
import { normalise } from './search';

// The client folds accents with its own copy of normalise (sharing it through the schema
// package changes the bundle), while ingest builds the database's search text with the
// shared one. They must never disagree.
describe('normalise', () => {
  const names = new Set<string>();
  for (const f of readdirSync('public/data/matches')) {
    const m = JSON.parse(readFileSync(`public/data/matches/${f}`, 'utf8')) as {
      players: [string][];
      meta: { teams: { name: string }[]; stage: string };
    };
    for (const [name] of m.players) names.add(name);
    for (const t of m.meta.teams) names.add(t.name);
    names.add(m.meta.stage);
  }
  const extra = [
    'Türkiye',
    'Curaçao',
    'Szczęsny',
    'Çalhanoğlu',
    'ŁUKASZ',
    'Đorđe',
    'İstanbul',
    'Ñandú',
    'São Tomé',
    '',
  ];

  it('folds every player, team and stage name in the data the same way as the shared one', () => {
    expect(names.size).toBeGreaterThan(900);
    const different = [...names, ...extra].filter((n) => normalise(n) !== shared(n));
    expect(different).toEqual([]);
  });

  it('folds accents and case', () => {
    expect(normalise('Türkiye Curaçao')).toBe('turkiye curacao');
    expect(wordsOf('Ángel Di María, 2022-12-18')).toEqual([
      'angel',
      'di',
      'maria',
      '2022',
      '12',
      '18',
    ]);
  });
});
