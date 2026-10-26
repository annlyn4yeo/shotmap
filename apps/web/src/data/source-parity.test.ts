import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { IndexFile, MatchFile } from '@shotmap/schema';
import { decodeShots } from './shots';

// MIGRATION.md step 8, "done when": the loader gives the same data from either source. This
// runs the real loader, with the api source pointed at a running API (`wrangler dev` in CI,
// see .github/workflows/ci.yml), against the static files in public/data.
const API_URL = process.env.API_URL;
const read = (path: string): unknown =>
  JSON.parse(readFileSync(join('public', 'data', path), 'utf8'));

describe.skipIf(!API_URL)(
  `the static and api sources agree (${API_URL ?? 'no API_URL'})`,
  () => {
    const staticIndex = read('index.json') as IndexFile;
    let api: typeof import('./load');

    beforeAll(async () => {
      vi.resetModules();
      vi.stubEnv('VITE_DATA_SOURCE', 'api');
      vi.stubEnv('VITE_API_URL', API_URL ?? '');
      api = await import('./load');
    });
    afterAll(() => {
      vi.unstubAllEnvs();
    });

    it('gives the same index', async () => {
      expect(await api.loadIndex()).toEqual(staticIndex);
    });

    it('gives the same match files, and the same decoded shots, for all 149 matches', async () => {
      const ids = staticIndex.competitions.flatMap((c) =>
        c.seasons.flatMap((s) => s.matches.map((row) => row[0])),
      );
      expect(ids).toHaveLength(149);
      let shots = 0;
      for (let from = 0; from < ids.length; from += 8) {
        await Promise.all(
          ids.slice(from, from + 8).map(async (id) => {
            const fromApi = await api.loadMatch(id);
            const fromFile = read(`matches/${id}.json`) as MatchFile;
            expect(fromApi, `match ${id}`).toEqual(fromFile);
            const decoded = decodeShots(fromApi, staticIndex.enums);
            expect(decoded, `match ${id}`).toEqual(
              decodeShots(fromFile, staticIndex.enums),
            );
            shots += decoded.length;
          }),
        );
      }
      expect(shots).toBe(3721);
    }, 180_000);
  },
);
