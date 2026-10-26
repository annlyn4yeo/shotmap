import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Shot } from '../data/shots';
import { OUTCOMES, PITCH, type Outcome } from '@shotmap/schema';
import { playerCounts, placeShootout, tally, teamsOf } from '../lib/derive';
import { isFiltered } from '../lib/route';
import { OUTCOME_LABEL, markRadius } from '../lib/geometry';
import { BOTH, WIDE, useMedia, useSize, useWidth } from '../lib/hooks';
import { useStore } from '../lib/store';
import { resetFilters, store, toggleOutcome, update } from '../state/app';
import { DetailCard } from './DetailCard';
import { OutcomeFilter } from './OutcomeFilter';
import { Pitch } from './Pitch';
import { ShotLayer, type MapShot } from './ShotLayer';
import { StatsStrip } from './StatsStrip';
import { EmptyNote } from './States';
import { Toolbar } from './Toolbar';
import { fitFrom, frameFor } from './frame';
import './shotmap.css';

interface ShotMapProps {
  names: readonly [string, string];
  /** Every shot in the match, shootout kicks included and flagged, in match order. */
  shots: readonly Shot[];
}

const HALFWAY = PITCH.length / 2;
/** The intro lasts about this long, then the layer goes quiet so filtering never replays it. */
const INTRO_MS = 3200;
/** Match minute to intro delay: the match plays out over about two seconds. */
const delayFor = (min: number) => Math.round(80 + (Math.min(min, 125) / 125) * 1700);

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
 * Where to start the crop. Nearly every shot is taken within 35 yards of goal,
 * so the pitch is shown from just behind the deepest shot in the match, in
 * steps of 10 yards. Both teams share it, so the two panels compare directly.
 */
function cropFrom(shots: readonly Shot[]): number {
  const xs = shots.filter((s) => !s.shootout && s.x >= HALFWAY).map((s) => s.x);
  const deepest = xs.length ? Math.min(...xs) : HALFWAY;
  return Math.min(100, Math.max(HALFWAY, Math.floor((deepest - 3) / 10) * 10));
}

export function ShotMap({ names, shots }: ShotMapProps) {
  const route = useStore(store, (s) => s.route);
  const wide = useMedia(WIDE);
  const reduced = useMedia('(prefers-reduced-motion: reduce)');
  const roomy = useMedia(BOTH);
  const teamView = route.team ?? (roomy ? 'both' : 'home');
  const teams = teamsOf(teamView);

  const dataFrom = useMemo(() => cropFrom(shots), [shots]);
  const stageRef = useRef<HTMLDivElement>(null);
  const stage = useSize(stageRef);
  // Wide: the map fills the room its panel has, showing more pitch when there is height to spare.
  const from = wide ? fitFrom(stage, dataFrom) : dataFrom;
  const frame = useMemo(() => frameFor('half', 'vertical', from), [from]);
  const mapRef = useRef<HTMLDivElement>(null);
  const width = useWidth(mapRef);
  const unitPx = (width || 343) / frame.w;

  const [introTimer, setIntroTimer] = useState(true);
  const intro = introTimer && !reduced;

  useEffect(() => {
    const timer = setTimeout(() => setIntroTimer(false), INTRO_MS);
    return () => clearTimeout(timer);
  }, []);

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

  const mapShots: MapShot[] = useMemo(
    () =>
      view.shown.map((shot) => {
        const at = placed.get(shot.id) ?? { x: shot.x, y: shot.y };
        return {
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
  const selected = mapShots.find((x) => x.shot.id === route.shot);

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
      <section
        class="panel"
        aria-label={`${names[t]} shots`}
        key={t}
        style={`view-transition-name:panel-${t}`}
      >
        <h2 class="panel-name">{names[t]}</h2>
        <StatsStrip shots={byTeam[t]} />
        <div ref={first ? stageRef : null} class="stage">
          <div class="map-frame" style={`--ratio:${(frame.w / frame.h).toFixed(4)}`}>
            <div ref={first ? mapRef : null} class="map" data-intro={intro}>
              <Pitch
                title={`Shot map of ${names[t]}, the last ${PITCH.length - from} yards before goal. ${describe(
                  names[t],
                  mine.map((s) => s.shot),
                )}`}
                mode="half"
                orientation="vertical"
                from={from}
              />
              <ShotLayer
                frame={frame}
                shots={mine}
                selectedId={chosen?.shot.id ?? null}
                intro={intro}
                label={`${names[t]} shots. Use the arrow keys to move between them, Enter to open one.`}
                onSelect={selectShot}
              />
            </div>
            {mine.length === 0 ? (
              <EmptyNote
                filtered={shots.some((s) => s.team === t && !s.shootout)}
                team={names[t]}
                onReset={resetFilters}
              />
            ) : null}
            {chosen && anchor ? (
              <DetailCard
                shot={chosen.shot}
                team={names[t]}
                anchor={{
                  x: ((anchor.x - frame.x) / frame.w) * 100,
                  y: ((anchor.y - frame.y) / frame.h) * 100,
                }}
                onClose={() => update({ shot: null })}
              />
            ) : null}
          </div>
        </div>
      </section>
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
