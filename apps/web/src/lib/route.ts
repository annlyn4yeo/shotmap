import { OUTCOMES, type Outcome } from './geometry';

export type TeamView = 'both' | 'home' | 'away';

/**
 * Everything that makes a view shareable, kept in the URL hash. Defaults are
 * left out, so the plain hero page has an empty hash.
 *
 *   #m=3869685&team=home&p=4&hide=off,blocked&so=1&shot=12
 */
export interface Route {
  /** Match id. Null means the hero match. */
  m: number | null;
  /** Null means the default for the screen: both teams when wide, the home team when narrow. */
  team: TeamView | null;
  /** Index into the match's player list. */
  player: number | null;
  /** Outcomes hidden by the legend filter. */
  hide: readonly Outcome[];
  /** Include the penalty shootout. */
  shootout: boolean;
  /** The selected shot. */
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

const whole = (text: string | null): number | null => {
  if (text === null || !/^\d{1,9}$/.test(text)) return null;
  return Number(text);
};

export function parseHash(hash: string): Route {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const team = params.get('team');
  const hide = (params.get('hide') ?? '')
    .split(',')
    .filter((o): o is Outcome => (OUTCOMES as readonly string[]).includes(o));
  return {
    m: whole(params.get('m')),
    team: TEAMS.find((t) => t === team) ?? null,
    player: whole(params.get('p')),
    hide: [...new Set(hide)].sort(),
    shootout: params.get('so') === '1',
    shot: whole(params.get('shot')),
  };
}

/** The hash for a route, including the leading #, or an empty string for the defaults. */
export function formatHash(route: Route): string {
  const params = new URLSearchParams();
  if (route.m !== null) params.set('m', String(route.m));
  if (route.team !== null) params.set('team', route.team);
  if (route.player !== null) params.set('p', String(route.player));
  if (route.hide.length) params.set('hide', [...route.hide].sort().join(','));
  if (route.shootout) params.set('so', '1');
  if (route.shot !== null) params.set('shot', String(route.shot));
  const text = params.toString().replaceAll('%2C', ',');
  return text ? `#${text}` : '';
}

/** Are any filters set? (The match and the selected shot are not filters.) */
export const isFiltered = (route: Route): boolean =>
  route.team !== null || route.player !== null || route.hide.length > 0 || route.shootout;
