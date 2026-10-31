import { LIMITS, OUTCOMES, type Outcome, type Player } from '@shotmap/schema';
import { whole } from './route';

/**
 * How many marks the SVG layer is given. Above this the marks are painted on a canvas instead
 * (DESIGN.md section 9); `VITE_MARK_LIMIT` lowers it for a build, to see the canvas with data that
 * never reaches 300.
 */
export const MARK_LIMIT = Number(import.meta.env.VITE_MARK_LIMIT) || 300;

/** The most shots the page asks for. A selection with more is shown as density alone. */
export const SHOTS_MAX = LIMITS.playerShotsMax;

export type Renderer = 'svg' | 'canvas';

/**
 * Which layer draws a selection's marks. It follows the number of shots the selection holds, not
 * how many the legend leaves showing, so hiding an outcome never swaps the layer.
 */
export const rendererFor = (count: number): Renderer =>
  count > MARK_LIMIT ? 'canvas' : 'svg';

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
  /** The map shows the shots themselves, or how many fell in each square of the pitch. */
  mode: MapMode;
  hide: readonly Outcome[];
  shot: number | null;
  /** The square in focus in the density view. */
  bin: { gx: number; gy: number } | null;
  sort: SortKey;
  dir: 'asc' | 'desc';
}

export type MapMode = 'shots' | 'density';

export const DEFAULT_VIEW: PlayerView = {
  competition: null,
  season: null,
  mode: 'shots',
  hide: [],
  shot: null,
  bin: null,
  sort: 'when',
  dir: 'desc',
};

/** A global shot id has ten digits, one more than `whole` allows. */
const shotId = (text: string | null): number | null =>
  text !== null && /^\d{1,13}$/.test(text) ? Number(text) : null;

/** `54-19`: the square 54 along and 19 across, whatever its size in yards. */
function binOf(text: string | null): { gx: number; gy: number } | null {
  const m = text === null ? null : /^(\d{1,3})-(\d{1,3})$/.exec(text);
  return m ? { gx: Number(m[1]), gy: Number(m[2]) } : null;
}

export function parsePlayerView(search: string): PlayerView {
  const params = new URLSearchParams(search);
  const competition = whole(params.get('competition'));
  const season = whole(params.get('season'));
  const sort = params.get('sort');
  const dir = params.get('dir');
  const mode: MapMode = params.get('view') === 'density' ? 'density' : 'shots';
  const hide = (params.get('hide') ?? '')
    .split(',')
    .filter((o): o is Outcome => (OUTCOMES as readonly string[]).includes(o));
  return {
    // A season only means something inside its competition: both, or neither.
    competition: competition !== null && season !== null ? competition : null,
    season: competition !== null && season !== null ? season : null,
    mode,
    hide: [...new Set(hide)].sort(),
    // A shot belongs to the shots view and a square to the density one.
    shot: mode === 'shots' ? shotId(params.get('shot')) : null,
    bin: mode === 'density' ? binOf(params.get('bin')) : null,
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
  if (view.mode !== DEFAULT_VIEW.mode) params.set('view', view.mode);
  if (view.hide.length) params.set('hide', [...view.hide].sort().join(','));
  if (view.mode === 'shots' && view.shot !== null) params.set('shot', String(view.shot));
  if (view.mode === 'density' && view.bin)
    params.set('bin', `${view.bin.gx}-${view.bin.gy}`);
  if (view.sort !== DEFAULT_VIEW.sort) params.set('sort', view.sort);
  if (view.dir !== DEFAULT_VIEW.dir) params.set('dir', view.dir);
  const query = params.toString().replaceAll('%2C', ',');
  return query ? `?${query}` : '';
}

/**
 * The URL of a player's page with these changes. Choosing another season, another set of
 * outcomes or the other view drops the selected shot and square (they are probably not in what
 * comes next); sorting the table changes nothing else.
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
    change.hide !== undefined ||
    change.mode !== undefined
  ) {
    next.shot = change.shot ?? null;
    next.bin = change.bin ?? null;
  }
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

/** How to use the keyboard list beside a canvas, said once, in the summary. */
export const KEYS_HINT =
  'Tab goes to the list, the arrow keys move along it, Page Up and Page Down jump ten, Home and End go to the ends, Enter opens one and Escape closes it.';

const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

/**
 * The shots map in words, for the page and for a screen reader: how many are drawn, how many of
 * those scored, and how many the legend hides. `drawn` and `goals` are what is on the map.
 */
export function describeShots(drawn: number, goals: number, hidden: number): string {
  if (drawn === 0)
    return hidden > 0 ? 'Every shot here is hidden by the legend.' : 'No shots here.';
  return (
    `${count(drawn, 'shot')} on the map, ${count(goals, 'goal')}` +
    (hidden > 0 ? `; ${count(hidden, 'more shot')} hidden by the legend` : '') +
    `. ${KEYS_HINT}`
  );
}

/** The match a shot belongs to, with the shot selected and its side in view. */
export const matchHref = (matchId: number, seq: number, side: 0 | 1): string =>
  `/match/${matchId}?team=${side === 0 ? 'home' : 'away'}&shot=${seq}`;
