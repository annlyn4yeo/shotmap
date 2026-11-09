import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { MatchList, MatchSummary, Meta } from '@shotmap/schema';
import { loadMatchPage, loadMeta } from '../data/browse';
import {
  EMPTY_BROWSE,
  PAGE_SIZES,
  apiPathOf,
  browseUrl,
  matchesIn,
  opensGroup,
  parseBrowse,
  tallyOf,
  type BrowseQuery,
} from '../lib/browse';
import { useFooterHidden } from '../lib/hooks';
import { whole } from '../lib/route';
import { staysInApp } from '../lib/router';
import { useStore } from '../lib/store';
import { withTransition } from '../lib/transition';
import { useWindow } from '../lib/windowing';
import { claimArrival, navigate, store } from '../state/app';
import './browse.css';

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const formatDate = (iso: string) => DATE.format(new Date(`${iso}T12:00:00Z`));

const COUNT = new Intl.NumberFormat('en-GB');
/** The band's cells while the competitions are on their way: as many as the release has. */
const BLANK_TABS = [1, 2, 3, 4, 5];

const scoreOf = (m: MatchSummary) =>
  `${m.home.score}-${m.away.score}${m.home.pens !== null && m.away.pens !== null ? ` (${m.home.pens}-${m.away.pens})` : ''}`;

/**
 * Browse every match, a page at a time. Competition, season, stage, team, dates, the page size
 * and where the page starts are all in the URL, so the list can be linked to, reloaded and
 * stepped back through. Long pages draw only the rows near the screen.
 */
export default function Browse() {
  const search = useStore(store, (s) => s.search);
  const query = useMemo(() => parseBrowse(search), [search]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [list, setList] = useState<MatchList | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  // A link that arrives with these set shows them, and only then.
  const [more, setMore] = useState(
    query.stage !== null ||
      query.from !== null ||
      query.to !== null ||
      query.order !== EMPTY_BROWSE.order ||
      query.limit !== EMPTY_BROWSE.limit,
  );

  useEffect(() => {
    document.title = 'Matches | Shotmap';
  }, []);

  // Arriving here by a link, Back or a search result moves focus to the heading; tweaking a
  // filter does not (it would pull focus out of the field in use).
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (claimArrival()) title.current?.focus();
  }, [search]);

  // On a phone the ruler scrolls sideways: the chosen season is never left off its edge.
  const ruler = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = ruler.current;
    const on = nav?.querySelector<HTMLElement>('[aria-current]');
    if (nav && on) nav.scrollLeft = on.offsetLeft - nav.offsetLeft;
  }, [query.season, meta]);

  // Until the first rows arrive there is nothing above the footer, so it is not there either.
  const first = list === null && status === 'loading';
  useFooterHidden(first);

  useEffect(() => {
    const ask = new AbortController();
    loadMeta(ask.signal)
      .then(setMeta)
      .catch(() => undefined);
    return () => ask.abort();
  }, []);

  useEffect(() => {
    const ask = new AbortController();
    setStatus('loading');
    loadMatchPage(apiPathOf(query), ask.signal)
      .then((page) => {
        setList(page);
        setStatus('ready');
      })
      .catch(() => {
        if (!ask.signal.aborted) setStatus('error');
      });
    return () => ask.abort();
  }, [query, attempt]);

  /** Changing a filter replaces the entry: Back goes to the page before, not through every tweak. */
  const change = (patch: Partial<BrowseQuery>) =>
    navigate(browseUrl(query, patch), { replace: true });

  const items = list?.items ?? [];
  const rows = useWindow<HTMLOListElement>(items.length);
  const stages = new Map(meta?.stages.map((s) => [s.id, s.name]));
  const chosen = meta?.competitions.find((c) => c.id === query.competition);
  const seasons = chosen?.seasons ?? [];
  const tally = tallyOf(query, meta);

  /** A plain click replaces the entry, as every filter does, and the ink moves to the new choice. */
  const pick = (patch: Partial<BrowseQuery>) => (e: MouseEvent) => {
    if (staysInApp(e.currentTarget as HTMLAnchorElement, e)) {
      e.preventDefault();
      withTransition(() => change(patch));
    }
  };

  const teamName = items
    .flatMap((m) => [m.home, m.away])
    .find((t) => t.id === query.team)?.name;
  const filtered =
    query.competition !== null ||
    query.stage !== null ||
    query.team !== null ||
    query.from !== null ||
    query.to !== null;

  return (
    <section class="browse" aria-labelledby="browse-title">
      <div class="browse-head">
        <h1 id="browse-title" class="browse-title" ref={title} tabIndex={-1}>
          Matches
        </h1>
        {/* The whole of what is chosen. Only meta's counts: a stage, a team or dates have no total. */}
        {tally ? (
          <p class="browse-tally">
            <span class="browse-tally-value num">{COUNT.format(tally.value)}</span>
            <span class="label">{tally.label}</span>
          </p>
        ) : null}
      </div>

      {/* Links, so each can be opened in a new tab. The cells are there before the names are, so nothing moves. */}
      <nav
        class="browse-tabs"
        aria-label="Competition"
        style={`--cells:${(meta?.competitions.length ?? BLANK_TABS.length) + 1}`}
      >
        <a
          class="browse-tab"
          href={browseUrl(query, { competition: null })}
          aria-current={query.competition === null ? 'true' : undefined}
          onClick={pick({ competition: null })}
        >
          <span class="browse-tab-name">All</span>
          <span class="browse-tab-count num">
            {meta ? COUNT.format(meta.counts.matches) : ''}
            <span class="visually-hidden"> matches</span>
          </span>
        </a>
        {meta
          ? meta.competitions.map((c) => (
              <a
                key={c.id}
                class="browse-tab"
                href={browseUrl(query, { competition: c.id })}
                aria-current={query.competition === c.id ? 'true' : undefined}
                onClick={pick({ competition: c.id })}
              >
                <span class="browse-tab-name">{c.name}</span>
                <span class="browse-tab-count num">
                  {COUNT.format(matchesIn(c))}
                  <span class="visually-hidden"> matches</span>
                </span>
              </a>
            ))
          : BLANK_TABS.map((n) => <span key={n} class="browse-tab" />)}
      </nav>

      {query.competition !== null ? (
        <nav class="browse-seasons" aria-label="Season" ref={ruler}>
          {chosen ? (
            <a
              class="browse-season"
              href={browseUrl(query, { season: null })}
              aria-current={query.season === null ? 'true' : undefined}
              onClick={pick({ season: null })}
            >
              All seasons
            </a>
          ) : null}
          {seasons.map((s) => (
            <a
              key={s.id}
              class="browse-season"
              href={browseUrl(query, { season: s.id })}
              aria-current={query.season === s.id ? 'true' : undefined}
              onClick={pick({ season: s.id })}
            >
              {s.name}
              <span class="browse-season-count num">
                {COUNT.format(s.matches)}
                <span class="visually-hidden"> matches</span>
              </span>
            </a>
          ))}
        </nav>
      ) : null}

      {/* On a phone the common path comes first: the rest of the filters are one press away. */}
      <button
        type="button"
        class="browse-more"
        aria-expanded={more}
        aria-controls="browse-filters"
        onClick={() => setMore((open) => !open)}
      >
        Stage, dates and order
        <span aria-hidden="true">{more ? '−' : '+'}</span>
      </button>

      <form
        id="browse-filters"
        class="browse-filters"
        data-open={more}
        aria-label="Filter the matches"
        onSubmit={(e) => e.preventDefault()}
      >
        <label class="browse-field browse-field--stage">
          <span class="label">Stage</span>
          <select
            class="browse-input"
            value={query.stage ?? ''}
            onChange={(e) => change({ stage: whole(e.currentTarget.value) })}
          >
            <option value="">All stages</option>
            {meta?.stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label class="browse-field">
          <span class="label">From</span>
          <input
            class="browse-input"
            type="date"
            value={query.from ?? ''}
            max={query.to ?? undefined}
            onChange={(e) => change({ from: e.currentTarget.value || null })}
          />
        </label>
        <label class="browse-field">
          <span class="label">To</span>
          <input
            class="browse-input"
            type="date"
            value={query.to ?? ''}
            min={query.from ?? undefined}
            onChange={(e) => change({ to: e.currentTarget.value || null })}
          />
        </label>
        <label class="browse-field">
          <span class="label">Order</span>
          <select
            class="browse-input"
            value={query.order}
            onChange={(e) =>
              change({ order: e.currentTarget.value === 'oldest' ? 'oldest' : 'newest' })
            }
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
        <label class="browse-field">
          <span class="label">Per page</span>
          <select
            class="browse-input"
            value={query.limit}
            onChange={(e) =>
              change({ limit: whole(e.currentTarget.value) ?? query.limit })
            }
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </form>

      <div class="browse-status">
        <p class="browse-count label" role="status">
          {list === null
            ? status === 'error'
              ? ''
              : 'Loading the matches'
            : `${items.length} ${items.length === 1 ? 'match' : 'matches'}${query.cursor ? ' from here' : ''}${list.next ? ', more on the next page' : ''}`}
        </p>
        {/* The chip needs the team's name, which comes with the rows, so it and the link beside it
            appear together, once there are rows, in space the bar already holds: nothing moves. */}
        {filtered ? (
          <div class="browse-bar">
            {query.team !== null && list !== null ? (
              <a class="browse-chip" href={browseUrl(query, { team: null })}>
                Team: {teamName ?? `#${query.team}`}
                <span aria-hidden="true"> ×</span>
                <span class="visually-hidden"> (remove this filter)</span>
              </a>
            ) : null}
            {query.team === null || list !== null ? (
              <a class="browse-clear" href="/matches">
                Clear the filters
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      {status === 'error' ? (
        <div class="state" role="alert">
          <h2 class="state-title">The matches did not load</h2>
          <div class="state-actions">
            <button
              type="button"
              class="state-button"
              data-primary
              onClick={() => setAttempt((n) => n + 1)}
            >
              Try again
            </button>
          </div>
        </div>
      ) : status === 'ready' && items.length === 0 ? (
        <div class="state">
          <h2 class="state-title">No matches for these filters</h2>
          <div class="state-actions">
            <a class="state-button" href="/matches">
              Clear the filters
            </a>
          </div>
        </div>
      ) : (
        <ol
          class="browse-list"
          ref={rows.ref}
          aria-busy={status === 'loading'}
          data-first={first || undefined}
          style={`padding-top:${rows.before}px;padding-bottom:${rows.after}px`}
        >
          {items.slice(rows.start, rows.end).map((m, i) => (
            <li key={m.id} aria-posinset={rows.start + i + 1} aria-setsize={items.length}>
              <a
                class="browse-row"
                href={`/match/${m.id}`}
                data-opens={
                  opensGroup(items[rows.start + i - 1], m, stages.get(m.stage)) ||
                  undefined
                }
              >
                <span class="browse-teams">
                  <span class="browse-home">{m.home.name}</span>
                  <span class="browse-v"> v </span>
                  <span class="browse-away">{m.away.name}</span>
                </span>
                <span class="browse-score num">{scoreOf(m)}</span>
                <span class="browse-sub label">
                  <span class="browse-stage">{stages.get(m.stage) ?? ''}</span>
                  <span class="browse-comma">{stages.has(m.stage) ? ', ' : ''}</span>
                  <span class="browse-date">{formatDate(m.date)}</span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}

      {list && (query.cursor || list.next) ? (
        <nav class="browse-pages" aria-label="Pages of matches">
          {query.cursor ? (
            <a class="browse-page" href={browseUrl(query, { cursor: null })}>
              First page
            </a>
          ) : (
            <span />
          )}
          {list.next ? (
            <a
              class="browse-page"
              rel="next"
              href={browseUrl(query, { cursor: list.next })}
            >
              Next page
            </a>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}
