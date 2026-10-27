import { loadMatch, readMatch } from '../data/load';
import type { LoadedMatch } from '../data/match';
import { HERO_MATCH_ID, type Outcome } from '@shotmap/schema';
import { createStore } from '../lib/store';
import {
  DEFAULT_ROUTE,
  formatUrl,
  fromLegacyHash,
  parseUrl,
  type Route,
} from '../lib/route';
import { pageOf, staysInApp, type Page } from '../lib/router';
import { withTransition } from '../lib/transition';

interface MatchState {
  id: number;
  status: 'loading' | 'ready' | 'error';
  data: LoadedMatch | null;
}

export interface AppState {
  /** Which page the path is. */
  page: Page;
  /** The query string, with its `?`, for the pages that keep their filters in it. */
  search: string;
  /** The match view's state: the match and its filters. Defaults when another page is showing. */
  route: Route;
  match: MatchState;
  picker: boolean;
}

export const store = createStore<AppState>({
  page: { name: 'match' },
  search: '',
  route: DEFAULT_ROUTE,
  match: { id: 0, status: 'loading', data: null },
  picker: false,
});

/** The match the route points at: its own, or the hero. */
export const matchIdOf = (state: AppState): number => state.route.m ?? HERO_MATCH_ID;

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
  if (state.match.id === id && state.match.status !== 'error') return;
  const cached = readMatch(id);
  if (cached) store.set({ match: { id, status: 'ready', data: cached } });
  else startLoad(id);
}

export function retryMatch(): void {
  startLoad(matchIdOf(store.get()));
}

// The URL

/** Set when a move to another page has not yet been announced to the user by moving focus. */
let arrived = false;

/**
 * Asked by a page when it shows: should focus go to its heading? True once after a move to the
 * page (a link, Back, a search result), so a keyboard or screen reader user lands where the page
 * starts, and never after a filter tweak (it would pull focus out of the field in use) or on the
 * first load.
 */
export function claimArrival(): boolean {
  const was = arrived;
  arrived = false;
  return was;
}

/** Read the location into the store. The path says which page, and the match page reads its match and filters from it. */
function syncLocation(focus: boolean): void {
  const { pathname, search } = location;
  const page = pageOf(pathname);
  store.set({
    page,
    search,
    route: page.name === 'match' ? parseUrl(pathname, search) : DEFAULT_ROUTE,
    picker: false,
  });
  arrived = focus && page.name !== 'match';
  if (page.name === 'match') followRoute();
}

/** Go to a page of the app: a new history entry, so Back returns. `replace` swaps the current one. */
export function navigate(url: string, options: { replace?: boolean } = {}): void {
  history[options.replace ? 'replaceState' : 'pushState'](null, '', url);
  syncLocation(!options.replace);
}

/**
 * Change the match view. A new match is a new history entry, so Back returns to the
 * last one; changing a filter only replaces the current entry. With `animate`,
 * the change runs in a view transition.
 */
export function update(patch: Partial<Route>, options: { animate?: boolean } = {}): void {
  const before = store.get().route;
  const route: Route = { ...before, ...patch };
  const commit = () => {
    store.set({ route });
    const push = route.m !== before.m;
    history[push ? 'pushState' : 'replaceState'](null, '', formatUrl(route));
    if (push) followRoute();
  };
  if (options.animate) withTransition(commit);
  else commit();
}

/** Go to a match with a clean slate: no filters, nothing selected. */
export function openMatch(id: number): void {
  const url = formatUrl({ ...DEFAULT_ROUTE, m: id === HERO_MATCH_ID ? null : id });
  if (store.get().page.name === 'match') withTransition(() => navigate(url));
  else navigate(url);
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
  // A link from before path routes keeps its hash; turn it into the URL that means the same.
  const legacy = fromLegacyHash(location.hash);
  if (legacy) history.replaceState(null, '', legacy);
  // The inlined hero is read by seedFromDocument before this runs, so the first view needs no request.
  syncLocation(false);

  window.addEventListener('popstate', () => syncLocation(true));

  // A plain click on a link to another page of the app stays in the page.
  document.addEventListener('click', (e) => {
    const link = (e.target as Element).closest('a');
    if (link && staysInApp(link, e)) {
      e.preventDefault();
      navigate(link.pathname + link.search);
    }
  });

  // "/" opens the search, unless you are typing somewhere.
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const typing = target.closest('input, textarea, select, [contenteditable]') !== null;
    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      openPicker();
    }
  });
}
