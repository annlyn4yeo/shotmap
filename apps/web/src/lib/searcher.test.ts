import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '@shotmap/schema';
import { createSearcher, type SearchState } from './searcher';

const result = (q: string): SearchResult => ({ q, players: [], teams: [], matches: [] });

/** A search that answers when the test says so, and notes whether it was aborted. */
function setup() {
  const asked: {
    words: string;
    signal: AbortSignal;
    answer: (r: SearchResult) => void;
    fail: () => void;
  }[] = [];
  const states: SearchState[] = [];
  const searcher = createSearcher({
    delay: 120,
    search: (words, signal) =>
      new Promise<SearchResult>((resolve, reject) => {
        asked.push({
          words,
          signal,
          answer: resolve,
          fail: () => reject(new Error('down')),
        });
        signal.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      }),
    onState: (state) => states.push(state),
  });
  return { searcher, asked, states };
}

describe('searching as you type', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends nothing until typing pauses for 120 ms, and then only the last words', async () => {
    const { searcher, asked } = setup();
    for (const typed of ['m', 'me', 'mes', 'mess']) {
      searcher.run(typed);
      await vi.advanceTimersByTimeAsync(60);
    }
    expect(asked).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60);
    expect(asked.map((a) => a.words)).toEqual(['mess']);
  });

  it('trims the words, and treats nothing but spaces as no search at all', async () => {
    const { searcher, asked, states } = setup();
    searcher.run('  messi ');
    await vi.advanceTimersByTimeAsync(120);
    expect(asked.map((a) => a.words)).toEqual(['messi']);
    searcher.run('   ');
    await vi.advanceTimersByTimeAsync(500);
    expect(asked).toHaveLength(1);
    expect(states.at(-1)).toEqual({ status: 'idle' });
  });

  it('says it is loading, then gives the answer for those words', async () => {
    const { searcher, asked, states } = setup();
    searcher.run('messi');
    await vi.advanceTimersByTimeAsync(120);
    expect(states).toEqual([{ status: 'loading', words: 'messi' }]);
    asked[0]?.answer(result('messi'));
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toEqual({
      status: 'ready',
      words: 'messi',
      result: result('messi'),
    });
  });

  it('aborts a request nobody is waiting for any more', async () => {
    const { searcher, asked } = setup();
    searcher.run('mes');
    await vi.advanceTimersByTimeAsync(120);
    searcher.run('messi');
    expect(asked[0]?.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(120);
    expect(asked[1]?.signal.aborted).toBe(false);
  });

  it('lets only the latest question be answered, however late the earlier reply is', async () => {
    const { searcher, asked, states } = setup();
    searcher.run('mes');
    await vi.advanceTimersByTimeAsync(120);
    searcher.run('messi');
    await vi.advanceTimersByTimeAsync(120);
    asked[1]?.answer(result('messi'));
    await vi.advanceTimersByTimeAsync(0);
    asked[0]?.answer(result('mes')); // the slow one arrives last
    await vi.advanceTimersByTimeAsync(0);
    const ready = states.filter((s) => s.status === 'ready');
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({ words: 'messi' });
  });

  it('reports a failure for the words it was asked, but not an abort', async () => {
    const { searcher, asked, states } = setup();
    searcher.run('mes');
    await vi.advanceTimersByTimeAsync(120);
    searcher.run('messi');
    await vi.advanceTimersByTimeAsync(0);
    expect(states.some((s) => s.status === 'error')).toBe(false);
    await vi.advanceTimersByTimeAsync(120);
    asked[1]?.fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toEqual({ status: 'error', words: 'messi' });
  });

  it('drops everything pending and in flight when cancelled', async () => {
    const { searcher, asked, states } = setup();
    searcher.run('messi');
    searcher.cancel();
    await vi.advanceTimersByTimeAsync(500);
    expect(asked).toHaveLength(0);
    searcher.run('mbappe');
    await vi.advanceTimersByTimeAsync(120);
    searcher.cancel();
    expect(asked[0]?.signal.aborted).toBe(true);
    asked[0]?.answer(result('mbappe'));
    await vi.advanceTimersByTimeAsync(0);
    expect(states.some((s) => s.status === 'ready')).toBe(false);
  });
});
