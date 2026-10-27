import { OUTCOMES, type Outcome } from '@shotmap/schema';

export type TeamView = 'both' | 'home' | 'away';

/**
 * Everything that makes a match view shareable, kept in the URL: the match in the path and
 * the filters in the query. Defaults are left out, so the hero match with nothing chosen is
 * just `/`.
 *
 *   /match/3857291?team=home&player=5503&hide=off,blocked&so=1&shot=12
 *
 * Links made before path routes kept all of it in the hash (`#m=3857291&team=home&p=4...`).
 * `fromLegacyHash` turns one into the URL above, once, when the page loads.
 */
export interface Route {
  /** Match id. Null means the hero match. */
  m: number | null;
  /** Null means the default for the screen: both teams when wide, the home team when narrow. */
  team: TeamView | null;
  /** A StatsBomb player id, not an index. */
  player: number | null;
  /** Outcomes hidden by the legend filter. */
  hide: readonly Outcome[];
  /** Include the penalty shootout. */
  shootout: boolean;
  /** The selected shot: its position in the match. */
  shot: number | null;
}

export const DEFAULT_ROUTE: Route = {
  m: null,
  team: null,
  player: null,
  hide: [],
  shootout: false,
  shot: null,
};

const TEAMS: readonly TeamView[] = ['both', 'home', 'away'];

/** A whole number of at most nine digits, or null: anything else in a URL is ignored. */
export const whole = (text: string | null): number | null => {
  if (text === null || !/^\d{1,9}$/.test(text)) return null;
  return Number(text);
};

function filtersOf(
  params: URLSearchParams,
  m: number | null,
  player: string | null,
): Route {
  const team = params.get('team');
  const hide = (params.get('hide') ?? '')
    .split(',')
    .filter((o): o is Outcome => (OUTCOMES as readonly string[]).includes(o));
  return {
    m,
    team: TEAMS.find((t) => t === team) ?? null,
    player: whole(player),
    hide: [...new Set(hide)].sort(),
    shootout: params.get('so') === '1',
    shot: whole(params.get('shot')),
  };
}

/** The match view a path and query describe. The path decides the match: `/match/:id`, else the hero. */
export function parseUrl(pathname: string, search: string): Route {
  const params = new URLSearchParams(search);
  const m = /^\/match\/(\d{1,9})\/?$/.exec(pathname)?.[1];
  return filtersOf(params, m === undefined ? null : Number(m), params.get('player'));
}

/** The path and query for a route, with the defaults left out. */
export function formatUrl(route: Route): string {
  const params = new URLSearchParams();
  if (route.team !== null) params.set('team', route.team);
  if (route.player !== null) params.set('player', String(route.player));
  if (route.hide.length) params.set('hide', [...route.hide].sort().join(','));
  if (route.shootout) params.set('so', '1');
  if (route.shot !== null) params.set('shot', String(route.shot));
  const query = params.toString().replaceAll('%2C', ',');
  const path = route.m === null ? '/' : `/match/${route.m}`;
  return query ? `${path}?${query}` : path;
}

const LEGACY_KEYS = ['m', 'team', 'p', 'player', 'hide', 'so', 'shot'];

/**
 * A link made before path routes, such as `#m=3869685&team=home&p=4&shot=12`, as the URL
 * that means the same now, or null if the hash is not one. `p` was an index into the match's
 * player list and means nothing today, so it is dropped; everything else carries over, and
 * `shot` still selects the same shot.
 */
export function fromLegacyHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (!LEGACY_KEYS.some((key) => params.has(key))) return null;
  return formatUrl(filtersOf(params, whole(params.get('m')), params.get('player')));
}

/** Are any filters set? (The match and the selected shot are not filters.) */
export const isFiltered = (route: Route): boolean =>
  route.team !== null || route.player !== null || route.hide.length > 0 || route.shootout;
