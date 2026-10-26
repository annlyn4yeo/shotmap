import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HERO_MATCH_ID, RELEASE_PATTERN } from '@shotmap/schema';
import { goldenDir } from '../../scripts/golden';
import { decodeMatch } from './match';
import { assertMatchDetail, assertShots } from './validate-api';

// The page is built with the hero match inlined (vite.config.ts), made from a committed
// fixture and never from a live API (MIGRATION.md R14). ingest's fixture.test.ts keeps that
// fixture equal to the database; these check the web side of it.
describe('the inlined hero seed', () => {
  const file = `final-${HERO_MATCH_ID}.api.json`;
  const fixture = JSON.parse(readFileSync(join(goldenDir(), file), 'utf8')) as {
    release: string;
    detail: unknown;
    shots: unknown;
  };

  it('is the hero match, with the release it was built from', () => {
    expect(fixture.release).toMatch(RELEASE_PATTERN);
    expect(assertMatchDetail(fixture.detail).id).toBe(HERO_MATCH_ID);
  });

  it('decodes with the strict decoder, which the loader uses on it', () => {
    const match = decodeMatch(
      assertMatchDetail(fixture.detail),
      assertShots(fixture.shots),
    );
    expect(match.shots).toHaveLength(38);
  });

  it('is the file the build reads', () => {
    // vite.config.ts cannot import the constant, so it names the file; they must agree.
    expect(readFileSync('vite.config.ts', 'utf8')).toContain(`../../docs/golden/${file}`);
  });
});
