import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_RECENTS, forgetSearches, loadRecents, rememberSearch } from './recents';

/** localStorage as a Map, so a test can look inside it. */
function storage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}
const KEY = 'shotmap:recent-searches';

describe('recent searches', () => {
  afterEach(() => vi.unstubAllGlobals());

  describe('kept on this device', () => {
    let store: ReturnType<typeof storage>;
    beforeEach(() => {
      store = storage();
      vi.stubGlobal('localStorage', store);
    });

    it('puts the newest first and keeps only what is in localStorage', () => {
      rememberSearch('messi');
      rememberSearch('argentina');
      expect(loadRecents()).toEqual(['argentina', 'messi']);
      expect([...store.data.keys()]).toEqual([KEY]);
    });

    it('counts "Messi", "messi" and "Mèssi" as one search, keeping the latest spelling', () => {
      rememberSearch('messi');
      rememberSearch('Mèssi');
      rememberSearch('MESSI');
      expect(loadRecents()).toEqual(['MESSI']);
    });

    it('squeezes spaces, ignores one-letter searches and caps the list', () => {
      rememberSearch('  angel   di   maria ');
      rememberSearch('a');
      expect(loadRecents()).toEqual(['angel di maria']);
      for (let i = 0; i < MAX_RECENTS + 5; i++) rememberSearch(`team ${i}`);
      expect(loadRecents()).toHaveLength(MAX_RECENTS);
      expect(loadRecents()[0]).toBe(`team ${MAX_RECENTS + 4}`);
    });

    it('does not keep what is too long to be a search', () => {
      rememberSearch('x'.repeat(65));
      expect(loadRecents()).toEqual([]);
    });

    it('forgets on request', () => {
      rememberSearch('messi');
      forgetSearches();
      expect(loadRecents()).toEqual([]);
    });

    it('survives a stored list that is not one', () => {
      for (const bad of ['not json', '{"a":1}', '[1,2,{"x":1}]', '[""]']) {
        store.data.set(KEY, bad);
        expect(loadRecents(), bad).toEqual([]);
      }
      store.data.set(KEY, '["fine", 5, "also fine"]');
      expect(loadRecents()).toEqual(['fine', 'also fine']);
    });
  });

  describe('where storage is missing or blocked', () => {
    it('works, and keeps nothing', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
        removeItem: () => {
          throw new Error('blocked');
        },
      });
      expect(loadRecents()).toEqual([]);
      expect(rememberSearch('messi')).toEqual(['messi']);
      expect(() => forgetSearches()).not.toThrow();
    });

    it('works when there is no localStorage at all', () => {
      vi.stubGlobal('localStorage', undefined);
      expect(loadRecents()).toEqual([]);
      expect(() => rememberSearch('messi')).not.toThrow();
    });
  });
});
