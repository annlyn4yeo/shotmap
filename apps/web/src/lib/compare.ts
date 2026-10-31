import { whole } from './route';

/** Which side of the comparison. */
export type Slot = 'a' | 'b';

/**
 * Everything on the compare page that is worth a link, kept in the URL:
 *
 *   /compare?a=5503&b=5207&competition=11&season=27
 *
 * `a` and `b` are StatsBomb player ids. No competition and season means every season, for both
 * players: one scope is shared, never one player's career against the other's season. Anything
 * not understood is ignored.
 */
export interface CompareView {
  a: number | null;
  b: number | null;
  competition: number | null;
  season: number | null;
}

export const EMPTY_COMPARE: CompareView = {
  a: null,
  b: null,
  competition: null,
  season: null,
};

export function parseCompareView(search: string): CompareView {
  const params = new URLSearchParams(search);
  const a = whole(params.get('a'));
  const b = whole(params.get('b'));
  const competition = whole(params.get('competition'));
  const season = whole(params.get('season'));
  // A season only means something inside its competition: both, or neither.
  const scoped = competition !== null && season !== null;
  return {
    a,
    // A player against themselves compares nothing: the second side stays empty.
    b: b === a ? null : b,
    competition: scoped ? competition : null,
    season: scoped ? season : null,
  };
}

export function formatCompareView(view: CompareView): string {
  const params = new URLSearchParams();
  if (view.a !== null) params.set('a', String(view.a));
  if (view.b !== null) params.set('b', String(view.b));
  if (view.competition !== null && view.season !== null) {
    params.set('competition', String(view.competition));
    params.set('season', String(view.season));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** The URL of the compare page with these changes. */
export const compareUrl = (
  view: CompareView,
  change: Partial<CompareView> = {},
): string => `/compare${formatCompareView({ ...view, ...change })}`;

/** The player on one side, if there is one. */
export const playerIn = (view: CompareView, slot: Slot): number | null => view[slot];

/** The other side. */
export const otherSlot = (slot: Slot): Slot => (slot === 'a' ? 'b' : 'a');
