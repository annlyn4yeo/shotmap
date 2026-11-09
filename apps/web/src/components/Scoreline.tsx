import type { BoardMeta } from '../data/board';
import './scoreline.css';

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${iso}T12:00:00Z`),
  );

/** Stage, competition and date, set small over the score. */
export function MatchLine({ board }: { board: BoardMeta }) {
  return (
    <p class="board-meta">
      <span class="label">{board.stage}</span>
      <span>
        {board.competition} {board.season}
      </span>
      <time dateTime={board.date}>{formatDate(board.date)}</time>
    </p>
  );
}

/**
 * The scoreboard: the two names and the score, in big type. A shootout says who
 * won it, once, under the score. The visual board is hidden from assistive tech
 * and the heading says the same thing in a sentence.
 */
export function Scoreline({ board }: { board: BoardMeta }) {
  const { home, away } = board;
  const shootout = home.pens !== null && away.pens !== null;
  const winner = (home.pens ?? 0) > (away.pens ?? 0) ? home : away;
  const loser = winner === home ? away : home;
  const penalties = `${winner.name} won ${winner.pens}-${loser.pens} on penalties`;

  const summary = `${home.name} ${home.score}, ${away.name} ${away.score}, ${board.competition} ${board.season} ${board.stage.toLowerCase()}${
    shootout ? `. ${penalties}` : ''
  }`;

  return (
    <>
      <h1 class="visually-hidden">{summary}</h1>
      <div class="board-score" aria-hidden="true">
        <span class="board-team board-team--home">{home.name}</span>
        <span class="board-num board-num--home num">{home.score}</span>
        <span class="board-sep">-</span>
        <span class="board-num board-num--away num">{away.score}</span>
        <span class="board-team board-team--away">{away.name}</span>
      </div>
      {shootout ? (
        <p class="board-sub" aria-hidden="true">
          {penalties}
        </p>
      ) : null}
    </>
  );
}
