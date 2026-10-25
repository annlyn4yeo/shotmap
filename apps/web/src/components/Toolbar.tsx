import type { PlayerCount } from '../lib/derive';
import { memo } from '../lib/memo';
import type { TeamView } from '../lib/route';
import { resetFilters, update } from '../state/app';
import './toolbar.css';

interface ToolbarProps {
  names: readonly [string, string];
  /** The team view in force (the route's, or the default for this screen). */
  team: TeamView;
  player: number | null;
  shootout: boolean;
  /** Is any filter set? Shows the reset button. */
  filtered: boolean;
  /** Shots per team, for the toggle's labels. */
  homeShots: number;
  awayShots: number;
  /** Players with shots in the teams being shown. */
  players: readonly PlayerCount[];
  hasShootout: boolean;
}

const animate = { animate: true } as const;

/** Team, player and shootout filters. Outcome filtering is the legend under the maps. */
export const Toolbar = memo(function Toolbar({
  names,
  team,
  player,
  shootout,
  filtered,
  homeShots,
  awayShots,
  players,
  hasShootout,
}: ToolbarProps) {
  const options: { view: TeamView; label: string; count: number }[] = [
    { view: 'both', label: 'Both', count: homeShots + awayShots },
    { view: 'home', label: names[0], count: homeShots },
    { view: 'away', label: names[1], count: awayShots },
  ];
  const grouped = team === 'both';

  const option = (p: PlayerCount) => (
    <option key={p.index} value={p.index}>
      {p.name} ({p.count})
    </option>
  );

  return (
    <div class="toolbar">
      <div class="seg" role="group" aria-label="Team">
        {options.map((o) => (
          <button
            key={o.view}
            type="button"
            aria-pressed={team === o.view}
            onClick={() => update({ team: o.view, player: null, shot: null }, animate)}
          >
            <span class="seg-label">{o.label}</span>
            <span class="num seg-count">{o.count}</span>
          </button>
        ))}
      </div>

      <label class="field">
        <span class="label">Player</span>
        <select
          class="field-select"
          value={player === null ? '' : String(player)}
          onChange={(e) => {
            const v = e.currentTarget.value;
            update({ player: v === '' ? null : Number(v), shot: null }, animate);
          }}
        >
          <option value="">
            All players ({players.reduce((n, p) => n + p.count, 0)})
          </option>
          {grouped
            ? ([0, 1] as const).map((t) => (
                <optgroup key={t} label={names[t]}>
                  {players.filter((p) => p.team === t).map(option)}
                </optgroup>
              ))
            : players.map(option)}
        </select>
      </label>

      {hasShootout ? (
        <button
          type="button"
          class="switch"
          aria-pressed={shootout}
          onClick={() => update({ shootout: !shootout, shot: null }, animate)}
        >
          <span class="switch-box" aria-hidden="true" />
          <span>Include shootout</span>
        </button>
      ) : null}

      {filtered ? (
        <button type="button" class="reset" onClick={resetFilters}>
          Reset filters
        </button>
      ) : null}
    </div>
  );
});
