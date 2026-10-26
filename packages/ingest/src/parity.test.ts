import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENUMS, RELEASE_PATTERN, decodeShotsStrict } from '@shotmap/schema';
import type {
  IndexFile,
  MatchDetail,
  MatchFile,
  MatchList,
  MatchShots,
  Meta,
} from '@shotmap/schema';
import {
  ErrorSchema,
  MatchDetailSchema,
  MatchListSchema,
  MatchShotsSchema,
  MetaSchema,
  envelope,
} from '@shotmap/schema/zod';
import {
  exportMatch,
  exportMatchList,
  exportMatchShots,
  exportMeta,
  releaseOf,
  type MatchQuery,
} from '@shotmap/queries';
// The legacy decoder is the oracle: the web app's own, with its defaults.
import { decodeShots } from '../../../apps/web/src/data/shots';
import { openDb } from './sqlite-db';
import { DB_PATH, LEGACY, haveDb } from './testdb';

const read = (path: string): unknown =>
  JSON.parse(readFileSync(join(LEGACY, path), 'utf8'));
const index = read('index.json') as IndexFile;
const rows = index.competitions.flatMap((c) => c.seasons.flatMap((s) => s.matches));
const FIXTURE = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'docs',
  'golden',
  'final-3869685.json',
);

/** Where the answers come from: the database directly, or a running API (a Worker, locally or on staging). */
interface Source {
  release(): Promise<string>;
  meta(): Promise<Meta>;
  match(id: number): Promise<MatchDetail | undefined>;
  shots(id: number): Promise<MatchShots | undefined>;
  list(q: MatchQuery): Promise<MatchList>;
}

function databaseSource(): Source {
  const db = openDb(DB_PATH);
  return {
    release: () => releaseOf(db),
    meta: () => exportMeta(db),
    match: (id) => exportMatch(db, id),
    shots: (id) => exportMatchShots(db, id),
    list: (q) => exportMatchList(db, q),
  };
}

/** HTTP, the way the web app will call it: pinned to the release, content type checked. */
function httpSource(base: string): Source {
  let pin: Promise<string> | undefined;
  const get = async <T>(
    path: string,
    schema: { parse(v: unknown): { release: string; data: T } },
    pinned = true,
  ) => {
    const query = (pinned ? [`v=${await release()}`] : []).concat(
      path.includes('?') ? [] : [],
    );
    const url = `${base}${path}${path.includes('?') ? '&' : '?'}${query.join('&')}`;
    const res = await fetch(url);
    expect(res.headers.get('content-type'), url).toMatch(/^application\/json/);
    if (res.status === 404) {
      ErrorSchema.parse(await res.json());
      return undefined;
    }
    expect(res.status, url).toBe(200);
    const body = schema.parse(await res.json());
    // The Worker sends a strong ETag naming the release. Cloudflare's edge makes it weak
    // (W/"...") when it compresses the body, which a revalidating client still matches.
    const etag = (res.headers.get('etag') ?? '').replace(/^W\//, '');
    expect(etag, url).toMatch(/^"r[0-9a-f]{12}-[0-9a-f]{16}"$/);
    expect(etag.startsWith(`"${body.release}-`), url).toBe(true);
    expect(res.headers.get('cache-control'), url).toContain(
      pinned ? 'immutable' : 's-maxage',
    );
    expect(res.headers.get('x-data-release'), url).toBe(body.release);
    return body.data;
  };
  const release = (): Promise<string> =>
    (pin ??= fetch(`${base}/v1/meta`)
      .then((r) => r.json() as Promise<{ release: string }>)
      .then((b) => {
        expect(b.release).toMatch(RELEASE_PATTERN);
        return b.release;
      }));
  return {
    release,
    meta: async () => (await get('/v1/meta', envelope(MetaSchema), false)) as Meta,
    match: (id) => get(`/v1/matches/${id}`, envelope(MatchDetailSchema)),
    shots: (id) => get(`/v1/matches/${id}/shots`, envelope(MatchShotsSchema)),
    list: async (q) => {
      const params = Object.entries(q).map(
        ([k, v]) => `${k}=${encodeURIComponent(String(v))}`,
      );
      return (await get(
        `/v1/matches?${params.join('&')}`,
        envelope(MatchListSchema),
      )) as MatchList;
    },
  };
}

/**
 * The safety net of the migration. For every match, the static file decoded the old way
 * must equal the API's answer in the new columnar shape decoded the strict way, once player
 * ids are mapped to the file's local indices. The same checks run against the database
 * (always, in CI), and against a running Worker when API_URL is set: wrangler dev
 * locally, or staging. When the web app moves to the API, this proves nothing on screen changes.
 */
const sources: [string, () => Source][] = [];
if (haveDb) sources.push(['database', databaseSource]);
if (process.env.API_URL)
  sources.push([
    `API at ${process.env.API_URL}`,
    () => httpSource(process.env.API_URL as string),
  ]);

describe.skipIf(sources.length === 0)('parity: static files against the answers', () => {
  it('covers all 149 matches', () => {
    expect(rows).toHaveLength(149);
  });

  it('uses the same enums as the static legend', () => {
    for (const kind of ['outcome', 'bodyPart', 'shotType', 'technique'] as const)
      expect(ENUMS[kind]).toEqual(index.enums[kind]);
  });

  describe.each(sources)('%s', (_name, make) => {
    const source = make();

    it.each(rows.map((r) => [r[0], `${r[2]} v ${r[3]}`] as const))(
      'match %i (%s): decoded shots, players and header are equal',
      async (id) => {
        const legacy = read(`matches/${id}.json`) as MatchFile;
        const legacyShots = decodeShots(legacy, index.enums);

        const detail = await source.match(id);
        const payload = await source.shots(id);
        expect(detail, 'the match exists').toBeDefined();
        expect(payload, 'its shots exist').toBeDefined();
        if (!detail || !payload) return;

        const strict = decodeShotsStrict(payload, {
          teams: new Map(detail.teams.map((t) => [t.id, t.name])),
          players: new Map(
            detail.players.map((p) => [
              p.id,
              { name: p.name, shirt: p.shirt, side: p.side },
            ]),
          ),
        });

        // Player ids -> the static file's local indices (the players list is in first-shot order).
        const local = new Map(detail.players.map((p, i) => [p.id, i]));
        const fromApi = strict.map(({ shotId, teamId, playerId, matchId, ...shot }) => {
          expect(matchId).toBeNull();
          expect(shotId).toBe(id * 1000 + shot.id);
          expect(teamId).toBe(legacy.meta.teams[shot.team].id);
          return { ...shot, playerIdx: local.get(playerId) };
        });
        expect(fromApi).toEqual(legacyShots);

        // The players list, and the header.
        expect(detail.players.map((p) => [p.name, p.side, p.shirt])).toEqual(
          legacy.players,
        );
        const { teams, competition, season, stage } = legacy.meta;
        expect(detail).toMatchObject({
          id,
          date: legacy.meta.date,
          kickoff: legacy.meta.kickoff,
          competition,
          season,
          stage: { name: stage },
          teams,
        });
      },
      30_000,
    );

    it('lists every season of the index in the same order, with the same rows', async () => {
      const meta = await source.meta();
      expect(meta.competitions.map((c) => [c.id, c.name])).toEqual(
        index.competitions.map((c) => [c.id, c.name]),
      );
      expect(meta.stages.map((s) => s.name)).toEqual(index.stages);
      expect(meta.counts.matches).toBe(149);
      for (const c of index.competitions) {
        for (const s of c.seasons) {
          const page = await source.list({ competition: c.id, season: s.id, limit: 200 });
          const asRows = page.items.map((m) => [
            m.id,
            m.date,
            m.home.name,
            m.away.name,
            m.home.score,
            m.away.score,
            m.stage,
            m.home.pens,
            m.away.pens,
          ]);
          expect(asRows, `${c.name} ${s.name}`).toEqual(s.matches);
        }
      }
    }, 30_000);

    it('pages through the whole list with the cursor', async () => {
      const seen: number[] = [];
      let cursor: string | undefined;
      do {
        const page = await source.list({ limit: 50, ...(cursor ? { cursor } : {}) });
        expect(page.items.length).toBeLessThanOrEqual(50);
        seen.push(...page.items.map((m) => m.id));
        cursor = page.next ?? undefined;
      } while (cursor);
      expect(new Set(seen).size).toBe(149);
    }, 30_000);

    it("serves the final's shots exactly as the committed fixture has them", async () => {
      const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as MatchFile;
      const detail = await source.match(fixture.meta.id);
      const payload = await source.shots(fixture.meta.id);
      expect(detail && payload).toBeTruthy();
      if (!detail || !payload) return;
      const strict = decodeShotsStrict(payload, {
        teams: new Map(detail.teams.map((t) => [t.id, t.name])),
        players: new Map(
          detail.players.map((p) => [
            p.id,
            { name: p.name, shirt: p.shirt, side: p.side },
          ]),
        ),
      });
      const local = new Map(detail.players.map((p, i) => [p.id, i]));
      const decoded = strict.map(({ shotId, teamId, playerId, matchId, ...shot }) => {
        expect(shotId).toBe(fixture.meta.id * 1000 + shot.id);
        expect(teamId).toBe(fixture.meta.teams[shot.team].id);
        expect(matchId).toBeNull();
        return { ...shot, playerIdx: local.get(playerId) };
      });
      expect(decoded).toEqual(decodeShots(fixture, index.enums));
      expect(strict).toHaveLength(
        fixture.shots.x.length + (fixture.shootout?.x.length ?? 0),
      );
    }, 30_000);
  });
});
