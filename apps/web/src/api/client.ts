import { RELEASE_PATTERN } from '@shotmap/schema';

/**
 * A thin client for the read-only /v1 API: `fetch`, and the few things a cache-friendly
 * reader of immutable data needs. No Hono RPC client and no zod (the browser never ships
 * either, see CLAUDE.md).
 *
 * - Requests for the same path in flight share one fetch; an abort only cancels the
 *   caller's wait, and the fetch itself stops when the last waiter has gone.
 * - A small LRU keeps what was answered. An entry is fresh while its data release is the
 *   current one (and, if it was asked for without a pin, for `ttlMs`); a stale entry is
 *   still returned at once while a background request replaces it (stale-while-revalidate).
 * - Every request is a CORS-simple GET (no headers, no credentials), so no preflight.
 * - The data release is learnt from any answer. Once known, requests carry `?v=<release>`,
 *   which the API answers with `immutable`; a 410 means the release has moved on, so the
 *   client forgets it and asks again without a pin.
 * - A body that is not JSON is an error, not data: a missing /v1 route that fell through to
 *   a single-page fallback answers 200 with HTML.
 * - `validate` receives the envelope's `data` and must throw if it is not what the caller
 *   can use. Nothing unchecked reaches a view.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export interface GetOptions<T> {
  validate: (data: unknown) => T;
  signal?: AbortSignal;
}

export interface ApiClientOptions {
  /** Where /v1 is served from; empty means the page's own origin. */
  base?: string;
  /** Looked up at call time, so a test can stub the global. */
  fetch?: typeof fetch;
  /** How many answers the LRU keeps. */
  size?: number;
  /** How long an answer asked for without a pin stays fresh. */
  ttlMs?: number;
  now?: () => number;
}

interface Entry {
  data: unknown;
  release: string;
  pinned: boolean;
  at: number;
}

interface Flight {
  promise: Promise<Entry>;
  controller: AbortController;
  waiters: number;
}

const abortError = () => new DOMException('The request was aborted', 'AbortError');

export function createApiClient(options: ApiClientOptions = {}) {
  const base = options.base ?? '';
  const size = options.size ?? 48;
  const ttlMs = options.ttlMs ?? 5 * 60_000;
  const now = options.now ?? Date.now;
  const lru = new Map<string, Entry>();
  const flights = new Map<string, Flight>();
  let release: string | undefined;

  const isFresh = (e: Entry): boolean =>
    e.release === release && (e.pinned || now() - e.at < ttlMs);

  const remember = (path: string, entry: Entry): void => {
    lru.delete(path);
    lru.set(path, entry);
    while (lru.size > size) {
      const oldest = lru.keys().next();
      if (oldest.done) break;
      lru.delete(oldest.value);
    }
  };

  async function fetchEntry(
    path: string,
    validate: (data: unknown) => unknown,
    signal: AbortSignal,
    retried = false,
  ): Promise<Entry> {
    const pin = release;
    const url = `${base}${path}${pin ? `${path.includes('?') ? '&' : '?'}v=${pin}` : ''}`;
    const res = await (options.fetch ?? globalThis.fetch)(url, { signal });

    if (res.status === 410 && !retried) {
      // The data moved on: what we know of the old release is no use.
      release = undefined;
      lru.clear();
      return fetchEntry(path, validate, signal, true);
    }
    const type = res.headers.get('content-type') ?? '';
    if (!/^application\/json/i.test(type))
      throw new ApiError(
        `${url} answered ${type || 'no content-type'}, not JSON`,
        res.status,
        'not_json',
      );
    const body = (await res.json()) as unknown;
    if (!res.ok) {
      const error = (body as { error?: { code?: unknown; message?: unknown } } | null)
        ?.error;
      throw new ApiError(
        typeof error?.message === 'string'
          ? error.message
          : `${url} answered ${res.status}`,
        res.status,
        typeof error?.code === 'string' ? error.code : 'http_error',
      );
    }
    const envelope = body as {
      release?: unknown;
      attribution?: unknown;
      data?: unknown;
    } | null;
    if (
      typeof envelope?.release !== 'string' ||
      !RELEASE_PATTERN.test(envelope.release) ||
      typeof envelope.attribution !== 'object' ||
      envelope.attribution === null ||
      !('data' in envelope)
    )
      throw new ApiError(`${url} is not a /v1 envelope`, res.status, 'bad_envelope');

    release = envelope.release;
    return {
      data: validate(envelope.data),
      release: envelope.release,
      pinned: pin !== undefined,
      at: now(),
    };
  }

  function start(path: string, validate: (data: unknown) => unknown): Flight {
    const known = flights.get(path);
    if (known) return known;
    const controller = new AbortController();
    const promise = fetchEntry(path, validate, controller.signal).then((entry) => {
      remember(path, entry);
      return entry;
    });
    const flight: Flight = { promise, controller, waiters: 0 };
    flights.set(path, flight);
    const done = () => {
      if (flights.get(path) === flight) flights.delete(path);
    };
    promise.then(done, done);
    return flight;
  }

  /** Wait for a flight, but let the caller leave early. */
  function join(flight: Flight, signal: AbortSignal | undefined): Promise<Entry> {
    flight.waiters++;
    if (!signal) return flight.promise;
    return new Promise<Entry>((resolve, reject) => {
      const leave = () => {
        if (--flight.waiters <= 0) flight.controller.abort();
        reject(abortError());
      };
      if (signal.aborted) {
        leave();
        return;
      }
      signal.addEventListener('abort', leave, { once: true });
      const stop = () => signal.removeEventListener('abort', leave);
      flight.promise.then(
        (entry) => {
          stop();
          resolve(entry);
        },
        (error: unknown) => {
          stop();
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  return {
    /** The data of `path` (for example `/v1/matches/3869685`), checked by `validate`. */
    async get<T>(path: string, { validate, signal }: GetOptions<T>): Promise<T> {
      const hit = lru.get(path);
      if (hit) {
        remember(path, hit);
        if (!isFresh(hit)) {
          const refresh = start(path, validate);
          refresh.waiters++;
          refresh.promise.catch(() => undefined);
        }
        return hit.data as T;
      }
      return (await join(start(path, validate), signal)).data as T;
    },
    /** The data release learnt from the latest answer, if any. */
    release: (): string | undefined => release,
    /** Seed the release (the page was built with one), so the first request is already pinned. */
    setRelease(value: string): void {
      if (RELEASE_PATTERN.test(value)) release = value;
    },
    clear(): void {
      lru.clear();
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
