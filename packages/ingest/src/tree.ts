/**
 * The file list of the pinned commit, from GitHub's git tree API (one request): every file the
 * ingest may read, with its size and git blob hash. It says how much there is to download before
 * anything is, which matches have event files, and lets each download be verified. Kept in the
 * cache, so a later run asks GitHub nothing.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { TreeEntry } from './source';

interface TreeFile {
  ref: string;
  /** Path relative to `data/` -> [blob hash, size in bytes]. */
  files: Record<string, [string, number]>;
}

/** Only these are read by the ingest: not the 360 freeze frames, the docs or the images. */
const WANTED =
  /^data\/(competitions\.json|matches\/\d+\/\d+\.json|events\/\d+\.json|lineups\/\d+\.json)$/;

export async function loadTree(
  ref: string,
  cacheDir: string,
  userAgent = 'shotmap-ingest (+https://github.com/annlyn4yeo/shotmap)',
): Promise<Map<string, TreeEntry>> {
  const file = join(cacheDir, 'TREE.json.gz');
  let stored: TreeFile | undefined;
  if (existsSync(file)) {
    try {
      stored = JSON.parse(gunzipSync(await readFile(file)).toString('utf8')) as TreeFile;
    } catch {
      stored = undefined;
    }
    if (stored && stored.ref !== ref) stored = undefined;
  }
  if (!stored) {
    const res = await fetch(
      `https://api.github.com/repos/statsbomb/open-data/git/trees/${ref}?recursive=1`,
      {
        headers: { 'user-agent': userAgent, accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!res.ok) throw new Error(`The file tree of ${ref}: HTTP ${res.status}`);
    const body = (await res.json()) as {
      truncated: boolean;
      tree: { path: string; type: string; sha: string; size?: number }[];
    };
    if (body.truncated)
      throw new Error(
        `The file tree of ${ref} was truncated by GitHub: it cannot be trusted`,
      );
    const files: TreeFile['files'] = {};
    for (const e of body.tree)
      if (e.type === 'blob' && WANTED.test(e.path))
        files[e.path.slice('data/'.length)] = [e.sha, e.size ?? 0];
    stored = { ref, files };
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, gzipSync(JSON.stringify(stored)));
    await rename(tmp, file);
  }
  return new Map(
    Object.entries(stored.files).map(([path, [sha, size]]) => [path, { sha, size }]),
  );
}
