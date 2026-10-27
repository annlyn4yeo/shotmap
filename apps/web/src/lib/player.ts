import { OUTCOMES, type Outcome, type Player } from '@shotmap/schema';
import { whole } from './route';

/**
 * How many marks the SVG layer is given. Above this the page shows a notice and offers to narrow
 * the selection instead (a Canvas layer for more arrives in M10). `VITE_MARK_LIMIT` lowers it
 * for a build, to see the notice with data that never reaches 300.
 */
export const MARK_LIMIT = Number(import.meta.env.VITE_MARK_LIMIT) || 300;

export type SeasonRow = Player['seasons'][number];

/** A column of the season table. `when` is the season's place in time. */
export type SortKey = 'when' | 'matches' | 'shots' | 'goals' | 'onTarget' | 'xg';
export const SORT_KEYS: readonly SortKey[] = [
  'when',
  'matches',
  'shots',
  'goals',
  'onTarget',
  'xg',
];

/**
 * Everything on the player page that is worth a link, kept in the URL:
 *
 *   /players/5503?competition=43&season=106&hide=off,blocked&shot=3869685012&sort=shots&dir=desc
 *
 * No competition and season means every season. `shot` is the shot's global id (match * 1000 +
 * position), because shots from many matches share positions. Anything not understood is ignored.
 */
export interface PlayerView {
  competition: number | null;
  season: number | null;
  hide: readonly Outcome[];
  shot: number | null;
  sort: SortKey;
  dir: 'asc' | 'desc';
}

export const DEFAULT_VIEW: PlayerView = {
  competition: null,
  season: null,
  hide: [],
  shot: null,
  sort: 'when',
  dir: 'desc',
};

/** A global shot id has ten digits, one more than `whole` allows. */
const shotId = (text: string | null): number | null =>
  text !== null && /^\d{1,13}$/.test(text) ? Number(text) : null;

export function parsePlayerView(search: string): PlayerView {
  const params = new URLSearchParams(search);
  const competition = whole(params.get('competition'));
  const season = whole(params.get('season'));
  const sort = params.get('sort');
  const dir = params.get('dir');
  const hide = (params.get('hide') ?? '')
    .split(',')
    .filter((o): o is Outcome => (OUTCOMES as readonly string[]).includes(o));
  return {
    // A season only means something inside its competition: both, or neither.
    competition: competition !== null && season !== null ? competition : null,
    season: competition !== null && season !== null ? season : null,
    hide: [...new Set(hide)].sort(),
    shot: shotId(params.get('shot')),
    sort: SORT_KEYS.find((k) => k === sort) ?? DEFAULT_VIEW.sort,
    dir: dir === 'asc' || dir === 'desc' ? dir : DEFAULT_VIEW.dir,
  };
}

export function formatPlayerView(view: PlayerView): string {
  const params = new URLSearchParams();
  if (view.competition !== null && view.season !== null) {
    params.set('competition', String(view.competition));
    params.set('season', String(view.season));
  }
  if (view.hide.length) params.set('hide', [...view.hide].sort().join(','));
  if (view.shot !== null) params.set('shot', String(view.shot));
  if (view.sort !== DEFAULT_VIEW.sort) params.set('sort', view.sort);
  if (view.dir !== DEFAULT_VIEW.dir) params.set('dir', view.dir);
  const query = params.toString().replaceAll('%2C', ',');
  return query ? `?${query}` : '';
}

/**
 * The URL of a player's page with these changes. Choosing another season drops the selected shot
 * (it is probably not in it); sorting the table changes nothing else.
 */
export function playerUrl(
  id: number,
  view: PlayerView,
  change: Partial<PlayerView> = {},
): string {
  const next = { ...view, ...change };
  if (
    change.competition !== undefined ||
    change.season !== undefined ||
    change.hide !== undefined
  )
    next.shot = change.shot ?? null;
  return `/players/${id}${formatPlayerView(next)}`;
}

/**
 * The season table in order. `when` is the order the API gives (oldest first); the others are
 * the figure, and ties fall back to time, so the order is the same on every load.
 */
export function sortSeasons(
  rows: readonly SeasonRow[],
  key: SortKey,
  dir: 'asc' | 'desc',
): SeasonRow[] {
  const at = new Map(rows.map((row, i) => [row, i]));
  const when = (a: SeasonRow, b: SeasonRow) => (at.get(a) ?? 0) - (at.get(b) ?? 0);
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) =>
    key === 'when' ? sign * when(a, b) : sign * (a[key] - b[key]) || when(a, b),
  );
}

/** The row the view selects, if it selects one. */
export const selectedSeason = (
  rows: readonly SeasonRow[],
  view: PlayerView,
): SeasonRow | undefined =>
  rows.find((r) => r.competition.id === view.competition && r.season.id === view.season);

/** How many open-play shots the selection holds: the row's, or the career's. */
export const shotsIn = (profile: Player, view: PlayerView): number =>
  selectedSeason(profile.seasons, view)?.shots ?? profile.totals.shots;

/** The seasons small enough to draw, busiest first: where to narrow to from a selection too big. */
export const narrowTo = (profile: Player): SeasonRow[] =>
  profile.seasons
    .filter((r) => r.shots > 0 && r.shots <= MARK_LIMIT)
    .sort(
      (a, b) => b.shots - a.shots || a.competition.name.localeCompare(b.competition.name),
    );

/** The match a shot belongs to, with the shot selected and its side in view. */
export const matchHref = (matchId: number, seq: number, side: 0 | 1): string =>
  `/match/${matchId}?team=${side === 0 ? 'home' : 'away'}&shot=${seq}`;
