import { useEffect, useMemo, useRef } from 'preact/hooks';
import { MapSkeleton, ErrorState } from './components/States';
import { Picker, PickerButton } from './components/Picker';
import { ShotMap } from './components/ShotMap';
import { MatchLine, Scoreline } from './components/Scoreline';
import { Wordmark } from './components/Wordmark';
import { LazyPage } from './components/lazy';
import { boardFromDetail, type BoardMeta } from './data/board';
import type { LoadedMatch } from './data/match';
import { useDelayed } from './lib/hooks';
import { useStore } from './lib/store';
import { claimArrival, store } from './state/app';
import './app.css';

/** A load shorter than this never shows a skeleton. */
const SKELETON_AFTER_MS = 150;

function Credit() {
  return (
    <footer class="credit">
      <span class="credit-logo" data-slot="statsbomb-logo" aria-hidden="true" />
      <p>
        Data by{' '}
        <a href="https://statsbomb.com" rel="noopener">
          StatsBomb
        </a>
        .
      </p>
    </footer>
  );
}

/** The match page: `/` and `/match/:id`. The first thing on the screen, so it is in the first file. */
function MatchPage() {
  const match = useStore(store, (s) => s.match);

  const slow = useDelayed(match.status === 'loading', SKELETON_AFTER_MS);

  // While a match loads quickly, keep showing the last one: no flash, no half-changed page.
  const lastReady = useRef<LoadedMatch | null>(null);
  if (match.status === 'ready' && match.data) lastReady.current = match.data;
  const shown: LoadedMatch | null =
    match.status === 'ready'
      ? match.data
      : match.status === 'loading' && !slow
        ? lastReady.current
        : null;

  // Nothing here waits for anything but the match: it brings its own teams, score and players.
  const board: BoardMeta | null = useMemo(
    () => (shown ? boardFromDetail(shown.detail) : null),
    [shown],
  );

  useEffect(() => {
    document.title = board
      ? `${board.home.name} v ${board.away.name}, ${board.competition} ${board.season} ${board.stage.toLowerCase()} | Shotmap`
      : 'Shotmap';
  }, [board]);

  return (
    <div class="app">
      <header class="board">
        <div class="board-inner">
          <div class="board-top">
            <Wordmark />
            {board ? <MatchLine board={board} /> : <span class="board-meta" />}
            <PickerButton />
          </div>
          {board ? <Scoreline board={board} /> : null}
        </div>
      </header>

      <main class="main">
        {match.status === 'error' ? (
          <ErrorState what="match" />
        ) : shown ? (
          <ShotMap
            key={shown.detail.id}
            names={[shown.detail.teams[0].name, shown.detail.teams[1].name]}
            shots={shown.shots}
          />
        ) : slow ? (
          <MapSkeleton from={80} />
        ) : null}
      </main>

      <Credit />
      <Picker />
    </div>
  );
}

function Missing() {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = 'No such page | Shotmap';
    if (claimArrival()) heading.current?.focus();
  }, []);
  return (
    <section class="state" aria-labelledby="missing-title">
      <h1 id="missing-title" class="state-title" ref={heading} tabIndex={-1}>
        No such page
      </h1>
      <p>Nothing lives at this address.</p>
      <div class="state-actions">
        <a class="state-button" data-primary href="/">
          The 2022 final
        </a>
        <a class="state-button" href="/matches">
          Browse the matches
        </a>
      </div>
    </section>
  );
}

/** Every other page: the same paper and header, without a scoreboard, and it scrolls. */
function OtherPage() {
  const page = useStore(store, (s) => s.page);
  return (
    <div class="app" data-flow>
      <header class="board">
        <div class="board-inner">
          <div class="board-top">
            <a class="home-link" href="/" aria-label="Shotmap, home">
              <Wordmark />
            </a>
            <nav class="board-meta" aria-label="Main">
              <a class="nav-link" href="/matches">
                All matches
              </a>
              <a class="nav-link" href="/compare">
                Compare
              </a>
            </nav>
            <PickerButton />
          </div>
        </div>
      </header>

      <main class="main">
        {page.name === 'missing' ? <Missing /> : <LazyPage page={page} />}
      </main>

      <Credit />
      <Picker />
    </div>
  );
}

export function App() {
  const page = useStore(store, (s) => s.page);
  return page.name === 'match' ? <MatchPage /> : <OtherPage />;
}
