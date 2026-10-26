import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { IndexFile } from '@shotmap/schema';
import type { LoadedMatch } from './match';
import { STATIC_PLAYER_BASE } from './static-source';

// MIGRATION.md steps 8 and 10, "done when": the loader gives the same data from either
// source. This runs the real loader twice, once on the static files in public/data and once
// on a running API (`wrangler dev` in CI, see .github/workflows/ci.yml), and compares them.
// The static files carry no player ids and no stage id, so those are the only differences
// allowed, and the player ids must still name the same player in both.
const API_URL = process.env.API_URL;
const files = (path: string): unknown =>
  JSON.parse(readFileSync(join('public', 'data', path), 'utf8'));

type Loader = typeof import('./load');

/** What the two sources must agree on. */
function comparable(match: LoadedMatch) {
  const { detail, shots } = match;
  return {
    detail: {
      ...detail,
      stage: detail.stage.name,
      players: detail.players.map((p) => ({
        name: p.name,
        side: p.side,
        team: p.team,
        shirt: p.shirt,
      })),
    },
    shots: shots.map((shot) => ({ ...shot, playerId: 0 })),
  };
}

/** Each shot's shooter as a place in the match's player list. */
const shooters = (match: LoadedMatch, base: number) =>
  match.shots.map((s) =>
    base === 0
      ? match.detail.players.findIndex((p) => p.id === s.playerId)
      : s.playerId - base,
  );

describe.skipIf(!API_URL)(
  `the static and api sources agree (${API_URL ?? 'no API_URL'})`,
  () => {
    const staticIndex = files('index.json') as IndexFile;
    let fromFiles: Loader;
    let fromApi: Loader;

    /** Call a loader with the build's source set to the one it belongs to. */
    const use = <T>(source: 'static' | 'api', call: () => T): T => {
      vi.stubEnv('VITE_DATA_SOURCE', source);
      return call();
    };

    beforeAll(async () => {
      const real = globalThis.fetch;
      // The static source asks for /data/..., the api source for API_URL/v1/...
      vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (!url.startsWith('/data/')) return real(input, init);
        return Promise.resolve(
          new Response(readFileSync(join('public', url), 'utf8'), {
            headers: { 'content-type': 'application/json' },
          }),
        );
      });
      vi.stubEnv('VITE_API_URL', API_URL ?? '');
      vi.resetModules();
      fromFiles = await import('./load');
      vi.resetModules();
      fromApi = await import('./load');
    });
    afterAll(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it('gives the same match list', async () => {
      const a = await use('api', () => fromApi.loadIndex());
      const s = await use('static', () => fromFiles.loadIndex());
      expect({ stages: a.stages, competitions: a.competitions }).toEqual({
        stages: s.stages,
        competitions: s.competitions,
      });
      expect(
        a.competitions.flatMap((c) => c.seasons.flatMap((x) => x.matches)),
      ).toHaveLength(149);
    });

    it('gives the same match and the same decoded shots for all 149 matches', async () => {
      const ids = staticIndex.competitions.flatMap((c) =>
        c.seasons.flatMap((s) => s.matches.map((row) => row[0])),
      );
      expect(ids).toHaveLength(149);
      let shots = 0;
      for (let from = 0; from < ids.length; from += 8) {
        await Promise.all(
          ids.slice(from, from + 8).map(async (id) => {
            const [a, s] = await Promise.all([
              use('api', () => fromApi.loadMatch(id)),
              use('static', () => fromFiles.loadMatch(id)),
            ]);
            expect(comparable(a), `match ${id}`).toEqual(comparable(s));
            expect(shooters(a, 0), `match ${id}: who shot`).toEqual(
              shooters(s, STATIC_PLAYER_BASE),
            );
            expect(a.detail.players.every((p) => p.id < STATIC_PLAYER_BASE)).toBe(true);
            shots += a.shots.length;
          }),
        );
      }
      expect(shots).toBe(3721);
    }, 180_000);
  },
);
