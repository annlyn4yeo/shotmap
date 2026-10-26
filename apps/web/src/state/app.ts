import { loadIndex, loadMatch, readMatch, whenIdleUnlessSavingData } from '../data/load';
import type { Catalog, LoadedMatch } from '../data/match';
import { HERO_MATCH_ID, type Outcome } from '@shotmap/schema';
import { createStore } from '../lib/store';
import { DEFAULT_ROUTE, formatHash, parseHash, type Route } from '../lib/route';
import { withTransition } from '../lib/transition';

interface MatchState {
  id: number;
  status: 'loading' | 'ready' | 'error';
  data: LoadedMatch | null;
}

export interface AppState {
  /** The match list, for the picker. It loads when the browser is idle, so nothing waits for it. */
  index: Catalog | null;
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
export const matchIdOf = (state: AppState): number => state.route.m ?? HERO_MATCH_ID;

// Loading

/** Load the match list once; a failure is remembered until the next ask, which tries again. */
export function ensureIndex(): void {
  if (store.get().index) return;
  loadIndex()
    .then((index) => store.set({ index, indexFailed: false }))
    .catch(() => store.set({ indexFailed: true }));
}

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
  if (state.match.id === id && state.match.status !== 'error') return;
  const cached = readMatch(id);
  if (cached) store.set({ match: { id, status: 'ready', data: cached } });
  else startLoad(id);
}

export function retryMatch(): void {
  startLoad(matchIdOf(store.get()));
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
  update({ ...DEFAULT_ROUTE, m: id === HERO_MATCH_ID ? null : id }, { animate: true });
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

export const openPicker = (): void => {
  store.set({ picker: true });
  ensureIndex();
};
export const closePicker = (): void => store.set({ picker: false });

// Start-up

/** Read the URL, load what it points at, and keep the two in step. Call once. */
export function init(): void {
  // The inlined hero is read by seedFromDocument before this runs, so the first view needs no request.
  store.set({ route: parseHash(location.hash) });

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

  followRoute();
  whenIdleUnlessSavingData(ensureIndex);
}
