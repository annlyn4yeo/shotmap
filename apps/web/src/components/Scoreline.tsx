import type { BoardMeta, BoardTeam } from '../data/board';
import './scoreline.css';

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${iso}T12:00:00Z`),
  );

/** Stage, competition and date, set small beside the wordmark. */
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
 * The scoreboard: both teams in big type, in the same two columns as the shot
 * panels below. A shootout shows in brackets and in words. The visual board is
 * hidden from assistive tech and the heading says the same thing in a sentence.
 */
export function Scoreline({ board }: { board: BoardMeta }) {
  const { home, away } = board;
  const shootout = home.pens !== null && away.pens !== null;
  const winner = (home.pens ?? 0) > (away.pens ?? 0) ? home : away;
  const loser = winner === home ? away : home;

  const summary = `${home.name} ${home.score}, ${away.name} ${away.score}, ${board.competition} ${board.season} ${board.stage.toLowerCase()}${
    shootout ? `. ${winner.name} won ${winner.pens}-${loser.pens} on penalties` : ''
  }`;

  const column = (team: BoardTeam, other: BoardTeam) => (
    <div class="board-col">
      <div class="board-row">
        <span class="board-team">{team.name}</span>
        <span class="board-num num">
          {team.score}
          {team.pens !== null ? <span class="board-pens">({team.pens})</span> : null}
        </span>
      </div>
      {shootout ? (
        <p class="board-sub" data-won={team === winner}>
          {team === winner ? 'Won' : 'Lost'} on penalties, {team.pens}-{other.pens}
        </p>
      ) : null}
    </div>
  );

  return (
    <>
      <h1 class="visually-hidden">{summary}</h1>
      <div class="board-score" aria-hidden="true">
        {column(home, away)}
        {column(away, home)}
      </div>
    </>
  );
}
