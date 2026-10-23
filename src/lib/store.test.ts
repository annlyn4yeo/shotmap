import { describe, expect, it, vi } from 'vitest';
import { createStore } from './store';

describe('store', () => {
  it('merges a patch and tells subscribers', () => {
    const store = createStore({ a: 1, b: 2 });
    const seen = vi.fn();
    store.subscribe(seen);
    store.set({ a: 5 });
    expect(store.get()).toEqual({ a: 5, b: 2 });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('stays silent when nothing actually changed', () => {
    const store = createStore({ a: 1, list: [1] });
    const list = store.get().list;
    const seen = vi.fn();
    store.subscribe(seen);
    store.set({ a: 1 });
    store.set({ list });
    expect(seen).not.toHaveBeenCalled();
  });

  it('stops telling a subscriber that has unsubscribed', () => {
    const store = createStore({ a: 1 });
    const seen = vi.fn();
    const off = store.subscribe(seen);
    off();
    store.set({ a: 2 });
    expect(seen).not.toHaveBeenCalled();
  });
});
