import { useEffect, useMemo, useRef } from 'preact/hooks';
import { MapSkeleton, ErrorState } from './components/States';
import { Picker, PickerButton } from './components/Picker';
import { ShotMap } from './components/ShotMap';
import { MatchLine, Scoreline } from './components/Scoreline';
import { Wordmark } from './components/Wordmark';
import { boardFromDetail, boardFromEntry, type BoardMeta } from './data/board';
import type { LoadedMatch } from './data/match';
import { useDelayed } from './lib/hooks';
import { findEntry } from './lib/search';
import { useStore } from './lib/store';
import { matchIdOf, store } from './state/app';
import './app.css';

/** A load shorter than this never shows a skeleton. */
const SKELETON_AFTER_MS = 150;

export function App() {
  const index = useStore(store, (s) => s.index);
  const id = useStore(store, matchIdOf);
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

  // The board can come from the match-list row alone, so it changes the instant a match
  // is chosen. Nothing here waits for the list: the match brings its own.
  const board: BoardMeta | null = useMemo(() => {
    if (shown) return boardFromDetail(shown.detail);
    const entry = index ? findEntry(index, id) : undefined;
    return entry ? boardFromEntry(entry) : null;
  }, [shown, index, id]);

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

      <Picker />
    </div>
  );
}
