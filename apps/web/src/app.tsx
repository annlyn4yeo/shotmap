import { useEffect, useMemo, useRef } from 'preact/hooks';
import { MapSkeleton, ErrorState } from './components/States';
import { Picker, PickerButton } from './components/Picker';
import { ShotMap } from './components/ShotMap';
import { MatchLine, Scoreline } from './components/Scoreline';
import { Wordmark } from './components/Wordmark';
import { boardFromEntry, boardFromMeta, type BoardMeta } from './data/board';
import { decodeShots } from './data/shots';
import type { MatchFile } from '@shotmap/schema';
import { useDelayed } from './lib/hooks';
import { findEntry } from './lib/search';
import { useStore } from './lib/store';
import { matchIdOf, store } from './state/app';
import './app.css';

/** A load shorter than this never shows a skeleton. */
const SKELETON_AFTER_MS = 150;

export function App() {
  const index = useStore(store, (s) => s.index);
  const indexFailed = useStore(store, (s) => s.indexFailed);
  const id = useStore(store, matchIdOf);
  const match = useStore(store, (s) => s.match);

  const waiting = match.status === 'loading' || (index === null && !indexFailed);
  const slow = useDelayed(waiting, SKELETON_AFTER_MS);

  // While a match loads quickly, keep showing the last one: no flash, no half-changed page.
  const lastReady = useRef<MatchFile | null>(null);
  if (match.status === 'ready' && match.data) lastReady.current = match.data;
  const shown: MatchFile | null =
    match.status === 'ready'
      ? match.data
      : match.status === 'loading' && !slow
        ? lastReady.current
        : null;

  // The board can come from the index row alone, so it changes the instant a match is chosen.
  const board: BoardMeta | null = useMemo(() => {
    if (shown) return boardFromMeta(shown.meta);
    const entry = index && id !== null ? findEntry(index, id) : undefined;
    return entry ? boardFromEntry(entry) : null;
  }, [shown, index, id]);

  const shots = useMemo(
    () => (shown && index ? decodeShots(shown, index.enums) : []),
    [shown, index],
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
        {indexFailed ? (
          <ErrorState what="list" />
        ) : match.status === 'error' ? (
          <ErrorState what="match" />
        ) : shown && index ? (
          <ShotMap
            key={shown.meta.id}
            names={[shown.meta.teams[0].name, shown.meta.teams[1].name]}
            shots={shots}
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
