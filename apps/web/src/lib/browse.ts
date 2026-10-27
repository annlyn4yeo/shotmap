import { whole } from './route';

/**
 * The browse page's whole state, kept in the URL, so a link, Back and a refresh all land on
 * the same list:
 *
 *   /matches?competition=43&season=106&stage=7&team=779&from=2022-11-20&to=2022-12-18&limit=100&cursor=...
 *
 * Newest first is the default and is not written down; `order=oldest` is. Anything missing or not understood is ignored, so a hand-edited URL never breaks the page.
 */
export const PAGE_SIZES = [50, 100, 200] as const;

export interface BrowseQuery {
  competition: number | null;
  season: number | null;
  stage: number | null;
  team: number | null;
  /** First day, YYYY-MM-DD. */
  from: string | null;
  /** Last day, YYYY-MM-DD. */
  to: string | null;
  /** The latest matches come first unless this says otherwise. */
  order: 'newest' | 'oldest';
  limit: number;
  /** Where the page starts: the API's opaque cursor from the page before. */
  cursor: string | null;
}

export const EMPTY_BROWSE: BrowseQuery = {
  competition: null,
  season: null,
  stage: null,
  team: null,
  from: null,
  to: null,
  order: 'newest',
  limit: PAGE_SIZES[0],
  cursor: null,
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CURSOR = /^[\w-]{1,40}$/;

export function parseBrowse(search: string): BrowseQuery {
  const params = new URLSearchParams(search);
  const day = (key: string) => {
    const value = params.get(key);
    return value !== null && DAY.test(value) ? value : null;
  };
  const competition = whole(params.get('competition'));
  const limit = whole(params.get('limit'));
  const cursor = params.get('cursor');
  return {
    competition,
    // A season only means something inside its competition.
    season: competition === null ? null : whole(params.get('season')),
    stage: whole(params.get('stage')),
    team: whole(params.get('team')),
    from: day('from'),
    to: day('to'),
    order: params.get('order') === 'oldest' ? 'oldest' : 'newest',
    limit: PAGE_SIZES.find((size) => size === limit) ?? EMPTY_BROWSE.limit,
    cursor: cursor !== null && CURSOR.test(cursor) ? cursor : null,
  };
}

/** The pairs both the page's URL and the API's query are made of, in one fixed order. */
function pairsOf(q: BrowseQuery): [string, string][] {
  const pairs: [string, string][] = [];
  const add = (key: string, value: string | number | null) => {
    if (value !== null) pairs.push([key, String(value)]);
  };
  add('competition', q.competition);
  add('season', q.competition === null ? null : q.season);
  add('stage', q.stage);
  add('team', q.team);
  add('from', q.from);
  add('to', q.to);
  add('order', q.order === EMPTY_BROWSE.order ? null : q.order);
  add('limit', q.limit === EMPTY_BROWSE.limit ? null : q.limit);
  add('cursor', q.cursor);
  return pairs;
}

const queryOf = (pairs: [string, string][]) =>
  pairs.length ? `?${new URLSearchParams(pairs).toString()}` : '';

/** The query string for the page's URL, with the defaults left out. */
export const formatBrowse = (q: BrowseQuery): string => queryOf(pairsOf(q));

/** The API request for a page of this list. */
export function apiPathOf(q: BrowseQuery): string {
  // The API's own default is oldest first, so the order is always said, and so is the limit.
  const pairs = pairsOf(q).filter(([key]) => key !== 'limit' && key !== 'order');
  return `/v1/matches${queryOf([...pairs, ['order', q.order], ['limit', String(q.limit)]])}`;
}

/** The URL of the list with these changes. A new filter starts again from the first page. */
export function browseUrl(q: BrowseQuery, change: Partial<BrowseQuery> = {}): string {
  const next = { ...q, cursor: null, ...change };
  // Another competition has other seasons.
  if (change.competition !== undefined && change.competition !== q.competition)
    next.season = null;
  return `/matches${formatBrowse(next)}`;
}
