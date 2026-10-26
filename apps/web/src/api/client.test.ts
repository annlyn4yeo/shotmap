import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './client';

const RELEASE = 'r0123456789ab';
const NEXT = 'rffffffffffff';

const envelope = (data: unknown, release = RELEASE) => ({
  release,
  attribution: { source: 'StatsBomb' },
  data,
});

const reply = (body: unknown, init: { status?: number; type?: string } = {}): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': init.type ?? 'application/json; charset=UTF-8' },
  });

const accept = (data: unknown) => data;

/** A client over a scripted fetch, which records the URLs it was asked for. */
function setup(...answers: (Response | (() => Promise<Response>))[]) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
  for (const a of answers)
    fetchMock.mockImplementationOnce(() =>
      typeof a === 'function' ? a() : Promise.resolve(a),
    );
  let clock = 0;
  const client = createApiClient({
    base: 'https://api.example',
    fetch: fetchMock as unknown as typeof fetch,
    now: () => clock,
    size: 3,
    ttlMs: 1000,
  });
  return { client, fetchMock, tick: (ms: number) => (clock += ms) };
}

describe('api client', () => {
  it('shares one request between callers, then answers from memory', async () => {
    const { client, fetchMock } = setup(reply(envelope({ a: 1 })));
    const [x, y] = await Promise.all([
      client.get('/v1/meta', { validate: accept }),
      client.get('/v1/meta', { validate: accept }),
    ]);
    const z = await client.get('/v1/meta', { validate: accept });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(x).toBe(y);
    expect(z).toBe(x);
  });

  it('sends a CORS-simple GET: no headers, no credentials', async () => {
    const { client, fetchMock } = setup(reply(envelope(1)));
    await client.get('/v1/meta', { validate: accept });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.example/v1/meta');
    expect(Object.keys(init ?? {})).toEqual(['signal']);
  });

  it('learns the release, then pins what it asks for', async () => {
    const { client, fetchMock } = setup(
      reply(envelope(1)),
      reply(envelope(2)),
      reply(envelope(3)),
    );
    await client.get('/v1/meta', { validate: accept });
    expect(client.release()).toBe(RELEASE);
    await client.get('/v1/matches/7', { validate: accept });
    await client.get('/v1/matches?limit=5', { validate: accept });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      'https://api.example/v1/meta',
      `https://api.example/v1/matches/7?v=${RELEASE}`,
      `https://api.example/v1/matches?limit=5&v=${RELEASE}`,
    ]);
  });

  it('starts pinned when the page was built with a release', async () => {
    const { client, fetchMock } = setup(reply(envelope(1)));
    client.setRelease(RELEASE);
    client.setRelease('not a release');
    await client.get('/v1/matches/7', { validate: accept });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://api.example/v1/matches/7?v=${RELEASE}`,
    );
  });

  it('on 410 forgets the release and asks again without a pin', async () => {
    const { client, fetchMock } = setup(
      reply(envelope(1)),
      reply({ error: { code: 'release_gone', message: 'gone' } }, { status: 410 }),
      reply(envelope(2, NEXT)),
    );
    await client.get('/v1/meta', { validate: accept });
    await expect(client.get('/v1/matches/7', { validate: accept })).resolves.toBe(2);
    expect(fetchMock.mock.calls[2]?.[0]).toBe('https://api.example/v1/matches/7');
    expect(client.release()).toBe(NEXT);
  });

  it('refuses a body that is not JSON, as when a missing route falls to the SPA', async () => {
    const { client } = setup(reply('<!doctype html>', { type: 'text/html' }));
    const failure = await client
      .get('/v1/nope', { validate: accept })
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe('not_json');
  });

  it('refuses JSON that is not an envelope', async () => {
    const { client } = setup(reply({ data: 1 }), reply({ ...envelope(1), release: 'x' }));
    await expect(client.get('/v1/a', { validate: accept })).rejects.toMatchObject({
      code: 'bad_envelope',
    });
    await expect(client.get('/v1/b', { validate: accept })).rejects.toMatchObject({
      code: 'bad_envelope',
    });
  });

  it('turns an error answer into an ApiError with its code and status', async () => {
    const { client } = setup(
      reply({ error: { code: 'not_found', message: 'no such match' } }, { status: 404 }),
    );
    await expect(client.get('/v1/matches/1', { validate: accept })).rejects.toMatchObject(
      {
        code: 'not_found',
        status: 404,
        message: 'no such match',
      },
    );
  });

  it('throws what validate throws, and does not keep the answer', async () => {
    const { client, fetchMock } = setup(
      reply(envelope({ bad: true })),
      reply(envelope({ ok: 1 })),
    );
    const strict = (data: unknown) => {
      if (!(data as { ok?: number }).ok) throw new Error('bad shape');
      return data;
    };
    await expect(client.get('/v1/x', { validate: strict })).rejects.toThrow('bad shape');
    await expect(client.get('/v1/x', { validate: strict })).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps only the most recently used answers', async () => {
    const { client, fetchMock } = setup(
      reply(envelope('a')),
      reply(envelope('b')),
      reply(envelope('c')),
      reply(envelope('d')),
      reply(envelope('a again')),
    );
    for (const path of ['/v1/a', '/v1/b', '/v1/c'])
      await client.get(path, { validate: accept });
    await client.get('/v1/a', { validate: accept }); // a is now the freshest of the three
    await client.get('/v1/d', { validate: accept }); // evicts b, the oldest
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await client.get('/v1/b', { validate: accept }).catch(() => undefined);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('/v1/b');
  });

  it('serves a stale answer at once and replaces it in the background', async () => {
    const { client, fetchMock, tick } = setup(
      reply(envelope('old')),
      reply(envelope('new')),
    );
    expect(await client.get('/v1/meta', { validate: accept })).toBe('old');
    tick(5000); // past ttlMs, and the first answer was asked for without a pin
    expect(await client.get('/v1/meta', { validate: accept })).toBe('old');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () =>
      expect(await client.get('/v1/meta', { validate: accept })).toBe('new'),
    );
  });

  it('does not revalidate an answer asked for with a pin', async () => {
    const { client, fetchMock, tick } = setup(reply(envelope(1)), reply(envelope(2)));
    client.setRelease(RELEASE);
    await client.get('/v1/matches/7', { validate: accept });
    tick(60 * 60_000);
    expect(await client.get('/v1/matches/7', { validate: accept })).toBe(2 - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed background refresh quiet and keeps the old answer', async () => {
    const { client, tick } = setup(reply(envelope('old')), () =>
      Promise.reject(new Error('offline')),
    );
    await client.get('/v1/meta', { validate: accept });
    tick(5000);
    expect(await client.get('/v1/meta', { validate: accept })).toBe('old');
    await Promise.resolve();
    expect(await client.get('/v1/meta', { validate: accept })).toBe('old');
  });

  describe('abort', () => {
    /** A fetch that waits until its signal fires. */
    const hang = (): Promise<Response> => new Promise(() => undefined);

    it('lets one caller leave without stopping the request another still wants', async () => {
      const seen: AbortSignal[] = [];
      const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
        if (init?.signal) seen.push(init.signal);
        return Promise.resolve(reply(envelope('done')));
      });
      const client = createApiClient({ fetch: fetchMock as unknown as typeof fetch });
      const gone = new AbortController();
      const first = client.get('/v1/meta', { validate: accept, signal: gone.signal });
      const second = client.get('/v1/meta', { validate: accept });
      gone.abort();
      await expect(first).rejects.toMatchObject({ name: 'AbortError' });
      await expect(second).resolves.toBe('done');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(seen[0]?.aborted).toBe(false);
    });

    it('stops the request when the last caller leaves', async () => {
      let signal: AbortSignal | undefined;
      const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return hang();
      });
      const client = createApiClient({ fetch: fetchMock as unknown as typeof fetch });
      const one = new AbortController();
      const two = new AbortController();
      const a = client.get('/v1/meta', { validate: accept, signal: one.signal });
      const b = client.get('/v1/meta', { validate: accept, signal: two.signal });
      one.abort();
      expect(signal?.aborted).toBe(false);
      two.abort();
      expect(signal?.aborted).toBe(true);
      await expect(a).rejects.toMatchObject({ name: 'AbortError' });
      await expect(b).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('refuses at once when the signal is already aborted', async () => {
      const client = createApiClient({
        fetch: (() => hang()) as unknown as typeof fetch,
      });
      const done = AbortSignal.abort();
      await expect(
        client.get('/v1/meta', { validate: accept, signal: done }),
      ).rejects.toMatchObject({
        name: 'AbortError',
      });
    });
  });
});
