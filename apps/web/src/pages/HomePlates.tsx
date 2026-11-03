import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Player } from '@shotmap/schema';
import { DensityCells } from '../components/Density';
import { Pitch } from '../components/Pitch';
import { ShotLayer, type MapShot } from '../components/ShotLayer';
import { frameFor } from '../components/frame';
import { loadPlayer, loadPlayerDensity, loadPlayerShots } from '../data/players';
import { shotLabel, type Shot } from '../data/shots';
import {
  DENSITY_STEP,
  binsOf,
  busiest,
  classRanges,
  drawableBins,
  type Bin,
} from '../lib/density';
import { markRadius } from '../lib/geometry';
import { BOTH, useMedia, useSeen, useWidth } from '../lib/hooks';
import { DEFAULT_ROUTE, formatUrl } from '../lib/route';
import { seasonSpan } from '../lib/seasons';
import { navigate } from '../state/app';

/**
 * The home page's two plates that ask the API for their data: a player's shots in one competition
 * and a career's density. This file is fetched (with the density layer and the player loaders) only
 * when one of them first comes near the screen, so the first view of the home page does not carry
 * it. Each plate's markup is its placeholder's in Home.tsx with the drawing and the caption filled
 * in, so nothing moves when it arrives.
 */

/** Both plates show the last 40 yards, fixed, so their shape is known before their data is. */
export const PLATE_FROM = 80;
const FRAME = frameFor('half', 'vertical', PLATE_FROM);
const nf = new Intl.NumberFormat('en-GB');
/** More than anyone has in one competition in the data; the plate says so if it is ever not. */
const SHOTS_LIMIT = 600;

const plural = (n: number, one: string, many = `${one}s`) =>
  `${nf.format(n)} ${n === 1 ? one : many}`;

// A player's shots in one competition

interface Shots {
  profile: Player;
  shots: Shot[];
  truncated: boolean;
}

/**
 * Every shot a player took in one competition, over all its seasons, on the attacking end. A
 * couple of hundred marks from many matches have no sequence to play, and a mark each plotting in
 * is what made the player page slow (docs/adr/0009): the layer fades in as one when the plate is
 * first seen, as the player page's does. A mark opens that shot on its match page.
 */
export function CompetitionPlate({
  player,
  competition,
}: {
  player: number;
  competition: number;
}) {
  const [data, setData] = useState<Shots | 'error' | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    loadPlayer(player, signal)
      .then(async (profile) => ({
        profile,
        ...(await loadPlayerShots(
          profile,
          { competition, season: null },
          SHOTS_LIMIT,
          signal,
        )),
      }))
      .then(setData, () => {
        if (!signal.aborted) setData('error');
      });
    return () => controller.abort();
  }, [player, competition]);

  const frameRef = useRef<HTMLDivElement>(null);
  const width = useWidth(frameRef);
  const unitPx = (width || 320) / FRAME.w;
  const roomy = useMedia(BOTH);
  const reduced = useMedia('(prefers-reduced-motion: reduce)');
  // The data is asked for a little before the plate is on screen; the marks wait until a third of
  // it is, so their arriving is seen and not played to nobody.
  const seen = useSeen(frameRef, 0.35);
  const ready = data !== null && data !== 'error';
  const shown = ready && (seen || reduced);

  const shots = ready ? data.shots : [];
  const drawn = useMemo(() => shots.filter((s) => s.x >= PLATE_FROM), [shots]);
  const marks: MapShot[] = useMemo(
    () =>
      drawn.map((s) => ({
        // Positions repeat from match to match; the global id does not.
        id: s.shotId,
        outcome: s.outcome,
        xg: s.xg,
        label: shotLabel(s),
        x: s.x,
        y: s.y,
        ex: s.ex,
        ey: s.ey,
        r: markRadius(s.xg, unitPx),
        delay: 0,
      })),
    [drawn, unitPx],
  );

  const open = (id: number | null) => {
    const shot = drawn.find((s) => s.shotId === id);
    if (!shot || shot.matchId === null) return;
    // Wide, the match page shows both teams; narrow, the side the shot was for.
    const team = roomy ? null : shot.team === 0 ? 'home' : 'away';
    navigate(formatUrl({ ...DEFAULT_ROUTE, m: shot.matchId, team, shot: shot.id }));
  };

  const rows = ready
    ? data.profile.seasons.filter((r) => r.competition.id === competition)
    : [];
  const name = ready ? data.profile.name : '';
  const where = rows[0]?.competition.name ?? '';
  const matches = rows.reduce((n, r) => n + r.matches, 0);
  const goals = drawn.filter((s) => s.outcome === 'goal').length;
  const outside = shots.length - drawn.length;

  return (
    <figure class="plate">
      <div ref={frameRef} class="map-frame" style={`--ratio:${FRAME.w} / ${FRAME.h}`}>
        <div class="map" data-fade>
          <Pitch
            title={
              ready
                ? `${name}'s ${plural(drawn.length, 'shot')} in the ${where}, ${nf.format(goals)} of them goals`
                : 'The shots, not yet loaded'
            }
            from={PLATE_FROM}
          />
          {shown ? (
            <ShotLayer
              frame={FRAME}
              shots={marks}
              selectedId={null}
              intro={false}
              label={`${name}'s shots in the ${where}. Choose one to open it on its match page.`}
              onSelect={open}
            />
          ) : null}
        </div>
      </div>
      <figcaption class="plate-caption plate-caption--lazy">
        {data === 'error' ? (
          <span>The shots could not be loaded.</span>
        ) : ready ? (
          <span>
            {plural(drawn.length, 'shot')} in {plural(matches, 'match', 'matches')},{' '}
            {seasonSpan(rows.map((r) => r.season.name))}. {plural(goals, 'goal')}.
            {outside > 0 ? ` ${nf.format(outside)} from beyond 40 yards not drawn.` : ''}
            {data.truncated ? ' Only the first ones are drawn.' : ''} Choose a mark to
            open that shot.
          </span>
        ) : (
          <span>{' '}</span>
        )}
      </figcaption>
    </figure>
  );
}

// A player's density, in one competition or the whole career

export function DensityPlate({
  player,
  name,
  competition,
}: {
  player: number;
  name: string;
  /** Every season of one competition; null for the whole career. */
  competition: number | null;
}) {
  const [bins, setBins] = useState<Bin[] | 'error' | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    loadPlayerDensity(
      { id: player },
      { competition, season: null },
      null,
      controller.signal,
    ).then(
      (d) => setBins(binsOf(d)),
      () => {
        if (!controller.signal.aborted) setBins('error');
      },
    );
    return () => controller.abort();
  }, [player, competition]);

  const drawable = useMemo(
    () => (Array.isArray(bins) ? drawableBins(bins, DENSITY_STEP, PLATE_FROM) : []),
    [bins],
  );
  const max = busiest(drawable);
  const total = Array.isArray(bins) ? bins.reduce((t, b) => t + b.n, 0) : 0;
  const outside = total - drawable.reduce((t, b) => t + b.n, 0);
  const ranges = max ? classRanges(max) : [];

  return (
    <figure class="plate">
      <div class="map-frame" style={`--ratio:${FRAME.w} / ${FRAME.h}`}>
        <div class="map">
          <Pitch
            title={
              Array.isArray(bins)
                ? `${name}'s shots counted in two-yard squares, darker where there are more`
                : `${name}'s squares, not yet loaded`
            }
            from={PLATE_FROM}
          >
            {drawable.length ? (
              <DensityCells bins={drawable} step={DENSITY_STEP} max={max} />
            ) : null}
          </Pitch>
        </div>
      </div>
      <figcaption class="plate-caption plate-caption--lazy density-caption">
        {bins === 'error' ? (
          <span>The squares could not be loaded.</span>
        ) : (
          <>
            <span class="tint-key" aria-hidden="true">
              {ranges.map((r) => (
                <span key={r.cls} class="tint" data-class={r.cls} />
              ))}
            </span>
            <span>
              {Array.isArray(bins) ? (
                <>
                  <span class="num">{nf.format(total)}</span> shots. The darkest square
                  holds <span class="num">{nf.format(max)}</span>.
                  {outside > 0 ? (
                    <>
                      {' '}
                      <span class="num">{nf.format(outside)}</span> from beyond 40 yards{' '}
                      {outside === 1 ? 'is' : 'are'} not drawn.
                    </>
                  ) : null}
                </>
              ) : (
                ' '
              )}
            </span>
          </>
        )}
      </figcaption>
    </figure>
  );
}
