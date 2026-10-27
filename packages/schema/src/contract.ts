/**
 * Constants of the /v1 contract that carry no zod, so the browser can import them.
 */

export const API_VERSION = 'v1';

/** Credit that every response carries. The wording is a placeholder until StatsBomb is asked (docs/LICENCE-NOTES.md). */
export const ATTRIBUTION = {
  source: 'StatsBomb',
  text: 'Data by StatsBomb',
  url: 'https://statsbomb.com',
  terms: 'https://github.com/statsbomb/open-data',
} as const;

/**
 * A data release: the date it was cut, a dot, and 12 hex digits of a hash of everything ingest
 * wrote (`2026-10-27.2422edac0126`). The hash says what is in it, the date says when it was
 * released; both are in every cache key, so two releases never share one.
 */
export const RELEASE_PATTERN = /^\d{4}-\d{2}-\d{2}\.[0-9a-f]{12}$/;

/**
 * The form a release had before it carried a date (`r2422edac0126`). Nothing serves it any more,
 * but a page built then may still ask for it: that is a release that is gone (410), not a
 * malformed one (400), so the page learns the new release and carries on.
 */
export const LEGACY_RELEASE_PATTERN = /^r[0-9a-f]{12}$/;

/**
 * Cache-Control values. Data never changes within a release, so a request that names
 * the release (`?v=<release>`) may be cached for a year; one that does not is cached
 * briefly and revalidated with its ETag.
 */
export const CACHE_CONTROL = {
  pinned: 'public, max-age=31536000, immutable',
  floating: 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
} as const;

export const HEADERS = {
  etag: 'ETag',
  cacheControl: 'Cache-Control',
  release: 'X-Data-Release',
} as const;

/** Endpoint limits, sized for the design ceiling of about 10,000 matches and 500,000 shots. */
export const LIMITS = {
  matchesPageDefault: 50,
  matchesPageMax: 200,
  searchPerKind: 20,
  /** Rows in one player's shots payload. Past it, ask for density instead. */
  playerShotsMax: 10_000,
  /** What a player's shots are limited to when `limit` is not asked for. */
  playerShotsDefault: 1000,
  densitySteps: [1, 2, 4, 5, 10],
  /** A match has under 1,000 shots (SHOT_ID_FACTOR), so this bounds its payload. */
  matchShotsMax: 1000,
  matchPlayersMax: 200,
  /** Competitions, seasons and stages in /v1/meta. */
  metaRowsMax: 1000,
} as const;

/**
 * The query parameters each live route accepts. Anything else is a 400, so nobody can mint
 * endless cache keys with ?junk=1, 2, 3. A test checks these against the zod route table.
 */
export const QUERY_ALLOW = {
  getMeta: ['v'],
  listMatches: [
    'competition',
    'season',
    'stage',
    'team',
    'from',
    'to',
    'limit',
    'cursor',
    'order',
    'v',
  ],
  getMatch: ['v'],
  getMatchShots: ['v'],
  getPlayer: ['v'],
  getPlayerShots: ['competition', 'season', 'period', 'outcome', 'type', 'limit', 'v'],
  search: ['q', 'limit', 'v'],
} as const;

/** The HTTP status of each error code. */
export const ERROR_STATUS = {
  bad_request: 400,
  not_found: 404,
  method_not_allowed: 405,
  release_gone: 410,
  too_many_rows: 400,
  internal: 500,
} as const;

/** A shot's global id: stable across re-ingests, unique while a match has under 1,000 shots. */
export const SHOT_ID_FACTOR = 1000;
export const shotIdOf = (matchId: number, seq: number): number =>
  matchId * SHOT_ID_FACTOR + seq;
