import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { IndexFile } from '@shotmap/schema';

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

const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve(body),
});

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
});

describe('loader', () => {
  it('shares one request between concurrent callers, then serves from memory', async () => {
    fetchMock.mockResolvedValue(ok({ v: 1 }));
    const { loadMatch } = await load();

    const [a, b] = await Promise.all([loadMatch(10), loadMatch(10)]);
    const c = await loadMatch(10);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/data/matches/10.json');
    expect(a).toBe(b);
    expect(c).toBe(a);
  });

  it('does not cache a failure', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: () => Promise.resolve({}),
    });
    fetchMock.mockResolvedValueOnce(ok({ v: 1 }));
    const { loadMatch } = await load();

    await expect(loadMatch(10)).rejects.toThrow('503');
    await expect(loadMatch(10)).resolves.toEqual({ v: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('finds the next match in a season', async () => {
    const { nextMatchId } = await load();
    expect(nextMatchId(index, 10)).toBe(11);
    expect(nextMatchId(index, 12)).toBeUndefined();
    expect(nextMatchId(index, 999)).toBeUndefined();
  });
});

describe('prefetch', () => {
  it('fetches only the next match, and only once the browser is idle', async () => {
    let idle: (() => void) | undefined;
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
      idle = cb;
      return 1;
    });
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(ok(url.endsWith('index.json') ? index : { v: 1 })),
    );
    const { prefetchNextMatch } = await load();

    prefetchNextMatch(10);
    await vi.waitFor(() => expect(idle).toBeDefined());
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/data/index.json']);

    idle?.();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      '/data/index.json',
      '/data/matches/11.json',
    ]);
  });

  it('does nothing on the last match of a season', async () => {
    const idle = vi.fn();
    vi.stubGlobal('requestIdleCallback', idle);
    fetchMock.mockResolvedValue(ok(index));
    const { prefetchNextMatch } = await load();

    prefetchNextMatch(12);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
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
    const { seedFromDocument, loadIndex, loadMatch, readIndex, readMatch } = await load();

    seedFromDocument();

    expect(readIndex()).toEqual(index);
    expect(readMatch(7)).toEqual(match);
    await expect(loadIndex()).resolves.toEqual(index);
    await expect(loadMatch(7)).resolves.toEqual(match);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
