import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { normalise } from '../lib/search';

// The client's side of accent folding, through the code the picker runs (`search` and its
// validator) against a running API (`wrangler dev` in CI, see .github/workflows/ci.yml).
// The SQL side is in packages/ingest (export.test.ts) and apps/api (app.test.ts).
const API_URL = process.env.API_URL;

describe.skipIf(!API_URL)(`searching a running API (${API_URL ?? 'no API_URL'})`, () => {
  let find: typeof import('./browse').search;

  beforeAll(async () => {
    vi.stubEnv('VITE_API_URL', API_URL ?? '');
    vi.resetModules();
    find = (await import('./browse')).search;
  });
  afterAll(() => vi.unstubAllEnvs());

  const names = async (words: string) => {
    const found = await find(words);
    return [...found.players, ...found.teams].map((p) => p.name);
  };

  it('finds the same people however the words are cased or accented', async () => {
    for (const [plain, accented, expected] of [
      ['angel di maria', 'Ángel Di María', 'Ángel Di María'],
      ['mbappe', 'MBAPPÉ', 'Kylian Mbappé'],
      ['ismaila', 'Ismaïla', 'Ismaïla Sarr'],
      ['nicolas otamendi', 'Nicolás Otamendi', 'Nicolás Otamendi'],
    ] as const) {
      const a = await names(plain);
      const b = await names(accented);
      expect(a, plain).toContain(expected);
      expect(b, accented).toEqual(a);
      // The client's own folding agrees about what is the same search.
      expect(normalise(accented)).toBe(normalise(plain.toUpperCase()));
    }
  });

  it('matches the start of a word, not the inside of one', async () => {
    expect(await names('mes')).toContain('Lionel Messi');
    expect(await names('essi')).toEqual([]);
  });

  it('gives matches as pairs of teams with dates, and finds one by both names and its stage', async () => {
    const found = await find('argentina france final');
    expect(found.matches.map((m) => `${m.home} v ${m.away}`)).toEqual([
      'Argentina v France',
    ]);
    expect(found.matches[0]?.date).toBe('2022-12-18');
  });

  it('is empty for words that start nothing, and does not throw on odd characters', async () => {
    for (const words of ['zzzz', "o'brien", '100%', 'a/b', '\\', '"quoted"']) {
      const found = await find(words);
      expect(found.q).toBe(words);
    }
  });
});
