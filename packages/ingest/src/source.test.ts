import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError, blobSha, createSource, pool } from './source';

const REF = 'a'.repeat(40);
const FAST = { ratePerSecond: 1000, backoffMs: 1, retries: 3, concurrency: 2 };

let dir: string;
let calls: string[];

/** A fetch that answers each path from a script: a body, or a status, in order. */
function serve(script: Record<string, (string | number)[]>) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL) => {
      const path = String(input).split('/data/')[1] ?? '';
      calls.push(path);
      const next = script[path]?.shift();
      if (typeof next === 'number')
        return Promise.resolve(
          new Response('no', {
            status: next,
            headers: next === 429 ? { 'retry-after': '0' } : {},
          }),
        );
      return Promise.resolve(
        new Response(next ?? '[]', { status: next === undefined ? 404 : 200 }),
      );
    }),
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'source-test-'));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const make = (tree?: Map<string, { sha: string; size: number }>) =>
  createSource({
    base: 'https://example.test/repo',
    ref: REF,
    cacheDir: dir,
    politeness: FAST,
    log: () => undefined,
    ...(tree ? { tree } : {}),
  });

describe('the polite download', () => {
  it('fetches a file once, keeps it, and reads it from the cache the next time', async () => {
    serve({ 'a.json': ['{"n":1}', '{"n":2}'] });
    const first = make();
    expect(await first.json('a.json')).toEqual({ n: 1 });
    expect(first.stats).toMatchObject({ fetched: 1, cached: 0 });
    // A new run, as after an interruption: the file is there, so nothing is asked for.
    const second = make();
    expect(await second.json('a.json')).toEqual({ n: 1 });
    expect(second.stats).toMatchObject({ fetched: 0, cached: 1 });
    expect(calls).toEqual(['a.json']);
  });

  it('leaves no half-written file behind, and fetches again over a corrupt one', async () => {
    serve({ 'b.json': ['{"ok":true}'] });
    const source = make();
    writeFileSync(join(dir, 'b.json.gz'), 'not gzip');
    expect(await source.json('b.json')).toEqual({ ok: true });
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('retries a server error and a 429 with a growing wait, and says how many', async () => {
    serve({ 'c.json': [503, 429, '{"v":3}'] });
    const source = make();
    expect(await source.json('c.json')).toEqual({ v: 3 });
    expect(source.stats.retries).toBe(2);
    expect(calls).toEqual(['c.json', 'c.json', 'c.json']);
  });

  it('halves its pace when the server pushes back, and speeds up again as it answers', async () => {
    serve({ 'd.json': [429, '{}'], 'e.json': ['{}'] });
    const source = make();
    const before = source.gapMs();
    await source.json('d.json');
    expect(source.gapMs()).toBeGreaterThan(before);
    expect(source.stats.slowdowns).toBe(1);
    for (let i = 0; i < 40; i++) {
      serve({ [`f${i}.json`]: ['{}'] });
      await source.json(`f${i}.json`);
    }
    expect(source.gapMs()).toBeLessThan(before * 2);
  });

  it('gives up after its retries, naming the file', async () => {
    serve({ 'g.json': [500, 500, 500, 500] });
    await expect(make().json('g.json')).rejects.toThrow(
      /Giving up on g\.json after 3 retries/,
    );
  });

  it('says a missing file is missing, and does not retry it', async () => {
    serve({});
    const source = make();
    await expect(source.json('h.json')).rejects.toBeInstanceOf(NotFoundError);
    expect(await source.jsonOrNull('h.json')).toBeNull();
    expect(source.stats.notFound).toEqual(['h.json']);
    expect(calls).toEqual(['h.json', 'h.json']);
  });

  it('verifies a download against its git blob hash, and refuses a corrupt one', async () => {
    const good = '{"x":1}';
    const tree = new Map([
      ['i.json', { sha: blobSha(Buffer.from(good)), size: good.length }],
    ]);
    // The first transfer is damaged, the second is whole: the damaged one is never kept.
    serve({ 'i.json': ['{"x":2}', good] });
    const source = make(tree);
    expect(await source.json('i.json')).toEqual({ x: 1 });
    expect(source.stats.retries).toBe(1);
    serve({ 'j.json': ['{"x":9}', '{"x":9}', '{"x":9}', '{"x":9}'] });
    const bad = make(new Map([['j.json', { sha: 'f'.repeat(40), size: 7 }]]));
    await expect(bad.json('j.json')).rejects.toThrow(/hash mismatch/);
    expect(readdirSync(dir).filter((f) => f.startsWith('j.json'))).toEqual([]);
  });

  it('computes the hash git gives a file', () => {
    // `printf 'hello' | git hash-object --stdin`
    expect(blobSha(Buffer.from('hello'))).toBe(
      'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0',
    );
  });

  it('refuses a cache that was filled from another commit', async () => {
    serve({});
    await make().checkCache();
    expect(readFileSync(join(dir, 'REF'), 'utf8').trim()).toBe(REF);
    const other = createSource({
      base: 'https://example.test/repo',
      ref: 'b'.repeat(40),
      cacheDir: dir,
      politeness: FAST,
    });
    await expect(other.checkCache()).rejects.toThrow(/filled from a{40}/);
  });
});

describe('the pool', () => {
  it('runs at most `limit` at once and keeps the results in order', async () => {
    let running = 0;
    let most = 0;
    const out = await pool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60]);
    expect(most).toBe(2);
  });
});
