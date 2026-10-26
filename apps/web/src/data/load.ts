import {
  DATA_DIR,
  type IndexFile,
  type MatchDetail,
  type MatchFile,
  type ShotsData,
} from '@shotmap/schema';
import { createApiClient, type ApiClient } from '../api/client';
import { catalogFromApi, matchFromApi } from './api-source';
import { decodeMatch, type Catalog, type LoadedMatch } from './match';
import { LEGACY_ENUMS, fromStaticMatch } from './static-source';
import { assertIndex, assertMatch } from './validate';
import { assertMatchDetail, assertShots } from './validate-api';

/**
 * Typed loader for the match data, from one of two sources behind the same exports: the
 * /v1 API, or the generated static files (a rollback until they are deleted). Either way
 * a match comes back as a `LoadedMatch` and the match list as a `Catalog`. Every key is
 * fetched once: results are kept in memory, and concurrent callers share one in-flight
 * request. A failed request is forgotten, so a later call tries again.
 */
export type DataSource = 'static' | 'api';

/**
 * The API is the default. `VITE_DATA_SOURCE=static` at build time puts the static files back.
 * A build made with `VITE_ALLOW_DATA_OVERRIDE=1` (staging) also honours `?data=api` or
 * `?data=static`.
 */
export function dataSource(): DataSource {
  const fixed: DataSource =
    import.meta.env.VITE_DATA_SOURCE === 'static' ? 'static' : 'api';
  if (import.meta.env.VITE_ALLOW_DATA_OVERRIDE !== '1' || typeof location === 'undefined')
    return fixed;
  const asked = new URLSearchParams(location.search).get('data');
  return asked === 'api' || asked === 'static' ? asked : fixed;
}

let client: ApiClient | undefined;
const api = (): ApiClient =>
  (client ??= createApiClient({
    base: (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, ''),
  }));

const requests = new Map<string, Promise<unknown>>();
/** Resolved values, so a view can render synchronously when the data is already here. */
const values = new Map<string, unknown>();

function once<T>(key: string, produce: () => Promise<T>): Promise<T> {
  const known = requests.get(key);
  if (known) return known as Promise<T>;

  const request = produce().then((value) => {
    values.set(key, value);
    return value;
  });
  requests.set(key, request);
  request.catch(() => requests.delete(key));
  return request;
}

function getStatic<T>(path: string): Promise<T> {
  return fetch(`${import.meta.env.BASE_URL}${DATA_DIR}/${path}`).then((res) => {
    if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
    return res.json() as Promise<T>;
  });
}

function seed(key: string, value: unknown): void {
  requests.set(key, Promise.resolve(value));
  values.set(key, value);
}

const INDEX = 'index.json';
const matchKey = (id: number) => `matches/${id}.json`;

export function loadIndex(): Promise<Catalog> {
  return once(INDEX, () =>
    dataSource() === 'api'
      ? catalogFromApi(api())
      : getStatic<IndexFile>(INDEX).then((index) => {
          assertIndex(index);
          return index;
        }),
  );
}

export function loadMatch(id: number): Promise<LoadedMatch> {
  return once(matchKey(id), () =>
    dataSource() === 'api'
      ? matchFromApi(api(), id)
      : getStatic<MatchFile>(matchKey(id)).then((match) => {
          assertMatch(match, LEGACY_ENUMS);
          return fromStaticMatch(match);
        }),
  );
}

/** The match list, if it has already loaded. */
export function readIndex(): Catalog | undefined {
  return values.get(INDEX) as Catalog | undefined;
}

/** A match, if it has already loaded. */
export function readMatch(id: number): LoadedMatch | undefined {
  return values.get(matchKey(id)) as LoadedMatch | undefined;
}

/**
 * The build inlines the hero match into the page as JSON (`<script id="seed">`), made from
 * a committed fixture and never from a live API. Reading it here means the first view needs
 * no request at all. The seed also names the data release it was built from, so the first
 * request for another match is already pinned (and immutable); if the data has moved on,
 * the API says 410 and the client recovers. Call once, before rendering.
 */
export function seedFromDocument(): void {
  const text = document.getElementById('seed')?.textContent;
  if (!text) return;
  try {
    const data = JSON.parse(text) as {
      release?: string;
      detail: MatchDetail;
      shots: ShotsData;
    };
    const detail = assertMatchDetail(data.detail);
    seed(matchKey(detail.id), decodeMatch(detail, assertShots(data.shots)));
    if (data.release) api().setRelease(data.release);
  } catch {
    // A bad seed is not fatal: the loader fetches the match as usual.
  }
}

/** The match that follows `id` in its season, or undefined for the last one. */
export function nextMatchId(index: Catalog, id: number): number | undefined {
  for (const competition of index.competitions) {
    for (const season of competition.seasons) {
      const at = season.matches.findIndex((row) => row[0] === id);
      if (at >= 0) return season.matches[at + 1]?.[0];
    }
  }
  return undefined;
}

type IdleCallback = (callback: () => void, options?: { timeout: number }) => number;

function whenIdle(task: () => void): void {
  // Safari has no requestIdleCallback; a short timer is close enough.
  const idle = (globalThis as { requestIdleCallback?: IdleCallback }).requestIdleCallback;
  if (idle) idle(task, { timeout: 5000 });
  else setTimeout(task, 1500);
}

function savingData(): boolean {
  const nav = globalThis.navigator as { connection?: { saveData?: boolean } } | undefined;
  return nav?.connection?.saveData === true;
}

/**
 * Run `task` once the browser is idle, to load the match list the picker needs before it
 * is opened. Not at all when the user has asked to save data: the picker loads it on open.
 */
export function whenIdleUnlessSavingData(task: () => void): void {
  if (!savingData()) whenIdle(task);
}

/**
 * Warm the cache with the match the user is most likely to open next, once the
 * browser is idle. Fetches that one match and nothing else.
 */
export function prefetchNextMatch(currentId: number): void {
  if (savingData()) return;
  loadIndex()
    .then((index) => {
      const next = nextMatchId(index, currentId);
      if (next !== undefined) whenIdle(() => void loadMatch(next).catch(() => undefined));
    })
    .catch(() => undefined);
}
