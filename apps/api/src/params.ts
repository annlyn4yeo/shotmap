import { LIMITS, QUERY_ALLOW } from '@shotmap/schema';
import type { MatchQuery } from '@shotmap/queries';

/** A request the client got wrong: 400, never cached. */
export class BadRequest extends Error {
  override readonly name = 'BadRequest';
}

const INT = /^\d{1,9}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type RouteId = keyof typeof QUERY_ALLOW;

/**
 * The query string, checked against the route's allow-list: an unknown or repeated parameter
 * is an error, so `?junk=1`, `?junk=2`... cannot mint endless cache entries. Returns the
 * parameters in sorted order, which is also what the cache key is built from.
 */
export function allowedQuery(
  route: RouteId,
  search: URLSearchParams,
): [string, string][] {
  const allowed: readonly string[] = QUERY_ALLOW[route];
  const seen = new Set<string>();
  const out: [string, string][] = [];
  for (const [key, value] of search) {
    if (!allowed.includes(key))
      throw new BadRequest(`unknown query parameter "${key.slice(0, 40)}"`);
    if (seen.has(key)) throw new BadRequest(`query parameter "${key}" is given twice`);
    if (value.length > 64) throw new BadRequest(`query parameter "${key}" is too long`);
    seen.add(key);
    out.push([key, value]);
  }
  return out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

export function idOf(text: string, what: string): number {
  if (!INT.test(text)) throw new BadRequest(`${what} must be a whole number`);
  return Number(text);
}

function int(params: Map<string, string>, key: string): number | undefined {
  const v = params.get(key);
  return v === undefined ? undefined : idOf(v, key);
}

/** 2022-02-30 matches the pattern but is not a day. (Date.toISOString would throw on it: a 500.) */
function isRealDate(text: string): boolean {
  const [y = 0, m = 0, d = 0] = text.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function date(params: Map<string, string>, key: string): string | undefined {
  const v = params.get(key);
  if (v === undefined) return undefined;
  if (!DATE.test(v) || !isRealDate(v))
    throw new BadRequest(`${key} must be a date like 2022-12-18`);
  return v;
}

/** /v1/search: the words typed are required, and the number of results per kind is capped. */
export function searchQuery(pairs: readonly [string, string][]): {
  q: string;
  limit: number;
} {
  const params = new Map(pairs);
  const q = (params.get('q') ?? '').trim();
  if (q === '') throw new BadRequest('q is required: the words to look for');
  const limit = int(params, 'limit');
  if (limit !== undefined && limit < 1) throw new BadRequest('limit must be at least 1');
  return { q, limit: Math.min(limit ?? LIMITS.searchPerKind, LIMITS.searchPerKind) };
}

/** /v1/matches: every filter is optional; limit is capped, never trusted. */
export function matchQuery(pairs: readonly [string, string][]): MatchQuery {
  const params = new Map(pairs);
  const q: MatchQuery = {};
  const set = <K extends keyof MatchQuery>(key: K, value: MatchQuery[K]) => {
    if (value !== undefined) q[key] = value;
  };
  set('competition', int(params, 'competition'));
  set('season', int(params, 'season'));
  set('stage', int(params, 'stage'));
  set('team', int(params, 'team'));
  set('from', date(params, 'from'));
  set('to', date(params, 'to'));
  const limit = int(params, 'limit');
  if (limit !== undefined) {
    if (limit < 1) throw new BadRequest('limit must be at least 1');
    q.limit = Math.min(limit, LIMITS.matchesPageMax);
  }
  set('cursor', params.get('cursor'));
  return q;
}
