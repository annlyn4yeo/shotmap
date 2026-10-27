import { useEffect, useMemo } from 'preact/hooks';
import { OUTCOMES, PITCH, type Outcome } from '@shotmap/schema';
import { shotLabel, type Shot } from '../data/shots';
import { placeShootout, playerCounts, tally, teamsOf } from '../lib/derive';
import { OUTCOME_LABEL, markRadius } from '../lib/geometry';
import { BOTH, useMedia } from '../lib/hooks';
import { isFiltered } from '../lib/route';
import { useStore } from '../lib/store';
import { resetFilters, store, toggleOutcome, update } from '../state/app';
import { DetailCard } from './DetailCard';
import { OutcomeFilter } from './OutcomeFilter';
import type { MapShot } from './ShotLayer';
import { ShotPanel } from './ShotPanel';
import { EmptyNote } from './States';
import { Toolbar } from './Toolbar';
import { HALFWAY, delayFor, useMapFrame } from './useMapFrame';
import './shotmap.css';

interface ShotMapProps {
  names: readonly [string, string];
  /** Every shot in the match, shootout kicks included and flagged, in match order. */
  shots: readonly Shot[];
}

/** A mark with the shot it is for, which the cards and the per-team split need. */
type Placed = MapShot & { shot: Shot };

/** Module level, so the layer's props stay the same between renders. */
const selectShot = (id: number | null): void => update({ shot: id });

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

function describe(name: string, shots: readonly Shot[]): string {
  const c = tally(shots);
  const parts = OUTCOMES.filter((o) => c[o] > 0).map(
    (o) => `${c[o]} ${OUTCOME_LABEL[o].toLowerCase()}`,
  );
  return `${name}: ${plural(shots.length, 'shot')}${parts.length ? `, ${parts.join(', ')}` : ''}.`;
}

/**
 * A match: the pipeline from the URL's filters (team, player, outcomes, shootout, the selected
 * shot) to what each team's panel draws. The panels themselves are `ShotPanel`.
 */
export function ShotMap({ names, shots }: ShotMapProps) {
  const route = useStore(store, (s) => s.route);
  const roomy = useMedia(BOTH);
  const teamView = route.team ?? (roomy ? 'both' : 'home');
  const teams = teamsOf(teamView);

  // Both teams share a crop, so the two panels compare directly.
  const { stageRef, mapRef, from, frame, unitPx, intro } = useMapFrame(shots);

  // Derived data, each step memoised on only what it reads.
  const hidden = useMemo(() => new Set<Outcome>(route.hide), [route.hide]);
  const hasShootout = useMemo(() => shots.some((s) => s.shootout), [shots]);
  const inScope = useMemo(
    () => shots.filter((s) => route.shootout || !s.shootout),
    [shots, route.shootout],
  );
  const pool = useMemo(
    () => inScope.filter((s) => route.player === null || s.playerId === route.player),
    [inScope, route.player],
  );
  const byTeam = useMemo(
    () => [pool.filter((s) => s.team === 0), pool.filter((s) => s.team === 1)] as const,
    [pool],
  );
  const players = useMemo(
    () => playerCounts(inScope.filter((s) => teams.includes(s.team))),
    // `teams` is derived from teamView.
    [inScope, teamView],
  );
  const placed = useMemo(() => placeShootout(pool), [pool]);
  const view = useMemo(() => {
    const inView = pool.filter((s) => teams.includes(s.team));
    const drawable = inView.filter((s) => s.x >= HALFWAY);
    return {
      inView: inView.length,
      drawable,
      counts: tally(drawable),
      shown: drawable.filter((s) => !hidden.has(s.outcome)),
    };
    // `teams` is derived from teamView.
  }, [pool, teamView, hidden]);

  const mapShots: Placed[] = useMemo(
    () =>
      view.shown.map((shot) => {
        const at = placed.get(shot.id) ?? { x: shot.x, y: shot.y };
        return {
          // In a match a shot is known by its position in it.
          id: shot.id,
          outcome: shot.outcome,
          xg: shot.xg,
          label: shotLabel(shot),
          shot,
          x: at.x,
          y: at.y,
          ex: shot.ex,
          ey: shot.ey,
          r: markRadius(shot.xg, unitPx),
          delay: delayFor(shot.min),
        };
      }),
    [view.shown, placed, unitPx],
  );

  const perTeam = useMemo(
    () =>
      [
        mapShots.filter((x) => x.shot.team === 0),
        mapShots.filter((x) => x.shot.team === 1),
      ] as const,
    [mapShots],
  );
  const homeShots = useMemo(() => inScope.filter((x) => x.team === 0).length, [inScope]);
  const awayShots = useMemo(() => inScope.filter((x) => x.team === 1).length, [inScope]);
  const selected = mapShots.find((x) => x.id === route.shot);

  useEffect(() => {
    if (route.shot === null) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') update({ shot: null });
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [route.shot]);

  const behind = view.inView - view.drawable.length;
  const panel = (t: 0 | 1, first: boolean) => {
    const mine = perTeam[t];
    const chosen = selected && selected.shot.team === t ? selected : undefined;
    const anchor = chosen ? frame.place(chosen.x, chosen.y) : null;
    return (
      <ShotPanel
        key={t}
        name={names[t]}
        stats={byTeam[t]}
        frame={frame}
        from={from}
        intro={intro}
        shots={mine}
        selectedId={chosen?.id ?? null}
        onSelect={selectShot}
        title={`Shot map of ${names[t]}, the last ${PITCH.length - from} yards before goal. ${describe(
          names[t],
          mine.map((s) => s.shot),
        )}`}
        label={`${names[t]} shots. Use the arrow keys to move between them, Enter to open one.`}
        stageRef={first ? stageRef : null}
        mapRef={first ? mapRef : null}
        transitionName={`panel-${t}`}
        empty={
          mine.length === 0 ? (
            <EmptyNote
              filtered={shots.some((s) => s.team === t && !s.shootout)}
              team={names[t]}
              onReset={resetFilters}
            />
          ) : null
        }
        card={
          chosen && anchor ? (
            <DetailCard
              shot={chosen.shot}
              team={names[t]}
              anchor={{
                x: ((anchor.x - frame.x) / frame.w) * 100,
                y: ((anchor.y - frame.y) / frame.h) * 100,
              }}
              onClose={() => update({ shot: null })}
            />
          ) : null
        }
      />
    );
  };

  return (
    <section class="shotmap" aria-label="Shot map">
      <Toolbar
        names={names}
        team={teamView}
        player={route.player}
        shootout={route.shootout}
        filtered={isFiltered(route)}
        homeShots={homeShots}
        awayShots={awayShots}
        players={players}
        hasShootout={hasShootout}
      />

      <div class="panels" data-count={teams.length}>
        {teams.map((t, i) => panel(t, i === 0))}
      </div>

      <OutcomeFilter counts={view.counts} hidden={hidden} onToggle={toggleOutcome} />

      {behind > 0 ? (
        <p class="map-note">
          {plural(behind, 'long shot')} from behind the halfway line{' '}
          {behind === 1 ? 'is' : 'are'} not drawn.
        </p>
      ) : null}
      {route.shootout && hasShootout ? (
        <p class="map-note">
          Shootout kicks are all taken from the penalty spot, so they are fanned out in a
          row, in the order they were taken.
        </p>
      ) : null}
    </section>
  );
}
