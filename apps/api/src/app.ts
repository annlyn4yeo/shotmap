/**
 * The read-only /v1 API. GET only. Each request is checked against an allow-list, answered
 * from the Cache API when it can be, otherwise from D1 with bound parameters and bounded
 * result sizes, and sent with an ETag, a Cache-Control that matches how it was asked for,
 * the data release and the attribution. /v1 never answers with HTML: every error is JSON.
 */
import { Hono, type Context } from 'hono';
import {
  ATTRIBUTION,
  CACHE_CONTROL,
  ERROR_STATUS,
  HEADERS,
  RELEASE_PATTERN,
} from '@shotmap/schema';
import {
  BadCursor,
  exportMatch,
  exportMatchList,
  exportMatchShots,
  exportMeta,
  exportSearch,
  releaseOf,
  type Db,
} from '@shotmap/queries';
import { d1Db } from './d1';
import {
  BadRequest,
  allowedQuery,
  idOf,
  matchQuery,
  searchQuery,
  type RouteId,
} from './params';

export interface Env {
  DB: D1Database;
  /** The one origin allowed to read the API cross-origin (the workers.dev fallback). Empty or unset: same-origin only. */
  WEB_ORIGIN?: string;
}

/** The part of the Cache API the app uses, so tests can stand in for it. */
export interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface AppOptions {
  cache?: CacheLike;
  /** Swap D1 for another Db (tests). */
  db?: (env: Env) => Db;
  /** How long an isolate trusts the release it read. A new ingest shows within this time. */
  releaseTtlMs?: number;
  now?: () => number;
}

type ErrorCode = keyof typeof ERROR_STATUS;

class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const sha16 = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const cors = (env: Env): Record<string, string> =>
  env.WEB_ORIGIN ? { 'access-control-allow-origin': env.WEB_ORIGIN } : {};

function json(
  env: Env,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(status === 304 ? null : JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'x-content-type-options': 'nosniff',
      ...cors(env),
      ...headers,
    },
  });
}

const failure = (
  env: Env,
  code: ErrorCode,
  message: string,
  headers: Record<string, string> = {},
) =>
  json(
    env,
    ERROR_STATUS[code],
    { error: { code, message } },
    { 'cache-control': 'no-store', ...headers },
  );

/** If-None-Match may list several validators, or be `*`. */
const matches = (header: string | undefined, etag: string): boolean =>
  header !== undefined &&
  header.split(',').some((candidate) => {
    const t = candidate.trim().replace(/^W\//, '');
    return t === '*' || t === etag;
  });

export function createApp(options: AppOptions = {}) {
  const app = new Hono<{ Bindings: Env }>();
  const makeDb = options.db ?? ((env: Env) => d1Db(env.DB));
  const ttl = options.releaseTtlMs ?? 60_000;
  const now = options.now ?? Date.now;
  let known: { value: string; until: number } | undefined;

  /** The release, read from D1 at most once a minute per isolate. */
  const currentRelease = async (db: Db): Promise<string> => {
    if (known && known.until > now()) return known.value;
    const value = await releaseOf(db);
    if (!RELEASE_PATTERN.test(value))
      throw new Error('the database holds no valid release');
    known = { value, until: now() + ttl };
    return value;
  };

  const later = (c: Context, promise: Promise<unknown>) => {
    try {
      c.executionCtx.waitUntil(promise);
    } catch {
      // No ExecutionContext (a test calling app.request): the work is done before we return.
      void promise.catch(() => undefined);
    }
  };

  /**
   * The whole life of a GET: allow-list, release pin, ETag and 304, Cache API, D1, headers.
   * `produce` returns the `data` payload, or undefined for "no such thing" (a cacheable 404).
   */
  async function serve(
    c: Context<{ Bindings: Env }>,
    route: RouteId,
    produce: (db: Db, query: readonly [string, string][]) => Promise<unknown>,
  ): Promise<Response> {
    const env = c.env;
    try {
      const url = new URL(c.req.url);
      const query = allowedQuery(route, url.searchParams);
      const pin = query.find(([k]) => k === 'v')?.[1];
      if (pin !== undefined && !RELEASE_PATTERN.test(pin))
        throw new BadRequest('v must be r followed by 12 hex digits');

      const db = makeDb(env);
      const release = await currentRelease(db);
      if (pin !== undefined && pin !== release)
        return failure(
          env,
          'release_gone',
          `release ${pin} is not served any more; the current release is ${release}`,
          {
            [HEADERS.release]: release,
          },
        );

      const rest = query.filter(([k]) => k !== 'v');
      const tail = (pairs: readonly [string, string][]) =>
        pairs.length
          ? `?${pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`
          : '';
      // The ETag names the release and the question, not the pin: the answer is the same either way.
      const etag = `"${release}-${await sha16(url.pathname + tail(rest))}"`;
      const headers = {
        [HEADERS.etag]: etag,
        [HEADERS.cacheControl]:
          pin === release ? CACHE_CONTROL.pinned : CACHE_CONTROL.floating,
        [HEADERS.release]: release,
      };
      if (matches(c.req.header('if-none-match'), etag))
        return json(env, 304, null, headers);

      const key = new Request(url.origin + url.pathname + tail(query));
      const hit = await options.cache?.match(key);
      if (hit) {
        const copy = new Response(hit.body, hit);
        copy.headers.set('x-cache', 'HIT');
        return copy;
      }

      const data = await produce(db, rest);
      const response =
        data === undefined
          ? json(
              env,
              404,
              { error: { code: 'not_found', message: 'no such match' } },
              headers,
            )
          : json(env, 200, { release, attribution: ATTRIBUTION, data }, headers);
      if (options.cache) later(c, options.cache.put(key, response.clone()));
      response.headers.set('x-cache', 'MISS');
      return response;
    } catch (error) {
      if (error instanceof BadRequest || error instanceof BadCursor)
        return failure(env, 'bad_request', error.message);
      if (error instanceof ApiError) return failure(env, error.code, error.message);
      console.error('request failed', c.req.method, c.req.path, error);
      return failure(env, 'internal', 'something went wrong on our side');
    }
  }

  app.get('/v1/meta', (c) => serve(c, 'getMeta', (db) => exportMeta(db)));

  app.get('/v1/matches', (c) =>
    serve(c, 'listMatches', (db, query) => exportMatchList(db, matchQuery(query))),
  );

  app.get('/v1/matches/:id', (c) =>
    serve(c, 'getMatch', (db) =>
      exportMatch(db, idOf(c.req.param('id'), 'the match id')),
    ),
  );

  app.get('/v1/matches/:id/shots', (c) =>
    serve(c, 'getMatchShots', (db) =>
      exportMatchShots(db, idOf(c.req.param('id'), 'the match id')),
    ),
  );

  app.get('/v1/search', (c) =>
    serve(c, 'search', (db, query) => {
      const { q, limit } = searchQuery(query);
      return exportSearch(db, q, limit);
    }),
  );

  // Anything else under /v1: a JSON 404 for GET (including endpoints that are planned but not
  // built), 405 for other methods. It must never fall through to an HTML page.
  app.all('/v1/*', (c) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD')
      return failure(c.env, 'not_found', 'no such endpoint');
    return failure(c.env, 'method_not_allowed', 'this API is read-only: GET only', {
      allow: 'GET, HEAD',
    });
  });

  app.notFound((c) => failure(c.env, 'not_found', 'this Worker only serves /v1'));
  app.onError((error, c) => {
    console.error('unhandled', error);
    return failure(c.env, 'internal', 'something went wrong on our side');
  });
  return app;
}
