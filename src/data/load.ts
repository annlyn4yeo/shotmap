import { DATA_DIR, type IndexFile, type MatchFile } from './types';

/**
 * Typed loader for the generated files. Every path is fetched once: results are
 * kept in memory, and concurrent callers share one in-flight request. A failed
 * request is forgotten, so a later call tries again.
 */
const requests = new Map<string, Promise<unknown>>();

function getJson<T>(path: string): Promise<T> {
  const known = requests.get(path);
  if (known) return known as Promise<T>;

  const request = fetch(`${import.meta.env.BASE_URL}${DATA_DIR}/${path}`).then((res) => {
    if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
    return res.json() as Promise<T>;
  });
  requests.set(path, request);
  request.catch(() => requests.delete(path));
  return request;
}

export function loadIndex(): Promise<IndexFile> {
  return getJson<IndexFile>('index.json');
}

export function loadMatch(id: number): Promise<MatchFile> {
  return getJson<MatchFile>(`matches/${id}.json`);
}

/** The match that follows `id` in its season, or undefined for the last one. */
export function nextMatchId(index: IndexFile, id: number): number | undefined {
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
 * Warm the cache with the match the user is most likely to open next, once the
 * browser is idle. Fetches that one file and nothing else.
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
