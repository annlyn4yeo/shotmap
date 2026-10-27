import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { PITCH, type MatchDetail, type Outcome, type Player } from '@shotmap/schema';
import { ApiError } from '../api/client';
import { DetailCard } from '../components/DetailCard';
import { OutcomeFilter } from '../components/OutcomeFilter';
import type { MapShot } from '../components/ShotLayer';
import { ShotPanel } from '../components/ShotPanel';
import { HALFWAY, useMapFrame } from '../components/useMapFrame';
import {
  loadMatchDetail,
  loadPlayer,
  loadPlayerShots,
  type PlayerShots,
} from '../data/players';
import { shotLabel, type Shot } from '../data/shots';
import { useFooterHidden } from '../lib/busy';
import { tally } from '../lib/derive';
import { markRadius } from '../lib/geometry';
import { useAfterPaint } from '../lib/hooks';
import {
  MARK_LIMIT,
  matchHref,
  narrowTo,
  parsePlayerView,
  playerUrl,
  selectedSeason,
  shotsIn,
  sortSeasons,
  type PlayerView,
  type SeasonRow,
  type SortKey,
} from '../lib/player';
import type { Page } from '../lib/router';
import { useStore } from '../lib/store';
import { claimArrival, navigate, store } from '../state/app';
import './player.css';

type Load<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'missing' }
  | { status: 'error' };

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** A mark with the shot it is for. */
type Placed = MapShot & { shot: Shot };

/** A tweak to the view replaces the history entry: Back goes to the page before, not through each one. */
const change = (id: number, view: PlayerView, patch: Partial<PlayerView>): void =>
  navigate(playerUrl(id, view, patch), { replace: true });

/** A plain click on a link that changes the view stays in the page and keeps focus where it is. */
const onPlainClick = (go: () => void) => (e: MouseEvent) => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  go();
};

const selectionName = (row: SeasonRow | undefined) =>
  row ? `${row.competition.name} ${row.season.name}` : 'Every season';

/**
 * A player: who they are, how each season went, and their shots on the pitch for the season
 * chosen in the table (every season, to start). The map is the same panel the match page uses,
 * fed with shots from many matches. Everything that can be linked to is in the URL.
 */
export default function PlayerPage({ page }: { page: Page }) {
  const id = page.name === 'player' ? page.id : 0;
  const search = useStore(store, (s) => s.search);
  const view = useMemo(() => parsePlayerView(search), [search]);
  const [profile, setProfile] = useState<Load<Player>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ask = new AbortController();
    setProfile({ status: 'loading' });
    loadPlayer(id, ask.signal).then(
      (data) => setProfile({ status: 'ready', data }),
      (error: unknown) => {
        if (ask.signal.aborted) return;
        setProfile(
          error instanceof ApiError && error.status === 404
            ? { status: 'missing' }
            : { status: 'error' },
        );
      },
    );
    return () => ask.abort();
  }, [id, attempt]);

  const name = profile.status === 'ready' ? profile.data.name : null;
  const missing = profile.status === 'missing';
  useEffect(() => {
    document.title = name
      ? `${name} | Shotmap`
      : missing
        ? 'No such player | Shotmap'
        : 'Player | Shotmap';
  }, [name, missing]);

  // Arriving here by a link, Back or a search result moves focus to the heading; tweaking the
  // view does not (it would pull focus out of the control in use).
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (profile.status !== 'loading' && claimArrival()) title.current?.focus();
  }, [id, profile.status]);

  useFooterHidden(profile.status === 'loading');

  if (profile.status === 'loading')
    return (
      <p class="status label player-wait" role="status">
        Loading the player
      </p>
    );
  if (profile.status !== 'ready')
    return (
      <section class="state" role="alert" aria-labelledby="player-missing">
        <h1 id="player-missing" class="state-title" ref={title} tabIndex={-1}>
          {profile.status === 'missing' ? 'No such player' : 'The player did not load'}
        </h1>
        <p>
          {profile.status === 'missing'
            ? 'Nobody in the data has this number.'
            : 'Check your connection and try again.'}
        </p>
        <div class="state-actions">
          {profile.status === 'error' ? (
            <button
              type="button"
              class="state-button"
              data-primary
              onClick={() => setAttempt((n) => n + 1)}
            >
              Try again
            </button>
          ) : null}
          <a class="state-button" href="/matches">
            Browse the matches
          </a>
        </div>
      </section>
    );

  const player = profile.data;
  return (
    <article class="player" aria-labelledby="player-name">
      <header class="player-head">
        <h1 id="player-name" class="player-name" ref={title} tabIndex={-1}>
          {player.name}
        </h1>
        {player.fullName !== player.name ? (
          <p class="player-full">{player.fullName}</p>
        ) : null}
        <p class="player-teams">
          {player.teams.map((t, i) => (
            <span key={t.id}>
              {i > 0 ? ' · ' : ''}
              {t.name} <span class="num">{t.shots}</span>{' '}
              {t.shots === 1 ? 'shot' : 'shots'}
            </span>
          ))}
        </p>
      </header>

      <SeasonTable player={player} view={view} />
      <ShotsSection player={player} view={view} />
    </article>
  );
}

const COLUMNS: readonly { key: SortKey; label: string }[] = [
  { key: 'when', label: 'Season' },
  { key: 'matches', label: 'Matches' },
  { key: 'shots', label: 'Shots' },
  { key: 'goals', label: 'Goals' },
  { key: 'onTarget', label: 'On target' },
  { key: 'xg', label: 'xG' },
];

/** The season-by-season table. Its headers sort it; its rows choose what the map shows. */
function SeasonTable({ player, view }: { player: Player; view: PlayerView }) {
  const rows = useMemo(
    () => sortSeasons(player.seasons, view.sort, view.dir),
    [player.seasons, view.sort, view.dir],
  );
  const chosen = selectedSeason(player.seasons, view);
  const pick = (competition: number | null, season: number | null) => ({
    href: playerUrl(player.id, view, { competition, season }),
    onClick: onPlainClick(() => change(player.id, view, { competition, season })),
  });
  const sortBy = (key: SortKey) =>
    change(player.id, view, {
      sort: key,
      // A new column starts with the biggest (or the newest) first; the same column flips.
      dir: view.sort === key && view.dir === 'desc' ? 'asc' : 'desc',
    });
  const ariaSort = (key: SortKey) =>
    view.sort !== key ? 'none' : view.dir === 'asc' ? 'ascending' : 'descending';

  return (
    <section class="seasons" aria-labelledby="seasons-title">
      <h2 id="seasons-title" class="player-section">
        By season
      </h2>
      <div class="seasons-scroll" role="region" aria-label="Seasons table" tabIndex={0}>
        <table class="seasons-table">
          <caption class="visually-hidden">
            Open-play shots by competition season. Choose a row to map it; choose a
            heading to sort.
          </caption>
          <thead>
            <tr>
              {COLUMNS.map(({ key, label }) => (
                <th
                  key={key}
                  scope="col"
                  aria-sort={ariaSort(key)}
                  data-num={key !== 'when'}
                >
                  <button type="button" class="seasons-sort" onClick={() => sortBy(key)}>
                    {label}
                    <span class="seasons-arrow" aria-hidden="true">
                      {view.sort === key ? (view.dir === 'asc' ? '↑' : '↓') : ''}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const on = row === chosen;
              return (
                <tr key={`${row.competition.id}:${row.season.id}`} data-current={on}>
                  <th scope="row">
                    <a
                      class="seasons-pick"
                      aria-current={on ? 'true' : undefined}
                      {...pick(row.competition.id, row.season.id)}
                    >
                      {row.competition.name}{' '}
                      <span class="seasons-year">{row.season.name}</span>
                    </a>
                  </th>
                  <td class="num">{row.matches}</td>
                  <td class="num">{row.shots}</td>
                  <td class="num">{row.goals}</td>
                  <td class="num">{row.onTarget}</td>
                  <td class="num">{row.xg.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr data-current={chosen === undefined}>
              <th scope="row">
                <a
                  class="seasons-pick"
                  aria-current={chosen === undefined ? 'true' : undefined}
                  {...pick(null, null)}
                >
                  Every season
                </a>
              </th>
              <td class="num">{player.totals.matches}</td>
              <td class="num">{player.totals.shots}</td>
              <td class="num">{player.totals.goals}</td>
              <td class="num">{player.totals.onTarget}</td>
              <td class="num">{player.totals.xg.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/** The shots of the chosen season (or all), as a map, or a notice when there are too many marks. */
function ShotsSection({ player, view }: { player: Player; view: PlayerView }) {
  const [shots, setShots] = useState<Exclude<Load<PlayerShots>, { status: 'missing' }>>({
    status: 'loading',
  });
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ask = new AbortController();
    // The map stays up while the next one loads, dimmed, so nothing jumps.
    setLoading(true);
    loadPlayerShots(
      player,
      { competition: view.competition, season: view.season },
      MARK_LIMIT,
      ask.signal,
    ).then(
      (data) => {
        setShots({ status: 'ready', data });
        setLoading(false);
      },
      () => {
        if (ask.signal.aborted) return;
        setShots({ status: 'error' });
        setLoading(false);
      },
    );
    return () => ask.abort();
  }, [player, view.competition, view.season, attempt]);

  const chosen = selectedSeason(player.seasons, view);
  const heading = selectionName(chosen);

  return (
    <section class="player-map" aria-labelledby="map-title" aria-busy={loading}>
      <h2 id="map-title" class="player-section">
        Shots: {heading}
      </h2>
      {shots.status === 'error' ? (
        <div class="state" role="alert">
          <h3 class="state-title">The shots did not load</h3>
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
      ) : shots.status === 'loading' ? (
        <p class="status label player-wait" role="status">
          Loading the shots
        </p>
      ) : shots.data.truncated ? (
        <TooMany player={player} view={view} />
      ) : (
        <PlayerMap
          player={player}
          view={view}
          shots={shots.data.shots}
          heading={heading}
          loading={loading}
        />
      )}
    </section>
  );
}

/** More marks than the SVG layer is for: say so, and offer the seasons that are small enough. */
function TooMany({ player, view }: { player: Player; view: PlayerView }) {
  const options = narrowTo(player).filter(
    (r) => r !== selectedSeason(player.seasons, view),
  );
  return (
    <div class="state player-many" role="status">
      <h3 class="state-title">Too many shots to draw as marks</h3>
      <p>
        There are <span class="num">{shotsIn(player, view)}</span> shots here and the map
        draws up to <span class="num">{MARK_LIMIT}</span>. A denser view is a later step.
      </p>
      {options.length ? (
        <>
          <p>Narrow it to one season:</p>
          <ul class="player-narrow">
            {options.map((r) => (
              <li key={`${r.competition.id}:${r.season.id}`}>
                <a
                  href={playerUrl(player.id, view, {
                    competition: r.competition.id,
                    season: r.season.id,
                  })}
                  onClick={onPlainClick(() =>
                    change(player.id, view, {
                      competition: r.competition.id,
                      season: r.season.id,
                    }),
                  )}
                >
                  {selectionName(r)}, <span class="num">{r.shots}</span> shots
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>No single season of theirs is small enough to draw either.</p>
      )}
    </div>
  );
}

function PlayerMap(props: {
  player: Player;
  view: PlayerView;
  shots: readonly Shot[];
  heading: string;
  loading: boolean;
}) {
  const { player, view, shots, heading, loading } = props;
  // The match plots in by minute so it reads as events in sequence; a career has no sequence, and
  // a couple of hundred marks animating on the main thread (SVG children are not composited) cost
  // far more than the effect is worth. So no intro here: the marks are simply there.
  const { stageRef, mapRef, from, frame, unitPx, intro } = useMapFrame(shots, false);
  // Keyed by what is hidden, not by the array (a new one every time the URL changes): selecting a
  // shot must not make a couple of hundred marks again.
  const hideKey = view.hide.join();
  const hidden = useMemo(
    () => new Set<Outcome>(hideKey ? (hideKey.split(',') as Outcome[]) : []),
    [hideKey],
  );
  const drawable = useMemo(() => shots.filter((s) => s.x >= HALFWAY), [shots]);
  const counts = useMemo(() => tally(drawable), [drawable]);
  // Made once, then filtered: hiding an outcome removes its marks and leaves the others be, so the
  // layer does not draw them again.
  const marks: Placed[] = useMemo(
    () =>
      drawable.map((shot) => ({
        // Shots from many matches share positions: a mark is known by the shot's global id.
        id: shot.shotId,
        outcome: shot.outcome,
        xg: shot.xg,
        label: shotLabel(shot),
        shot,
        x: shot.x,
        y: shot.y,
        ex: shot.ex,
        ey: shot.ey,
        r: markRadius(shot.xg, unitPx),
        delay: 0,
      })),
    [drawable, unitPx],
  );
  const placed = useMemo(
    () => marks.filter((p) => !hidden.has(p.outcome)),
    [marks, hidden],
  );
  const selected = placed.find((p) => p.id === view.shot);
  // The card comes one paint after the ring and the dimming that answer the tap: on a map this
  // dense, building it in the same frame was a third of what the tap cost.
  const late = useAfterPaint(selected);
  const open = selected ? late : undefined;
  const anchor = open ? frame.place(open.x, open.y) : null;
  const behind = shots.length - drawable.length;

  const select = useMemo(
    () => (shot: number | null) => change(player.id, view, { shot }),
    [player.id, view],
  );
  useEffect(() => {
    if (view.shot === null) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') change(player.id, view, { shot: null });
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [player.id, view]);

  // Which match the selected shot is from: a name, once the match has loaded.
  const matchId = open?.shot.matchId ?? null;
  const [match, setMatch] = useState<MatchDetail | null>(null);
  useEffect(() => {
    setMatch(null);
    if (matchId === null) return;
    const ask = new AbortController();
    loadMatchDetail(matchId, ask.signal).then(setMatch, () => undefined);
    return () => ask.abort();
  }, [matchId]);

  const toggle = (outcome: Outcome) =>
    change(player.id, view, {
      hide: hidden.has(outcome)
        ? view.hide.filter((o) => o !== outcome)
        : [...view.hide, outcome],
    });

  return (
    <div class="player-panel" data-loading={loading}>
      <ShotPanel
        name={heading}
        stats={shots}
        frame={frame}
        from={from}
        intro={intro}
        shots={placed}
        selectedId={selected?.id ?? null}
        onSelect={select}
        title={`Shot map of ${player.name}, ${heading}: the last ${PITCH.length - from} yards before goal.`}
        label={`${player.name}'s shots. Use the arrow keys to move between them, Enter to open one.`}
        stageRef={stageRef}
        mapRef={mapRef}
        empty={
          placed.length === 0 ? (
            <p class="player-empty">
              {shots.length === 0
                ? 'No shots here.'
                : 'Every shot here is hidden by the legend below.'}
            </p>
          ) : null
        }
        card={
          open && anchor ? (
            <DetailCard
              shot={open.shot}
              team={player.teams.find((t) => t.id === open.shot.teamId)?.name ?? ''}
              anchor={{
                x: ((anchor.x - frame.x) / frame.w) * 100,
                y: ((anchor.y - frame.y) / frame.h) * 100,
              }}
              onClose={() => change(player.id, view, { shot: null })}
            >
              <p class="player-card-match">
                <a
                  class="player-card-link"
                  href={matchHref(open.shot.matchId ?? 0, open.shot.id, open.shot.team)}
                >
                  {match
                    ? `${match.teams[0].name} v ${match.teams[1].name}, ${DATE.format(new Date(`${match.date}T12:00:00Z`))}`
                    : 'Open this match'}
                </a>
              </p>
            </DetailCard>
          ) : null
        }
      />
      <OutcomeFilter counts={counts} hidden={hidden} onToggle={toggle} />
      {behind > 0 ? (
        <p class="map-note">
          {behind} long {behind === 1 ? 'shot' : 'shots'} from behind the halfway line{' '}
          {behind === 1 ? 'is' : 'are'} not drawn.
        </p>
      ) : null}
    </div>
  );
}
