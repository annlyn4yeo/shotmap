import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { HERO_MATCH_ID, type IndexFile } from '@shotmap/schema';
import { RELEASE, fakeApi, jsonResponse } from './fake-api';

/** The static index, reduced to what the loader reads: three matches of one season. */
const index = {
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
} as unknown as IndexFile;

const staticOk = (body: unknown) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve(body),
});

/** What the network looks like for each source: the same three matches, served its own way. */
const SOURCES = {
  static: {
    env: 'static',
    serve: (url: string) => {
      const id = Number(/matches\/(\d+)\.json$/.exec(url)?.[1]);
      if (id && ![10, 11, 12].includes(id))
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({}),
        });
      return Promise.resolve(staticOk(url.endsWith('index.json') ? index : { v: 1 }));
    },
    unavailable: () =>
      Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }),
    indexUrls: ['/data/index.json'],
    matchUrls: (id: number) => [`/data/matches/${id}.json`],
  },
  api: {
    env: 'api',
    // The hero comes first because the index must list it.
    serve: fakeApi([HERO_MATCH_ID, 10, 11, 12]),
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
      const { prefetchNextMatch } = await load();

      prefetchNextMatch(10);
      await Promise.resolve();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('seed', () => {
    it('serves the inlined index and match without a request', async () => {
      const match = { meta: { id: 7 } };
      vi.stubGlobal('document', {
        getElementById: () => ({ textContent: JSON.stringify({ index, match }) }),
      });
      const { seedFromDocument, loadIndex, loadMatch, readIndex, readMatch } =
        await load();

      seedFromDocument();

      expect(readIndex()).toEqual(index);
      expect(readMatch(7)).toEqual(match);
      await expect(loadIndex()).resolves.toEqual(index);
      await expect(loadMatch(7)).resolves.toEqual(match);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});

describe('the api source', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DATA_SOURCE', 'api');
    fetchMock.mockImplementation(fakeApi([HERO_MATCH_ID, 10, 11, 12]));
  });

  it('gives the static files’ shapes: the index lists every match, the match its columns', async () => {
    const { loadIndex, loadMatch } = await load();
    const full = await loadIndex();
    expect(full.hero).toBe(HERO_MATCH_ID);
    expect(full.competitions[0]?.seasons[0]?.matches.map((row) => row[0])).toEqual([
      HERO_MATCH_ID,
      10,
      11,
      12,
    ]);
    expect(full.stages).toEqual(['Final']);

    const match = await loadMatch(11);
    expect(match.meta.id).toBe(11);
    expect(match.shots.x.length + (match.shootout?.x.length ?? 0)).toBe(38);
    expect(match.shootout?.per.every((p) => p === 5)).toBe(true);
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
          index,
          match: { meta: { id: 7 } },
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
    await expect(loadMatch(10)).rejects.toThrow(/unknown out id 9999/);
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
