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

/** A data release: `r` and 12 hex digits, a hash of everything ingest wrote. */
export const RELEASE_PATTERN = /^r[0-9a-f]{12}$/;

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
  densitySteps: [1, 2, 4, 5, 10],
} as const;

/** A shot's global id: stable across re-ingests, unique while a match has under 1,000 shots. */
export const SHOT_ID_FACTOR = 1000;
export const shotIdOf = (matchId: number, seq: number): number =>
  matchId * SHOT_ID_FACTOR + seq;
