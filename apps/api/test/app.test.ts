import { beforeEach, describe, expect, it } from 'vitest';
import {
  ATTRIBUTION,
  CACHE_CONTROL,
  LIMITS,
  QUERY_ALLOW,
  RELEASE_PATTERN,
  decodeShotsStrict,
} from '@shotmap/schema';
import {
  DensitySchema,
  ErrorSchema,
  MatchDetailSchema,
  MatchListSchema,
  MatchShotsSchema,
  MetaSchema,
  PlayerSchema,
  PlayerShotsSchema,
  SearchSchema,
  ROUTES,
  envelope,
} from '@shotmap/schema/zod';
import { createApp, type CacheLike, type Env } from '../src/app';
import { D1Shim, haveDb } from './d1-shim';

const FINAL = 3869685;

/** A Cache API stand-in: keyed by URL, like caches.default. */
function memoryCache(): CacheLike & { entries: Map<string, Response> } {
  const entries = new Map<string, Response>();
  return {
    entries,
    match: (request) => Promise.resolve(entries.get(request.url)?.clone()),
    put: (request, response) => {
      entries.set(request.url, response.clone());
      return Promise.resolve();
    },
  };
}

describe.skipIf(!haveDb)('the Worker', () => {
  const shim = new D1Shim();
  const env = (extra: Partial<Env> = {}): Env => ({ DB: shim.asD1(), ...extra });
  const BASE = 'https://api.test';
  let cache: ReturnType<typeof memoryCache>;
  let app: ReturnType<typeof createApp>;
  let release = '';

  const get = (path: string, init: RequestInit = {}, e: Env = env()) =>
    app.request(`${BASE}${path}`, init, e);
  const body = <T>(res: Response): Promise<T> => res.json<T>();

  beforeEach(async () => {
    cache = memoryCache();
    app = createApp({ cache });
    shim.reset();
    const meta = await get('/v1/meta');
    release = (await body<{ release: string }>(meta)).release;
    shim.reset();
  });

  describe('/v1/meta', () => {
    it('describes the release, with the headers every response carries', async () => {
      const res = await get('/v1/meta');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/^application\/json/);
      expect(res.headers.get('etag')).toMatch(
        /^"\d{4}-\d{2}-\d{2}\.[0-9a-f]{12}-[0-9a-f]{16}"$/,
      );
      expect(res.headers.get('cache-control')).toBe(CACHE_CONTROL.floating);
      expect(res.headers.get('x-data-release')).toMatch(RELEASE_PATTERN);
      const parsed = envelope(MetaSchema).parse(await res.json());
      expect(parsed.attribution).toEqual(ATTRIBUTION);
      expect(parsed.release).toBe(res.headers.get('x-data-release'));
      expect(parsed.data.counts.shots).toBe(3721);
    });
  });

  describe('/v1/players', () => {
    const MESSI = 5503;
    const profile = async (id = MESSI) => {
      const res = await get(`/v1/players/${id}`);
      expect(res.status).toBe(200);
      return envelope(PlayerSchema).parse(await res.json()).data;
    };
    const shots = async (query = '', id = MESSI) => {
      const res = await get(`/v1/players/${id}/shots${query ? `?${query}` : ''}`);
      expect(res.status, query).toBe(200);
      return envelope(PlayerShotsSchema).parse(await res.json()).data;
    };

    it('gives the profile: names, the teams, the career, and the season table that adds up to it', async () => {
      const messi = await profile();
      expect(messi.name).toBe('Lionel Messi');
      expect(messi.teams.map((t) => t.name).sort()).toEqual(['Argentina', 'Barcelona']);
      expect(messi.seasons.map((s) => `${s.competition.name} ${s.season.name}`)).toEqual([
        'La Liga 2018/2019',
        'FIFA World Cup 2022',
      ]);
      expect(messi.totals.matches).toBe(41);
      for (const key of ['matches', 'shots', 'goals', 'onTarget'] as const)
        expect(messi.seasons.reduce((n, s) => n + s[key], 0)).toBe(messi.totals[key]);
    });

    it('is a few statements however many seasons there are', async () => {
      shim.reset();
      await get(`/v1/players/${MESSI}`);
      expect(shim.statements.length).toBeLessThanOrEqual(5);
    });

    it('says there is no such player, for the profile, the shots and the density', async () => {
      for (const path of [
        '/v1/players/1',
        '/v1/players/1/shots',
        '/v1/players/1/density',
      ]) {
        const res = await get(path);
        expect(res.status, path).toBe(404);
        const { error } = ErrorSchema.parse(await res.json());
        expect(error.code).toBe('not_found');
        expect(error.message, 'it names what is missing').toBe('no such player');
      }
      expect((await get('/v1/players/abc')).status).toBe(400);
    });

    it('gives shots as columns with the match, sorted by match, and no more than were asked for', async () => {
      const all = await shots();
      expect(all.truncated).toBe(false);
      expect(new Set(all.cols.match).size).toBe(41);
      expect(all.cols.match).toEqual([...all.cols.match].sort((a, b) => a - b));
      expect(all.cols.player.every((p) => p === MESSI)).toBe(true);
      const few = await shots('limit=25');
      expect(few.n).toBe(25);
      expect(few.truncated).toBe(true);
      expect(few.cols.shot).toEqual(all.cols.shot.slice(0, 25));
      expect((await shots(`limit=${all.n}`)).truncated).toBe(false);
    });

    it('filters by competition and season, by period, outcome and shot type', async () => {
      const messi = await profile();
      const cup = messi.seasons.find((s) => s.competition.id === 43);
      const filtered = await shots(`competition=43&season=${cup?.season.id}&period=open`);
      expect(filtered.n).toBe(cup?.shots);
      expect(new Set(filtered.cols.match).size).toBe(cup?.matches);
      const goals = await shots('period=open&outcome=goal');
      expect(goals.n).toBe(messi.totals.goals);
      const penalties = await shots('type=88');
      expect(penalties.n).toBeGreaterThan(0);
      expect(penalties.cols.type.every((t) => t === 88)).toBe(true);
      expect((await shots('type=88,62,61,87')).n).toBe((await shots()).n);
    });

    it('refuses what it does not understand', async () => {
      for (const query of [
        'season=106',
        'competition=x',
        'period=sideways',
        'outcome=goal,nonsense',
        'outcome=',
        'type=999',
        'type=88,',
        'type=Penalty',
        'limit=0',
        'limit=-5',
        'limit=ten',
        'junk=1',
        'type=88&type=62',
      ]) {
        const res = await get(`/v1/players/${MESSI}/shots?${query}`);
        expect(res.status, query).toBe(400);
        expect(ErrorSchema.parse(await res.json()).error.code).toBe('bad_request');
      }
      expect((await get(`/v1/players/${MESSI}?period=open`)).status).toBe(400);
    });

    it('never gives more than the ceiling, however much is asked for, and binds the shot types', async () => {
      expect((await shots('limit=1000000')).n).toBeLessThanOrEqual(LIMITS.playerShotsMax);
      shim.reset();
      await shots('type=88,62');
      const query = shim.statements.find((s) => /FROM shots s/.test(s.sql));
      expect(query?.sql).toContain('s.type IN (?,?)');
      expect(query?.params).toEqual(expect.arrayContaining([88, 62]));
      expect(query?.sql).not.toMatch(/88|62/);
    });

    it('is immutable for the current release, and gone for another', async () => {
      for (const path of [
        `/v1/players/${MESSI}`,
        `/v1/players/${MESSI}/shots`,
        `/v1/players/${MESSI}/density`,
      ]) {
        const pinned = await get(`${path}?v=${release}`);
        expect(pinned.headers.get('cache-control'), path).toBe(CACHE_CONTROL.pinned);
        expect((await get(`${path}?v=r000000000000`)).status).toBe(410);
      }
    });

    describe('/density', () => {
      const density = async (query = '', id = MESSI) => {
        const res = await get(`/v1/players/${id}/density${query ? `?${query}` : ''}`);
        expect(res.status, query).toBe(200);
        return envelope(DensitySchema).parse(await res.json()).data;
      };
      const total = (column: readonly number[]) => column.reduce((a, b) => a + b, 0);

      it('counts every shot once at every size, in sparse columns ordered by cell', async () => {
        const open = await shots('period=open');
        for (const step of LIMITS.densitySteps) {
          const d = await density(`step=${step}&period=open`);
          expect(d.step).toBe(step);
          expect(total(d.n), `step ${step}`).toBe(open.n);
          expect(d.n.every((n) => n >= 1)).toBe(true);
          const cells = d.gx.map((gx, i) => gx * 1000 + (d.gy[i] ?? 0));
          expect(cells, 'ordered by gx then gy, none twice').toEqual(
            [...new Set(cells)].sort((a, b) => a - b),
          );
        }
        // A bigger bin can only merge cells.
        const fine = await density('step=1&period=open');
        const coarse = await density('step=10&period=open');
        expect(coarse.n.length).toBeLessThan(fine.n.length);
      });

      it('is two yards wide unless asked, and agrees with the profile on goals and xG', async () => {
        const d = await density('period=open');
        expect(d.step).toBe(2);
        const messi = await profile();
        expect(total(d.goals)).toBe(messi.totals.goals);
        expect(total(d.xg)).toBeCloseTo(messi.totals.xg, 2);
        // Every shot in a cell started in it, whichever team it was for.
        const open = await shots('period=open');
        const inCell = new Map<string, number>();
        for (let i = 0; i < open.n; i++) {
          const key = `${Math.trunc((open.cols.x[i] ?? 0) / 2)},${Math.trunc((open.cols.y[i] ?? 0) / 2)}`;
          inCell.set(key, (inCell.get(key) ?? 0) + 1);
        }
        expect(d.gx.map((gx, i) => [`${gx},${d.gy[i]}`, d.n[i]])).toEqual(
          [...inCell].sort(([a], [b]) => {
            const [ax = 0, ay = 0] = a.split(',').map(Number);
            const [bx = 0, by = 0] = b.split(',').map(Number);
            return ax - bx || ay - by;
          }),
        );
      });

      it('takes the filters of the shots', async () => {
        const messi = await profile();
        const cup = messi.seasons.find((s) => s.competition.id === 43);
        const one = await density(`competition=43&season=${cup?.season.id}&period=open`);
        expect(total(one.n)).toBe(cup?.shots);
        expect(total((await density('period=open&outcome=goal')).n)).toBe(
          messi.totals.goals,
        );
        const penalties = await density('type=88');
        expect(total(penalties.n)).toBe((await shots('type=88')).n);
        // Every filter at once is still one question.
        expect(
          total(
            (
              await density(
                `step=4&competition=43&season=${cup?.season.id}&outcome=goal,saved`,
              )
            ).n,
          ),
        ).toBeGreaterThan(0);
      });

      it('has no cells for a filter that matches nothing, which is not an error', async () => {
        const d = await density('period=shootout&outcome=post');
        expect(d.n).toEqual([]);
        expect(d.gx).toEqual([]);
      });

      it('refuses a size that is not on the list, and what it does not understand', async () => {
        for (const query of [
          'step=3',
          'step=0',
          'step=-2',
          'step=2.5',
          'step=x',
          'step=',
          'step=1000',
          'step=2&step=4',
          'season=106',
          'period=sideways',
          'outcome=nonsense',
          'type=999',
          'limit=10',
          'junk=1',
        ]) {
          const res = await get(`/v1/players/${MESSI}/density?${query}`);
          expect(res.status, query).toBe(400);
          expect(ErrorSchema.parse(await res.json()).error.code).toBe('bad_request');
        }
        expect((await get('/v1/players/abc/density')).status).toBe(400);
      });

      it('is one counting statement, binds its sizes, and joins matches only when asked to', async () => {
        shim.reset();
        await density('step=4');
        const plain = shim.statements.find((s) => /GROUP BY/.test(s.sql));
        expect(plain?.sql).toContain('CAST(s.x / ? AS INTEGER)');
        expect(plain?.sql).not.toMatch(/JOIN matches/);
        expect(plain?.params.slice(0, 2)).toEqual([4, 4]);
        expect(shim.statements.length).toBeLessThanOrEqual(2);
        shim.reset();
        await density('competition=43&season=106');
        expect(shim.statements.find((s) => /GROUP BY/.test(s.sql))?.sql).toContain(
          'JOIN matches m',
        );
      });
    });
  });

  describe('/v1/search', () => {
    const search = async (query: string) => {
      const res = await get(`/v1/search?${query}`);
      expect(res.status, query).toBe(200);
      return envelope(SearchSchema).parse(await res.json()).data;
    };
    const ids = (people: { id: number }[]) => people.map((p) => p.id);

    it('finds players, teams and matches by the start of every word, and says what it was asked', async () => {
      const arg = await search('q=argentina');
      expect(arg.q).toBe('argentina');
      expect(arg.teams.map((t) => t.name)).toContain('Argentina');
      expect(arg.matches.length).toBeGreaterThan(5);
      expect(ids((await search('q=argentina%20france%20final')).matches)).toEqual([
        FINAL,
      ]);
      expect(ids((await search('q=mes')).players)).toContain(5503);
      // Inside a word is not a match, by design (docs/adr/0006).
      expect((await search('q=essi')).players).toEqual([]);
    });

    it('folds accents and case the way ingest does, so the typed and the accented spelling agree', async () => {
      const typed = await search('q=angel%20di%20maria');
      const accented = await search(`q=${encodeURIComponent('Ángel Di María')}`);
      expect(typed.players).toHaveLength(1);
      expect(ids(accented.players)).toEqual(ids(typed.players));
      expect(ids((await search('q=philip%20foden')).players)).toEqual([4354]);
      expect(ids((await search('q=PHIL%20FOD')).players)).toEqual([4354]);
      // Real accented names in the data; each must find someone, the same people either way.
      for (const [plain, accented] of [
        ['mbappe', 'Mbappé'],
        ['ismaila sarr', 'Ismaïla Sarr'],
        ['nicolas otamendi', 'Nicolás Otamendi'],
      ] as const) {
        const a = await search(`q=${encodeURIComponent(plain)}`);
        const b = await search(`q=${encodeURIComponent(accented.toUpperCase())}`);
        expect(a.players.length, plain).toBeGreaterThan(0);
        expect(ids(b.players), accented).toEqual(ids(a.players));
      }
    });

    it('caps the results per kind, whatever limit is asked', async () => {
      const wide = await search('q=a&limit=1000');
      for (const list of [wide.players, wide.teams, wide.matches])
        expect(list.length).toBeLessThanOrEqual(LIMITS.searchPerKind);
      expect((await search('q=a&limit=2')).players).toHaveLength(2);
    });

    it('needs words to look for, and refuses anything it does not know', async () => {
      for (const query of [
        '',
        'q=',
        'q=%20%20',
        `q=${'x'.repeat(65)}`,
        'q=a&limit=0',
        'q=a&limit=-1',
        'q=a&junk=1',
        'q=a&q=b',
      ]) {
        const res = await get(`/v1/search?${query}`);
        expect(res.status, query).toBe(400);
        expect(ErrorSchema.parse(await res.json()).error.code).toBe('bad_request');
      }
    });

    it('binds what is typed, so a quote is only a character', async () => {
      const { players, teams, matches } = await search(
        `q=${encodeURIComponent("'; DROP TABLE shots; --")}`,
      );
      expect([players, teams, matches]).toEqual([[], [], []]);
      expect(shim.statements.length).toBeGreaterThan(0);
      for (const statement of shim.statements) {
        expect(statement.sql).not.toMatch(/DROP|--/i);
        expect(statement.params.join(' ')).toContain('drop');
      }
      const meta = envelope(MetaSchema).parse(await (await get('/v1/meta')).json());
      expect(meta.data.counts.shots).toBe(3721);
    });

    it('is immutable for the current release, and gone for another', async () => {
      const pinned = await get(`/v1/search?q=mes&v=${release}`);
      expect(pinned.headers.get('cache-control')).toBe(CACHE_CONTROL.pinned);
      expect(pinned.headers.get('etag')).toMatch(
        /^"\d{4}-\d{2}-\d{2}\.[0-9a-f]{12}-[0-9a-f]{16}"$/,
      );
      const stale = await get('/v1/search?q=mes&v=r000000000000');
      expect(stale.status).toBe(410);
    });
  });

  describe('/v1/matches', () => {
    it('pages through every match with the cursor, in date order', async () => {
      const seen: number[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: Response = await get(
          `/v1/matches?limit=50${cursor ? `&cursor=${cursor}` : ''}`,
        );
        const page = envelope(MatchListSchema).parse(await res.json()).data;
        seen.push(...page.items.map((m) => m.id));
        cursor = page.next;
        pages++;
      } while (cursor);
      expect(pages).toBe(3);
      expect(new Set(seen).size).toBe(149);
    });

    it('lists the latest matches first when asked, and says what it does not understand', async () => {
      const ids = async (query: string) =>
        envelope(MatchListSchema)
          .parse(await (await get(`/v1/matches?${query}`)).json())
          .data.items.map((m) => m.id);
      const oldest = await ids('limit=200');
      expect(await ids('order=oldest&limit=200')).toEqual(oldest);
      expect(await ids('order=newest&limit=200')).toEqual([...oldest].reverse());
      for (const bad of ['order=latest', 'order=', 'order=newest&order=oldest']) {
        const res = await get(`/v1/matches?${bad}`);
        expect(res.status, bad).toBe(400);
      }
    });

    it('filters by competition, season, stage, team and date', async () => {
      const list = async (query: string) =>
        envelope(MatchListSchema).parse(await (await get(`/v1/matches?${query}`)).json())
          .data.items;
      expect(await list('competition=43&season=106&limit=200')).toHaveLength(64);
      const argentina = await list('team=779&limit=200');
      expect(argentina.every((m) => m.home.id === 779 || m.away.id === 779)).toBe(true);
      expect((await list('from=2022-12-18&to=2022-12-18')).map((m) => m.id)).toEqual([
        FINAL,
      ]);
      expect((await list('stage=6&competition=43')).length).toBeGreaterThan(0);
    });

    it('caps the page whatever limit is asked, and rejects limits that are not numbers', async () => {
      const page = envelope(MatchListSchema).parse(
        await (await get('/v1/matches?limit=999999999')).json(),
      ).data;
      expect(page.items.length).toBeLessThanOrEqual(LIMITS.matchesPageMax);
      for (const bad of [
        'limit=0',
        'limit=-1',
        'limit=abc',
        'limit=1.5',
        'limit=1e3',
        'limit=1234567890',
      ]) {
        const res = await get(`/v1/matches?${bad}`);
        expect(res.status, bad).toBe(400);
        expect(ErrorSchema.parse(await res.json()).error.code).toBe('bad_request');
      }
    });

    it('rejects malformed dates, ids and cursors without touching the database', async () => {
      for (const bad of [
        'from=2022-13-45',
        'from=yesterday',
        'to=2022-1-1',
        'team=1;2',
        'competition=-1',
        'cursor=x',
        "cursor=1'; DROP TABLE shots;--",
      ]) {
        shim.reset();
        const res = await get(`/v1/matches?${bad}`);
        expect(res.status, bad).toBe(400);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(
          shim.statements.filter((s) => /matches m/.test(s.sql)),
          bad,
        ).toEqual([]);
      }
      shim.reset();
      expect((await get("/v1/matches?cursor=1'; DROP TABLE shots;--")).status).toBe(400);
      const meta = await get('/v1/meta');
      expect(envelope(MetaSchema).parse(await meta.json()).data.counts.shots).toBe(3721);
    });

    it('binds every value and never puts input into the SQL text', async () => {
      shim.reset();
      await get(
        '/v1/matches?competition=43&season=106&team=779&from=2022-11-20&to=2022-12-18&limit=7&cursor=2022-11-22_1300_3857262',
      );
      const list = shim.statements.find((s) => s.sql.includes('FROM matches m'));
      expect(list).toBeDefined();
      expect(list?.sql).not.toMatch(/\b(43|106|779|2022|3857262)\b/);
      expect(list?.sql).toContain('LIMIT ?');
      expect(list?.params).toEqual(
        expect.arrayContaining([43, 106, 779, '2022-11-20', '2022-12-18', 8]),
      );
    });
  });

  describe('/v1/matches/:id and /shots', () => {
    it('answers the final in the contract, and its shots decode', async () => {
      const detail = envelope(MatchDetailSchema).parse(
        await (await get(`/v1/matches/${FINAL}`)).json(),
      ).data;
      const shots = envelope(MatchShotsSchema).parse(
        await (await get(`/v1/matches/${FINAL}/shots`)).json(),
      ).data;
      expect(detail.teams.map((t) => [t.name, t.score, t.pens])).toEqual([
        ['Argentina', 3, 4],
        ['France', 3, 2],
      ]);
      expect(shots.n).toBe(38);
      const decoded = decodeShotsStrict(shots, {
        teams: new Map(detail.teams.map((t) => [t.id, t.name])),
        players: new Map(
          detail.players.map((p) => [
            p.id,
            { name: p.name, shirt: p.shirt, side: p.side },
          ]),
        ),
      });
      expect(decoded.filter((s) => s.outcome === 'goal' && !s.shootout)).toHaveLength(6);
    });

    it('answers every match in the contract', async () => {
      const list = envelope(MatchListSchema).parse(
        await (await get('/v1/matches?limit=200')).json(),
      ).data;
      expect(list.items).toHaveLength(149);
      for (const m of list.items) {
        envelope(MatchDetailSchema).parse(
          await (await get(`/v1/matches/${m.id}`)).json(),
        );
        envelope(MatchShotsSchema).parse(
          await (await get(`/v1/matches/${m.id}/shots`)).json(),
        );
      }
    });

    it('answers a missing match with a cacheable JSON 404, and a bad id with 400', async () => {
      for (const path of ['/v1/matches/1', '/v1/matches/1/shots']) {
        const res = await get(path);
        expect(res.status).toBe(404);
        expect(res.headers.get('content-type')).toMatch(/^application\/json/);
        expect(res.headers.get('cache-control')).toBe(CACHE_CONTROL.floating);
        const { error } = ErrorSchema.parse(await res.json());
        expect(error.code).toBe('not_found');
        expect(error.message).toBe('no such match');
      }
      for (const path of [
        '/v1/matches/abc',
        '/v1/matches/12345678901',
        '/v1/matches/1.5/shots',
        '/v1/matches/-3',
      ]) {
        const res = await get(path);
        expect(res.status, path).toBe(400);
        expect(res.headers.get('content-type')).toMatch(/^application\/json/);
      }
    });

    it('bounds what one request can return, at the design ceiling too', async () => {
      const list = await (await get('/v1/matches?limit=200')).text();
      const perMatch = list.length / 149;
      // 200 matches per page at this size per match, however many matches there are.
      expect(perMatch * LIMITS.matchesPageMax).toBeLessThan(80_000);
      const shots = await (await get(`/v1/matches/${FINAL}/shots`)).text();
      const perShot = shots.length / 38;
      // A match has under 1,000 shots (the cap in the query), so the payload is bounded.
      expect(perShot * LIMITS.matchShotsMax).toBeLessThan(150_000);
      const queries = shim.statements.filter((s) => /FROM shots/.test(s.sql));
      expect(queries.every((q) => /LIMIT \d+/.test(q.sql))).toBe(true);
    });
  });

  describe('release pinning, ETag and the cache', () => {
    it('makes an answer cacheable for a year when the request names the current release', async () => {
      const res = await get(`/v1/matches/${FINAL}?v=${release}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe(CACHE_CONTROL.pinned);
      expect(CACHE_CONTROL.pinned).toContain('immutable');
      expect(CACHE_CONTROL.pinned).toMatch(/max-age=31536000/);
    });

    it('answers 410 for another release, and 400 for something that is not one', async () => {
      const gone = await get('/v1/meta?v=2020-01-01.000000000000');
      expect(gone.status).toBe(410);
      expect(gone.headers.get('cache-control')).toBe('no-store');
      const err = ErrorSchema.parse(await gone.json());
      expect(err.error.code).toBe('release_gone');
      expect(err.error.message).toContain(release);
      expect((await get('/v1/meta?v=latest')).status).toBe(400);
      expect((await get('/v1/meta?v=2020-13-01.nothex')).status).toBe(400);
    });

    it('is a release that is gone, not a malformed one, when a page built before releases had dates asks', async () => {
      // `r` and 12 hex digits was the form until the release carried its date.
      const res = await get(`/v1/matches/${FINAL}?v=r2422edac0126`);
      expect(res.status).toBe(410);
      expect(ErrorSchema.parse(await res.json()).error.message).toContain(release);
    });

    it('names the release by its date and its content hash, and serves both parts in /v1/meta', async () => {
      expect(release).toMatch(/^\d{4}-\d{2}-\d{2}\.[0-9a-f]{12}$/);
      const meta = await (
        await get('/v1/meta')
      ).json<{
        release: string;
        data: { released: { date: string; hash: string } };
      }>();
      expect(`${meta.data.released.date}.${meta.data.released.hash}`).toBe(meta.release);
      expect(meta.release).toBe(release);
    });

    it('gives the same ETag with and without the pin, and 304s when it is sent back', async () => {
      const plain = await get(`/v1/matches/${FINAL}`);
      const pinned = await get(`/v1/matches/${FINAL}?v=${release}`);
      const etag = plain.headers.get('etag');
      expect(etag).toBe(pinned.headers.get('etag'));
      shim.reset();
      const again = await get(`/v1/matches/${FINAL}`, {
        headers: { 'if-none-match': etag ?? '' },
      });
      expect(again.status).toBe(304);
      expect(await again.text()).toBe('');
      expect(again.headers.get('etag')).toBe(etag);
      expect(shim.statements, 'a revalidation does not touch D1').toEqual([]);
      const stale = await get(`/v1/matches/${FINAL}`, {
        headers: { 'if-none-match': '"nope"' },
      });
      expect(stale.status).toBe(200);
      const weak = await get(`/v1/matches/${FINAL}`, {
        headers: { 'if-none-match': `W/${etag ?? ''}, "x"` },
      });
      expect(weak.status).toBe(304);
    });

    it('uses the Cache API: the second identical request never reaches D1', async () => {
      const first = await get('/v1/matches?competition=43&limit=5');
      expect(first.headers.get('x-cache')).toBe('MISS');
      shim.reset();
      const second = await get('/v1/matches?competition=43&limit=5');
      expect(second.headers.get('x-cache')).toBe('HIT');
      expect(await second.text()).toBe(await first.text());
      expect(shim.roundTrips).toBe(0);
      // The same question in another order is the same cache entry.
      const reordered = await get('/v1/matches?limit=5&competition=43');
      expect(reordered.headers.get('x-cache')).toBe('HIT'); // parameters are sorted into the key
    });

    it('caches 404s too, so probing ids is cheap', async () => {
      await get('/v1/matches/2');
      shim.reset();
      const again = await get('/v1/matches/2');
      expect(again.status).toBe(404);
      expect(again.headers.get('x-cache')).toBe('HIT');
      expect(shim.roundTrips).toBe(0);
    });

    it('never caches a 400', async () => {
      await get('/v1/matches?limit=abc');
      expect([...cache.entries.keys()].filter((k) => k.includes('limit=abc'))).toEqual(
        [],
      );
    });

    it('spends at most two D1 round trips on a cold request (the release is remembered)', async () => {
      shim.reset();
      await get(`/v1/matches/${FINAL}/shots`);
      expect(shim.roundTrips).toBe(1);
      const fresh = createApp();
      shim.reset();
      await fresh.request(`${BASE}/v1/matches/${FINAL}`, {}, env());
      expect(shim.roundTrips).toBe(2);
    });

    it('reads the release again after the isolate has held it for a minute', async () => {
      let clock = 1_000;
      const timed = createApp({ now: () => clock, releaseTtlMs: 60_000 });
      await timed.request(`${BASE}/v1/meta`, {}, env());
      shim.reset();
      await timed.request(`${BASE}/v1/matches/${FINAL}`, {}, env());
      const early = shim.roundTrips;
      clock += 61_000;
      shim.reset();
      await timed.request(`${BASE}/v1/matches/${FINAL}`, {}, env());
      expect(shim.roundTrips).toBe(early + 1);
    });
  });

  describe('abuse', () => {
    it('refuses any query parameter that is not on the allow-list, before D1 is asked', async () => {
      const stored = cache.entries.size;
      for (const junk of ['x=1', 'debug=true', 'v2=1', 'LIMIT=5', '__proto__=1']) {
        shim.reset();
        const res = await get(`/v1/meta?${junk}`);
        expect(res.status, junk).toBe(400);
        expect(shim.roundTrips, junk).toBe(0);
      }
      const dup = await get('/v1/matches?limit=1&limit=2');
      expect(dup.status).toBe(400);
      expect((await get(`/v1/matches/${FINAL}?limit=5`)).status).toBe(400);
      expect(cache.entries.size, 'junk parameters mint no cache entries').toBe(stored);
    });

    it('allows exactly the parameters in the contract', () => {
      for (const route of ROUTES.filter((r) => r.status === 'live')) {
        const allowed = [...QUERY_ALLOW[route.id as keyof typeof QUERY_ALLOW]].sort();
        expect(Object.keys(route.query?.shape ?? {}).sort(), route.id).toEqual(allowed);
      }
    });

    it('answers every unknown path under /v1 with JSON, never HTML', async () => {
      for (const path of [
        '/v1',
        '/v1/',
        '/v1/nope',
        '/v1/matches/',
        '/v1/matches/1/2/3',
        '/v1/compare',
        '/v1/%00',
      ]) {
        const res = await get(path);
        expect(res.status, path).toBe(404);
        expect(res.headers.get('content-type'), path).toMatch(/^application\/json/);
        expect(ErrorSchema.parse(await res.json()).error.code).toBe('not_found');
      }
      const elsewhere = await get('/index.html');
      expect(elsewhere.status).toBe(404);
      expect(elsewhere.headers.get('content-type')).toMatch(/^application\/json/);
    });

    it('is GET only', async () => {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const res = await get('/v1/matches', { method });
        expect(res.status, method).toBe(405);
        expect(res.headers.get('allow')).toBe('GET, HEAD');
        expect(ErrorSchema.parse(await res.json()).error.code).toBe('method_not_allowed');
      }
      const head = await get('/v1/meta', { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe('');
    });

    it('never leaks internals when D1 fails', async () => {
      const broken = createApp({
        db: () => ({
          all: () => Promise.reject(new Error('D1_ERROR: no such table: secrets')),
          batch: () => Promise.reject(new Error('D1_ERROR: no such table: secrets')),
        }),
      });
      const res = await broken.request(`${BASE}/v1/meta`, {}, env());
      expect(res.status).toBe(500);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const text = await res.text();
      expect(text).not.toContain('secrets');
      expect(ErrorSchema.parse(JSON.parse(text)).error.code).toBe('internal');
    });
  });

  describe('CORS (the workers.dev fallback)', () => {
    it('names the web origin when WEB_ORIGIN is set, and stays same-origin when it is not', async () => {
      // A fresh app and cache: a cached answer keeps the headers it was stored with, and the origin is fixed per deployment.
      app = createApp({ cache: memoryCache() });
      const withOrigin = await get(
        '/v1/meta',
        {},
        env({ WEB_ORIGIN: 'https://shotmap.pages.dev' }),
      );
      expect(withOrigin.headers.get('access-control-allow-origin')).toBe(
        'https://shotmap.pages.dev',
      );
      app = createApp({ cache: memoryCache() });
      const without = await get('/v1/meta');
      expect(without.headers.get('access-control-allow-origin')).toBeNull();
      app = createApp({ cache: memoryCache() });
      const error = await get(
        '/v1/nope',
        {},
        env({ WEB_ORIGIN: 'https://shotmap.pages.dev' }),
      );
      expect(error.headers.get('access-control-allow-origin')).toBe(
        'https://shotmap.pages.dev',
      );
    });
  });
});
