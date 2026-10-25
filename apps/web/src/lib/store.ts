import { useEffect, useRef, useState } from 'preact/hooks';

/**
 * A tiny store: one state object, `set` merges a patch, subscribers are told
 * only when something actually changed. Components read through `useStore`
 * with a selector, so a component re-renders only when its own slice changes.
 */
export interface Store<S> {
  get: () => S;
  set: (patch: Partial<S>) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      const keys = Object.keys(patch) as (keyof S)[];
      if (keys.every((k) => Object.is(state[k], patch[k]))) return;
      state = { ...state, ...patch };
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Read a slice of the store. Re-renders only when the selected value changes (Object.is by default). */
export function useStore<S, T>(
  store: Store<S>,
  select: (state: S) => T,
  equal: (a: T, b: T) => boolean = Object.is,
): T {
  const [, rerender] = useState(0);
  const latest = useRef(select(store.get()));
  const selectRef = useRef(select);
  selectRef.current = select;
  const equalRef = useRef(equal);
  equalRef.current = equal;

  const current = select(store.get());
  if (!equal(current, latest.current)) latest.current = current;

  useEffect(
    () =>
      store.subscribe(() => {
        const next = selectRef.current(store.get());
        if (!equalRef.current(next, latest.current)) {
          latest.current = next;
          rerender((n) => n + 1);
        }
      }),
    [store],
  );

  return latest.current;
}
