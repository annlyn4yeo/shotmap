import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { HERO_MATCH_ID } from '@shotmap/schema';
import { RELEASE, detailOf, fakeApi, jsonResponse, shotsOf } from './fakes';
import type { Catalog } from './match';
import { STATIC_PLAYER_BASE } from './static-source';
import { fakeStatic } from './static-fakes';

/** The match list, reduced to what `nextMatchId` reads: three matches of one season. */
const index = {
  stages: ['Final'],
  competitions: [
    {
      id: 1,
      name: 'Cup',
      seasons: [
        {
          id: 1,
          name: '2022',
          matches: [
            [10, '2022-01-01'],
            [11, '2022-01-02'],
            [12, '2022-01-03'],
          ],
        },
      ],
    },
  ],
} as unknown as Catalog;

const IDS = [HERO_MATCH_ID, 10, 11, 12];

/** What the network looks like for each source: the same matches, served its own way. */
const SOURCES = {
  static: {
    env: 'static',
    serve: fakeStatic(IDS),
    unavailable: () =>
      Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }),
    indexUrls: ['/data/index.json'],
    matchUrls: (id: number) => [`/data/matches/${id}.json`],
  },
  api: {
    env: 'api',
    serve: fakeApi(IDS),
    unavailable: () => Promise.resolve(jsonResponse(null, 503)),
    indexUrls: ['/v1/meta', '/v1/matches?limit=200'],
    matchUrls: (id: number) => [`/v1/matches/${id}`, `/v1/matches/${id}/shots`],
  },
} as const;

/** The release pin is the client's business, not what these tests are about. */
const urlsOf = (mock: Mock) =>
  mock.mock.calls.map((c) => String(c[0]).replace(/[?&]v=r[0-9a-f]{12}/, ''));

let fetchMock: Mock<(url: string) => Promise<unknown>>;

/** A fresh module each time, so the in-memory cache starts empty. */
const load = () => import('./load');

beforeEach(() => {
  vi.resetModules();
  fetchMock = vi.fn<(url: string) => Promise<unknown>>();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe.each(Object.entries(SOURCES))('loader, %s source', (_name, source) => {
  beforeEach(() => {
    vi.stubEnv('VITE_DATA_SOURCE', source.env);
    fetchMock.mockImplementation(source.serve);
  });

  it('shares one request between concurrent callers, then serves from memory', async () => {
    const { loadMatch } = await load();

    const [a, b] = await Promise.all([loadMatch(10), loadMatch(10)]);
    const c = await loadMatch(10);

    expect(urlsOf(fetchMock).sort()).toEqual([...source.matchUrls(10)].sort());
    expect(a).toBe(b);
    expect(c).toBe(a);
  });

  it('gives a match as who played and every shot, decoded', async () => {
    const { loadMatch, readMatch } = await load();
    expect(readMatch(10)).toBeUndefined();

    const match = await loadMatch(10);

    expect(readMatch(10)).toBe(match);
    expect(match.detail.id).toBe(10);
    expect(match.detail.teams.map((t) => t.name)).toEqual(['Argentina', 'France']);
    expect(match.shots).toHaveLength(38);
    expect(match.shots.filter((s) => s.shootout).every((s) => s.period === 5)).toBe(true);
    expect(match.shots.map((s) => s.id)).toEqual(match.shots.map((_, at) => at));
    expect(match.shots.every((s) => s.shotId === 10 * 1000 + s.id)).toBe(true);
    const names = new Map(match.detail.players.map((p) => [p.id, p.name]));
    expect(match.shots.every((s) => names.get(s.playerId) === s.player)).toBe(true);
  });

  it('does not cache a failure', async () => {
    fetchMock.mockImplementationOnce(source.unavailable);
    const { loadMatch } = await load();

    await expect(loadMatch(10)).rejects.toThrow();
    const asked = fetchMock.mock.calls.length;
    await expect(loadMatch(10)).resolves.toBeTruthy();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(asked);
  });

  it('finds the next match in a season', async () => {
    const { nextMatchId } = await load();
    expect(nextMatchId(index, 10)).toBe(11);
    expect(nextMatchId(index, 12)).toBeUndefined();
    expect(nextMatchId(index, 999)).toBeUndefined();
  });

  it('reports a match the source does not have', async () => {
    const { loadMatch } = await load();
    await expect(loadMatch(777)).rejects.toThrow();
  });

  it('gives the match list as competitions, seasons and rows', async () => {
    const { loadIndex } = await load();
    const list = await loadIndex();
    expect(list.stages).toEqual(['Final']);
    expect(list.competitions[0]?.seasons[0]?.matches.map((row) => row[0])).toEqual(IDS);
  });

  describe('prefetch', () => {
    it('fetches only the next match, and only once the browser is idle', async () => {
      let idle: (() => void) | undefined;
      vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
        idle = cb;
        return 1;
      });
      const { prefetchNextMatch } = await load();

      prefetchNextMatch(10);
      await vi.waitFor(() => expect(idle).toBeDefined());
      expect(urlsOf(fetchMock).sort()).toEqual([...source.indexUrls].sort());

      idle?.();
      await vi.waitFor(() =>
        expect(fetchMock).toHaveBeenCalledTimes(
          source.indexUrls.length + source.matchUrls(11).length,
        ),
      );
      expect(urlsOf(fetchMock).slice(source.indexUrls.length).sort()).toEqual(
        [...source.matchUrls(11)].sort(),
      );
    });

    it('does nothing on the last match of a season', async () => {
      const idle = vi.fn();
      vi.stubGlobal('requestIdleCallback', idle);
      const { prefetchNextMatch } = await load();

      prefetchNextMatch(12);
      await vi.waitFor(() =>
        expect(fetchMock).toHaveBeenCalledTimes(source.indexUrls.length),
      );
      await Promise.resolve();
      expect(idle).not.toHaveBeenCalled();
    });

    it('stays quiet when the user has asked to save data', async () => {
      vi.stubGlobal('navigator', { connection: { saveData: true } });
      const { prefetchNextMatch, whenIdleUnlessSavingData } = await load();
      const task = vi.fn();

      prefetchNextMatch(10);
      whenIdleUnlessSavingData(task);
      await Promise.resolve();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(task).not.toHaveBeenCalled();
    });

    it('runs the match-list load when idle, otherwise', async () => {
      let idle: (() => void) | undefined;
      vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
        idle = cb;
        return 1;
      });
      const { whenIdleUnlessSavingData } = await load();
      const task = vi.fn();

      whenIdleUnlessSavingData(task);
      expect(task).not.toHaveBeenCalled();
      idle?.();
      expect(task).toHaveBeenCalledOnce();
    });
  });

  describe('seed', () => {
    it('serves the inlined hero without a request, and no list', async () => {
      vi.stubGlobal('document', {
        getElementById: () => ({
          textContent: JSON.stringify({
            release: RELEASE,
            detail: detailOf(HERO_MATCH_ID),
            shots: shotsOf(HERO_MATCH_ID),
          }),
        }),
      });
      const { seedFromDocument, loadMatch, readIndex, readMatch } = await load();

      seedFromDocument();

      const seeded = readMatch(HERO_MATCH_ID);
      expect(seeded?.detail.id).toBe(HERO_MATCH_ID);
      expect(seeded?.shots).toHaveLength(38);
      expect(readIndex()).toBeUndefined();
      await expect(loadMatch(HERO_MATCH_ID)).resolves.toBe(seeded);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('ignores a seed that does not decode, and fetches the match as usual', async () => {
      const shots = shotsOf(HERO_MATCH_ID);
      vi.stubGlobal('document', {
        getElementById: () => ({
          textContent: JSON.stringify({
            detail: detailOf(HERO_MATCH_ID),
            shots: {
              ...shots,
              cols: { ...shots.cols, out: shots.cols.out.map(() => 9999) },
            },
          }),
        }),
      });
      const { seedFromDocument, readMatch, loadMatch } = await load();

      seedFromDocument();
      expect(readMatch(HERO_MATCH_ID)).toBeUndefined();
      await loadMatch(HERO_MATCH_ID);
      expect(fetchMock).toHaveBeenCalled();
    });
  });
});

describe('the static source', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DATA_SOURCE', 'static');
    fetchMock.mockImplementation(fakeStatic(IDS));
  });

  it('stands in a player id the files do not carry, from the place in the player list', async () => {
    const { loadMatch } = await load();
    const match = await loadMatch(10);
    expect(match.detail.players.map((p) => p.id)).toEqual(
      match.detail.players.map((_, at) => STATIC_PLAYER_BASE + at),
    );
    expect(match.shots.every((s) => s.playerId >= STATIC_PLAYER_BASE)).toBe(true);
  });
});

describe('the api source', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DATA_SOURCE', 'api');
    fetchMock.mockImplementation(fakeApi(IDS));
  });

  it('keeps the global ids the API gives, and the position of each shot in its match', async () => {
    const { loadMatch } = await load();
    const match = await loadMatch(11);
    expect(match.shots.every((s) => s.matchId === null)).toBe(true);
    expect(match.shots.map((s) => s.shotId)).toEqual(shotsOf(11).cols.shot);
    expect(match.detail.players.every((p) => p.id < STATIC_PLAYER_BASE)).toBe(true);
    expect(match.shots.map((s) => s.playerId)).toEqual(shotsOf(11).cols.player);
  });

  it('pins its requests to the release it has learnt', async () => {
    const { loadIndex, loadMatch } = await load();
    await loadIndex();
    await loadMatch(10);
    const lastTwo = fetchMock.mock.calls.slice(-2).map((c) => c[0]);
    expect(lastTwo.every((u) => u.includes('v=r'))).toBe(true);
  });

  it('pins even its first request when the page was seeded with a release', async () => {
    vi.stubGlobal('document', {
      getElementById: () => ({
        textContent: JSON.stringify({
          release: RELEASE,
          detail: detailOf(HERO_MATCH_ID),
          shots: shotsOf(HERO_MATCH_ID),
        }),
      }),
    });
    const { seedFromDocument, loadMatch } = await load();
    seedFromDocument();
    await loadMatch(10);
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual([
      `/v1/matches/10/shots?v=${RELEASE}`,
      `/v1/matches/10?v=${RELEASE}`,
    ]);
  });

  it('refuses a payload that does not decode, instead of drawing it', async () => {
    fetchMock.mockImplementation((url: string) => {
      const answer = fakeApi([10])(url);
      if (!url.endsWith('/shots')) return answer;
      return answer.then(async (res) => {
        const body = (await res.json()) as { data: { cols: { out: number[] } } };
        body.data.cols.out[0] = 9999; // an outcome id nobody has heard of
        return jsonResponse(body.data);
      });
    });
    const { loadMatch } = await load();
    await expect(loadMatch(10)).rejects.toThrow(/unknown outcome id 9999/);
  });

  it('refuses a shooter who is not in the match', async () => {
    fetchMock.mockImplementation((url: string) => {
      const answer = fakeApi([10])(url);
      if (!url.endsWith('/shots')) return answer;
      return answer.then(async (res) => {
        const body = (await res.json()) as { data: { cols: { player: number[] } } };
        body.data.cols.player[0] = 1;
        return jsonResponse(body.data);
      });
    });
    const { loadMatch } = await load();
    await expect(loadMatch(10)).rejects.toThrow(/unknown player id 1/);
  });

  it('refuses a /v1 route that fell through to HTML', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse('<!doctype html>', 200, 'text/html')),
    );
    const { loadMatch } = await load();
    await expect(loadMatch(10)).rejects.toThrow(/not JSON/);
  });
});

describe('choosing the source', () => {
  it('is the api unless the build says static', async () => {
    const { dataSource } = await load();
    expect(dataSource()).toBe('api');
    vi.stubEnv('VITE_DATA_SOURCE', 'static');
    expect(dataSource()).toBe('static');
  });

  it('honours ?data= only on a build that allows it', async () => {
    vi.stubGlobal('location', { search: '?data=static' });
    const { dataSource } = await load();
    expect(dataSource()).toBe('api');

    vi.stubEnv('VITE_ALLOW_DATA_OVERRIDE', '1');
    expect(dataSource()).toBe('static');
    vi.stubGlobal('location', { search: '?data=api' });
    vi.stubEnv('VITE_DATA_SOURCE', 'static');
    expect(dataSource()).toBe('api');
    vi.stubGlobal('location', { search: '?data=somethingelse' });
    expect(dataSource()).toBe('static');
  });
});
