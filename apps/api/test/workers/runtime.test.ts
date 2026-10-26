import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { ATTRIBUTION, CACHE_CONTROL, decodeShotsStrict } from '@shotmap/schema';
import {
  ErrorSchema,
  MatchDetailSchema,
  MatchListSchema,
  MatchShotsSchema,
  MetaSchema,
  envelope,
} from '@shotmap/schema/zod';
// The same SQL dump that gets loaded into staging D1.
import dump from '../../../../packages/ingest/out/shotmap.sql?raw';
import { splitDump } from './split-dump';

const worker = exports as unknown as {
  default: { fetch(request: Request): Promise<Response> };
};
const get = (path: string, init?: RequestInit) =>
  worker.default.fetch(new Request(`https://api.test${path}`, init));
const FINAL = 3869685;

describe('the Worker inside workerd, on a real D1', () => {
  beforeAll(async () => {
    // Statement by statement, as `wrangler d1 execute --file` would: this is the dump
    // meeting D1's own SQL engine (PRAGMA, DROP IF EXISTS, WITHOUT ROWID, CHECK, indexes).
    for (const statement of splitDump(dump)) await env.DB.prepare(statement).run();
  });

  it('loaded the whole release', async () => {
    const counts = await env.DB.prepare(
      'SELECT (SELECT COUNT(*) FROM shots) AS shots, (SELECT COUNT(*) FROM matches) AS matches, (SELECT COUNT(*) FROM players) AS players',
    ).first<{ shots: number; matches: number; players: number }>();
    expect(counts).toEqual({ shots: 3721, matches: 149, players: 843 });
    const fk = await env.DB.prepare('PRAGMA foreign_key_check').all();
    expect(fk.results).toEqual([]);
  });

  it('serves /v1/meta with the contract headers', async () => {
    const res = await get('/v1/meta');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('cache-control')).toBe(CACHE_CONTROL.floating);
    expect(res.headers.get('etag')).toMatch(/^"r[0-9a-f]{12}-[0-9a-f]{16}"$/);
    const body = envelope(MetaSchema).parse(await res.json());
    expect(body.attribution).toEqual(ATTRIBUTION);
    expect(body.data.counts.shots).toBe(3721);
    expect(res.headers.get('x-data-release')).toBe(body.release);
  });

  it('serves the final: detail, shots, and a page of matches', async () => {
    const detail = envelope(MatchDetailSchema).parse(
      await (await get(`/v1/matches/${FINAL}`)).json(),
    ).data;
    const shots = envelope(MatchShotsSchema).parse(
      await (await get(`/v1/matches/${FINAL}/shots`)).json(),
    ).data;
    expect(detail.teams.map((t) => t.name)).toEqual(['Argentina', 'France']);
    const decoded = decodeShotsStrict(shots, {
      teams: new Map(detail.teams.map((t) => [t.id, t.name])),
      players: new Map(
        detail.players.map((p) => [p.id, { name: p.name, shirt: p.shirt, side: p.side }]),
      ),
    });
    expect(decoded).toHaveLength(38);
    const page = envelope(MatchListSchema).parse(
      await (await get('/v1/matches?competition=43&season=106&limit=200')).json(),
    ).data;
    expect(page.items).toHaveLength(64);
  });

  it('uses the real Cache API: the second request is a hit, and a revalidation is a 304', async () => {
    const first = await get('/v1/matches?limit=7');
    expect(first.headers.get('x-cache')).toBe('MISS');
    await first.arrayBuffer();
    await new Promise((resolve) => setTimeout(resolve, 50)); // waitUntil(cache.put) settles
    const second = await get('/v1/matches?limit=7');
    expect(second.headers.get('x-cache')).toBe('HIT');
    const etag = second.headers.get('etag') ?? '';
    const revalidated = await get('/v1/matches?limit=7', {
      headers: { 'if-none-match': etag },
    });
    expect(revalidated.status).toBe(304);
  });

  it('answers 410 for another release and 400 for a parameter it does not know', async () => {
    expect((await get('/v1/meta?v=r000000000000')).status).toBe(410);
    expect((await get('/v1/meta?debug=1')).status).toBe(400);
  });

  it('never answers /v1 with HTML', async () => {
    for (const path of ['/v1/nope', '/v1/players/5503', '/v1/matches/abc']) {
      const res = await get(path);
      expect(res.headers.get('content-type'), path).toMatch(/^application\/json/);
      expect(ErrorSchema.parse(await res.json()).error.message).toBeTruthy();
    }
    expect((await get('/v1/matches', { method: 'DELETE' })).status).toBe(405);
  });

  it('asks D1 for a bounded number of rows (EXPLAIN uses the indexes)', async () => {
    const plan = await env.DB.prepare(
      'EXPLAIN QUERY PLAN SELECT * FROM shots WHERE match_id = ? ORDER BY seq LIMIT 1001',
    )
      .bind(FINAL)
      .all<{ detail: string }>();
    expect(plan.results.map((r) => r.detail).join(' ')).toContain('shots_match_seq');
  });
});
