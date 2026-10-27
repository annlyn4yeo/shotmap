/**
 * The raw StatsBomb files: a polite, resumable, verified download into an on-disk cache.
 *
 * - Pinned. Everything comes from one commit (`source.ref`); a cache filled from another ref is
 *   refused, so the dataset can never be a mix of two versions of the source.
 * - Resumable. A file is written to the cache only once it is whole (temp file, then rename), and
 *   a run only fetches what is missing, so an interrupted run loses at most the files in flight.
 * - Verified. The commit's file tree gives every file's git blob hash; a download that does not
 *   match is a corrupt transfer and is fetched again, never cached.
 * - Polite. A fixed number of requests in flight, a ceiling on how many start per second, an
 *   identifying User-Agent, exponential backoff with jitter, `Retry-After` obeyed, and the pace
 *   halved (the gap between requests doubled) whenever the server pushes back, recovering slowly.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gunzipSync, gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);

export interface Politeness {
  /** Requests in flight at once. */
  concurrency: number;
  /** The most requests that start in a second. */
  ratePerSecond: number;
  retries: number;
  /** Per request, from the first byte asked for to the last one received. */
  timeoutMs: number;
  /** The wait before the first retry; each retry waits twice as long (up to a minute), plus jitter. */
  backoffMs: number;
}

export const POLITE: Politeness = {
  concurrency: 3,
  ratePerSecond: 4,
  retries: 6,
  timeoutMs: 120_000,
  backoffMs: 1000,
};

export interface TreeEntry {
  /** The git blob hash: sha1 of "blob <size>\0<bytes>". */
  sha: string;
  size: number;
}

export interface Stats {
  fetched: number;
  cached: number;
  /** Bytes of the files as stored in the repository (what was parsed or downloaded). */
  rawBytes: number;
  /** Bytes that crossed the network, when the server said (it compresses). */
  wireBytes: number;
  retries: number;
  /** How many times the pace was halved. */
  slowdowns: number;
  notFound: string[];
}

export class NotFoundError extends Error {}
class FatalHttpError extends Error {}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The hash git gives a file's content. */
export const blobSha = (bytes: Uint8Array): string =>
  createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

export interface SourceOptions {
  base: string;
  ref: string;
  cacheDir: string;
  politeness?: Partial<Politeness>;
  /** Blob hashes by path (relative to `data/`), to verify downloads against. */
  tree?: Map<string, TreeEntry>;
  userAgent?: string;
  log?: (line: string) => void;
}

export interface Source {
  readonly stats: Stats;
  readonly politeness: Politeness;
  /** Refuses a cache filled from another ref, and marks an empty one with this ref. */
  checkCache(): Promise<void>;
  /** Whether a file is already in the cache (so a run can say how much is left to fetch). */
  has(path: string): boolean;
  json<T>(path: string): Promise<T>;
  jsonOrNull<T>(path: string): Promise<T | null>;
  /** The current gap between request starts, in ms (grows when the server pushes back). */
  gapMs(): number;
  /** From now on, check every download against these blob hashes. */
  useTree(tree: Map<string, TreeEntry>): void;
}

export function createSource(options: SourceOptions): Source {
  const politeness = { ...POLITE, ...options.politeness };
  const log = options.log ?? ((line: string) => console.warn(line));
  const userAgent =
    options.userAgent ?? 'shotmap-ingest (+https://github.com/annlyn4yeo/shotmap)';
  const stats: Stats = {
    fetched: 0,
    cached: 0,
    rawBytes: 0,
    wireBytes: 0,
    retries: 0,
    slowdowns: 0,
    notFound: [],
  };

  let tree = options.tree;
  const baseGap = 1000 / politeness.ratePerSecond;
  let gap = baseGap;
  let nextStart = 0;
  /** Waits for this request's turn: starts are spaced `gap` apart, whoever is asking. */
  const turn = async () => {
    const now = Date.now();
    const at = Math.max(now, nextStart);
    nextStart = at + gap;
    if (at > now) await sleep(at - now);
  };
  const slowDown = () => {
    gap = Math.min(gap * 2, 8000);
    stats.slowdowns++;
  };
  const recover = () => {
    gap = Math.max(baseGap, gap * 0.95);
  };

  const urlOf = (path: string) => `${options.base}/${options.ref}/data/${path}`;

  async function download(path: string): Promise<Buffer> {
    const url = urlOf(path);
    let lastError = '';
    for (let attempt = 0; attempt <= politeness.retries; attempt++) {
      let wait =
        Math.min(60_000, politeness.backoffMs * 2 ** attempt) +
        Math.random() * (politeness.backoffMs / 2);
      try {
        await turn();
        const res = await fetch(url, {
          headers: { 'user-agent': userAgent },
          signal: AbortSignal.timeout(politeness.timeoutMs),
        });
        if (res.ok) {
          const body = Buffer.from(await res.arrayBuffer());
          const expected = tree?.get(path);
          if (expected && blobSha(body) !== expected.sha) {
            lastError = `hash mismatch (got ${body.length} bytes, expected ${expected.size})`;
          } else {
            stats.wireBytes += Number(res.headers.get('content-length') ?? 0);
            recover();
            return body;
          }
        } else if (res.status === 404) {
          throw new NotFoundError(url);
        } else if (res.status === 429 || res.status === 403 || res.status >= 500) {
          lastError = `HTTP ${res.status}`;
          slowDown();
          const retryAfter = Number(res.headers.get('retry-after'));
          if (retryAfter > 0) wait = Math.max(wait, retryAfter * 1000);
        } else {
          throw new FatalHttpError(`${res.status} ${url}`);
        }
      } catch (error) {
        if (error instanceof NotFoundError || error instanceof FatalHttpError)
          throw error;
        lastError = error instanceof Error ? error.message : String(error);
      }
      if (attempt < politeness.retries) {
        stats.retries++;
        log(
          `  retry ${attempt + 1}/${politeness.retries} in ${Math.round(wait)} ms: ${path} (${lastError})`,
        );
        await sleep(wait);
      }
    }
    throw new Error(
      `Giving up on ${path} after ${politeness.retries} retries: ${lastError}`,
    );
  }

  async function json<T>(path: string): Promise<T> {
    const file = join(options.cacheDir, `${path}.gz`);
    if (existsSync(file)) {
      try {
        const raw = gunzipSync(await readFile(file));
        const parsed = JSON.parse(raw.toString('utf8')) as T;
        stats.cached++;
        stats.rawBytes += raw.length;
        return parsed;
      } catch {
        await rm(file, { force: true }); // truncated or corrupt: fetch it again
      }
    }
    const body = await download(path);
    const parsed = JSON.parse(body.toString('utf8')) as T;
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, await gzipAsync(body));
    await rename(tmp, file);
    stats.fetched++;
    stats.rawBytes += body.length;
    return parsed;
  }

  return {
    stats,
    politeness,
    gapMs: () => gap,
    useTree(next) {
      tree = next;
    },
    has: (path) => existsSync(join(options.cacheDir, `${path}.gz`)),
    json,
    async jsonOrNull<T>(path: string): Promise<T | null> {
      try {
        return await json<T>(path);
      } catch (error) {
        if (error instanceof NotFoundError) {
          stats.notFound.push(path);
          return null;
        }
        throw error;
      }
    },
    async checkCache() {
      const marker = join(options.cacheDir, 'REF');
      if (existsSync(marker)) {
        const was = (await readFile(marker, 'utf8')).trim();
        if (was !== options.ref) {
          throw new Error(
            `The cache was filled from ${was} but source.ref is ${options.ref}. Delete ${options.cacheDir} or restore the ref.`,
          );
        }
        return;
      }
      if (existsSync(options.cacheDir) && (await readdir(options.cacheDir)).length > 0) {
        throw new Error(
          `${options.cacheDir} has files but no REF marker, so its source is unknown. Delete it, or write the ref it came from into ${marker} once you have checked.`,
        );
      }
      await mkdir(options.cacheDir, { recursive: true });
      await writeFile(marker, `${options.ref}\n`);
    },
  };
}

/** Runs `work` over `items` with at most `limit` in flight; results come back in order. */
export async function pool<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await work(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
