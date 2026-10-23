import { loadIndex, loadMatch, readIndex, readMatch } from '../data/load';
import type { IndexFile, MatchFile } from '../data/types';
import type { Outcome } from '../lib/geometry';
import { createStore } from '../lib/store';
import { DEFAULT_ROUTE, formatHash, parseHash, type Route } from '../lib/route';
import { withTransition } from '../lib/transition';

export interface MatchState {
  id: number;
  status: 'loading' | 'ready' | 'error';
  data: MatchFile | null;
}

export interface AppState {
  index: IndexFile | null;
  indexFailed: boolean;
  route: Route;
  match: MatchState;
  picker: boolean;
}

export const store = createStore<AppState>({
  index: null,
  indexFailed: false,
  route: DEFAULT_ROUTE,
  match: { id: 0, status: 'loading', data: null },
  picker: false,
});

/** The match the route points at: its own, or the hero. */
export const matchIdOf = (state: AppState): number | null =>
  state.route.m ?? state.index?.hero ?? null;

// Loading

function startLoad(id: number): void {
  store.set({ match: { id, status: 'loading', data: null } });
  loadMatch(id)
    .then((data) => {
      if (store.get().match.id === id)
        store.set({ match: { id, status: 'ready', data } });
    })
    .catch(() => {
      if (store.get().match.id === id)
        store.set({ match: { id, status: 'error', data: null } });
    });
}

/** Make the loaded match follow the route. Instant when the match is already in memory. */
function followRoute(): void {
  const state = store.get();
  const id = matchIdOf(state);
  if (id === null) return;
  if (state.match.id === id && state.match.status !== 'error') return;
  const cached = readMatch(id);
  if (cached) store.set({ match: { id, status: 'ready', data: cached } });
  else startLoad(id);
}

export function retryMatch(): void {
  const id = matchIdOf(store.get());
  if (id !== null) startLoad(id);
}

// The URL

const urlFor = (route: Route) =>
  `${location.pathname}${location.search}${formatHash(route)}`;

/**
 * Change the route. A new match is a new history entry, so Back returns to the
 * last one; changing a filter only replaces the current entry. With `animate`,
 * the change runs in a view transition.
 */
export function update(patch: Partial<Route>, options: { animate?: boolean } = {}): void {
  const before = store.get().route;
  const route: Route = { ...before, ...patch };
  const commit = () => {
    store.set({ route });
    const push = route.m !== before.m;
    history[push ? 'pushState' : 'replaceState'](null, '', urlFor(route));
    if (push) followRoute();
  };
  if (options.animate) withTransition(commit);
  else commit();
}

/** Go to a match with a clean slate: no filters, nothing selected. */
export function openMatch(id: number): void {
  const hero = store.get().index?.hero;
  update({ ...DEFAULT_ROUTE, m: id === hero ? null : id }, { animate: true });
}

export const resetFilters = (): void =>
  update(
    { team: null, player: null, hide: [], shootout: false, shot: null },
    { animate: true },
  );

/** Hide or show one outcome. A module function, so the legend's props never change. */
export function toggleOutcome(outcome: Outcome): void {
  const { hide } = store.get().route;
  update(
    {
      hide: hide.includes(outcome)
        ? hide.filter((o) => o !== outcome)
        : [...hide, outcome],
    },
    { animate: true },
  );
}

export const openPicker = (): void => store.set({ picker: true });
export const closePicker = (): void => store.set({ picker: false });

// Start-up

/** Read the URL, load what it points at, and keep the two in step. Call once. */
export function init(): void {
  // Read the inlined seed now, not when this module loads, which is before it is available.
  store.set({ index: readIndex() ?? null, route: parseHash(location.hash) });

  window.addEventListener('popstate', () => {
    store.set({ route: parseHash(location.hash), picker: false });
    followRoute();
  });

  // "/" opens the match picker, unless you are typing somewhere.
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const typing = target.closest('input, textarea, select, [contenteditable]') !== null;
    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      openPicker();
    }
  });

  if (store.get().index) {
    followRoute();
    return;
  }
  loadIndex()
    .then((index) => {
      store.set({ index });
      followRoute();
    })
    .catch(() => store.set({ indexFailed: true }));
}
