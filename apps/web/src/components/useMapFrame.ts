import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { PITCH } from '@shotmap/schema';
import type { Shot } from '../data/shots';
import { WIDE, useMedia, useSize, useWidth } from '../lib/hooks';
import { fitFrom, frameFor } from './frame';

export const HALFWAY = PITCH.length / 2;
/** The intro lasts about this long, then the layer goes quiet so filtering never replays it. */
const INTRO_MS = 3200;
/** Match minute to intro delay: the match plays out over about two seconds. */
export const delayFor = (min: number) =>
  Math.round(80 + (Math.min(min, 125) / 125) * 1700);

/**
 * Where to start the crop. Nearly every shot is taken within 35 yards of goal, so the pitch is
 * shown from just behind the deepest shot, in steps of 10 yards. Panels that share a crop
 * compare directly.
 */
export function cropFrom(shots: readonly Shot[]): number {
  const xs = shots.filter((s) => !s.shootout && s.x >= HALFWAY).map((s) => s.x);
  const deepest = xs.length ? Math.min(...xs) : HALFWAY;
  return Math.min(100, Math.max(HALFWAY, Math.floor((deepest - 3) / 10) * 10));
}

/**
 * The frame every shot panel is drawn in, whatever its data: how much of the pitch to show, how
 * big a yard is on screen (so a mark's size can follow its xG), and whether the intro still
 * plays (`intro` false for a source with no sequence to play, which then never starts the timer).
 * Put `stageRef` and `mapRef` on the first panel's stage and map, which are measured.
 */
export function useMapFrame(shots: readonly Shot[], plays = true) {
  const wide = useMedia(WIDE);
  const reduced = useMedia('(prefers-reduced-motion: reduce)');
  const dataFrom = useMemo(() => cropFrom(shots), [shots]);
  const stageRef = useRef<HTMLDivElement>(null);
  const stage = useSize(stageRef);
  // Wide: the map fills the room its panel has, showing more pitch when there is height to spare.
  const from = wide ? fitFrom(stage, dataFrom) : dataFrom;
  const frame = useMemo(() => frameFor('half', 'vertical', from), [from]);
  const mapRef = useRef<HTMLDivElement>(null);
  const width = useWidth(mapRef);
  const unitPx = (width || 343) / frame.w;

  const [introTimer, setIntroTimer] = useState(plays);
  useEffect(() => {
    if (!plays) return;
    const timer = setTimeout(() => setIntroTimer(false), INTRO_MS);
    return () => clearTimeout(timer);
  }, [plays]);

  return { stageRef, mapRef, from, frame, unitPx, intro: introTimer && !reduced };
}
