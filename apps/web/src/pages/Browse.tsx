import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { MatchList, MatchSummary, Meta } from '@shotmap/schema';
import { loadMatchPage, loadMeta } from '../data/browse';
import {
  PAGE_SIZES,
  apiPathOf,
  browseUrl,
  parseBrowse,
  type BrowseQuery,
} from '../lib/browse';
import { useFooterHidden } from '../lib/busy';
import { whole } from '../lib/route';
import { useStore } from '../lib/store';
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

  useEffect(() => {
    document.title = 'Matches | Shotmap';
  }, []);

  // Arriving here by a link, Back or a search result moves focus to the heading; tweaking a
  // filter does not (it would pull focus out of the field in use).
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (claimArrival()) title.current?.focus();
  }, [search]);

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
  const seasons =
    meta?.competitions.find((c) => c.id === query.competition)?.seasons ?? [];
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
      <h1 id="browse-title" class="browse-title" ref={title} tabIndex={-1}>
        Matches
      </h1>

      <form
        class="browse-filters"
        aria-label="Filter the matches"
        onSubmit={(e) => e.preventDefault()}
      >
        <label class="browse-field">
          <span class="label">Competition</span>
          <select
            class="browse-input"
            value={query.competition ?? ''}
            onChange={(e) => change({ competition: whole(e.currentTarget.value) })}
          >
            <option value="">All competitions</option>
            {meta?.competitions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label class="browse-field">
          <span class="label">Season</span>
          <select
            class="browse-input"
            disabled={query.competition === null}
            value={query.season ?? ''}
            onChange={(e) => change({ season: whole(e.currentTarget.value) })}
          >
            <option value="">
              {query.competition === null ? 'Pick a competition' : 'All seasons'}
            </option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label class="browse-field">
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
      <p class="browse-count label" role="status">
        {list === null
          ? status === 'error'
            ? ''
            : 'Loading the matches'
          : `${items.length} ${items.length === 1 ? 'match' : 'matches'}${query.cursor ? ' from here' : ''}${list.next ? ', more on the next page' : ''}`}
      </p>

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
              <a class="browse-row" href={`/match/${m.id}`}>
                <span class="browse-teams">
                  {m.home.name} v {m.away.name}
                </span>
                <span class="browse-score num">{scoreOf(m)}</span>
                <span class="browse-sub label">
                  {stages.get(m.stage) ?? ''}
                  {stages.has(m.stage) ? ', ' : ''}
                  {formatDate(m.date)}
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
