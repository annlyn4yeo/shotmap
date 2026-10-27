import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HERO_MATCH_ID, shotIdOf } from '@shotmap/schema';
import { MatchDetailSchema, MatchShotsSchema, envelope } from '@shotmap/schema/zod';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURE_PATH, buildFixture } from './fixture';
import { haveDb } from './testdb';

/** The whole catalogue's database, when it has been built here (CI builds the three competitions only). */
const CATALOGUE_DB = join(
  import.meta.dirname,
  '..',
  'out',
  'catalogue',
  'shotmap.sqlite',
);

// The committed seed of the final, in /v1's shape. The web build inlines it and the web tests
// serve it, so it must be exactly what the database answers, and valid against the contract.
describe('the final as /v1 answers it', () => {
  // A Windows checkout may have turned the line ending into CRLF.
  const text = readFileSync(FIXTURE_PATH, 'utf8').replaceAll('\r\n', '\n');
  const fixture = JSON.parse(text) as {
    release: string;
    detail: unknown;
    shots: { n: number; cols: { shot: number[] } };
  };

  it('is valid against the contract schemas', () => {
    const detail = MatchDetailSchema.parse(fixture.detail);
    const shots = MatchShotsSchema.parse(fixture.shots);
    expect(detail.id).toBe(HERO_MATCH_ID);
    expect(shots.n).toBe(38);
    expect(shots.cols.shot).toEqual(
      Array.from({ length: shots.n }, (_, seq) => shotIdOf(HERO_MATCH_ID, seq)),
    );
    expect(
      envelope(MatchDetailSchema).safeParse({
        release: fixture.release,
        attribution: {
          source: 'StatsBomb',
          text: 'Data by StatsBomb',
          url: 'https://statsbomb.com',
          terms: 'https://github.com/statsbomb/open-data',
        },
        data: detail,
      }).success,
    ).toBe(true);
  });

  // What the final is must be what the database answers. The release is checked apart: the fixture
  // names the release that ships (the whole catalogue's), not the three competitions' build.
  it.skipIf(!haveDb)(
    'has the final exactly as the database answers it (regenerate: pnpm --filter @shotmap/ingest fixture out/catalogue/shotmap.sqlite)',
    async () => {
      const built = JSON.parse(await buildFixture()) as typeof fixture;
      expect(fixture.detail).toEqual(built.detail);
      expect(fixture.shots).toEqual(built.shots);
    },
  );

  it.skipIf(!existsSync(CATALOGUE_DB))(
    'names the release the whole catalogue builds',
    async () => {
      const built = JSON.parse(await buildFixture(CATALOGUE_DB)) as typeof fixture;
      expect(fixture.release).toBe(built.release);
      expect(text).toBe(await buildFixture(CATALOGUE_DB));
    },
  );
});
