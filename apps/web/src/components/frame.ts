import { PITCH } from '@shotmap/schema';

export type PitchMode = 'full' | 'half';
export type Orientation = 'horizontal' | 'vertical';

/**
 * How a pitch sits in its viewBox. Shots and pitch lines are always drawn in
 * StatsBomb units (120 x 80, attacking toward x = 120). For a vertical pitch the
 * whole drawing is rotated once, by `transform` on a single group, so no
 * coordinate is ever converted by hand. Text must stay upright, so it is placed
 * with `place()` instead.
 */
export interface Frame {
  mode: PitchMode;
  orientation: Orientation;
  /** Left edge of what is drawn, in pitch x. 0 for the full pitch, 60 for the attacking half. */
  xMin: number;
  viewBox: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rotation for pitch-space content, or undefined when none is needed. */
  transform: string | undefined;
  /** Pitch coordinates to viewBox coordinates. */
  place: (x: number, y: number) => { x: number; y: number };
}

const MARGIN = 6;
const TOP = 4.5;
const BOTTOM = 3;
/** Room, in CSS px, the sheet's double neatline needs round the map on each side. */
export const NEATLINE_PX = 7;

/**
 * `from` crops the pitch to start at that x (60 to 118), for a close-up of the
 * attacking end. Without it, `half` starts at the halfway line and `full` at 0.
 */
export function frameFor(
  mode: PitchMode,
  orientation: Orientation,
  from?: number,
): Frame {
  const xMin = from ?? (mode === 'full' ? 0 : PITCH.length / 2);
  const length = PITCH.length - xMin;

  if (orientation === 'horizontal') {
    const x = xMin - MARGIN;
    const w = PITCH.length + MARGIN - x;
    const h = PITCH.width + TOP + MARGIN;
    return {
      mode,
      orientation,
      xMin,
      viewBox: `${x} ${-TOP} ${w} ${h}`,
      x,
      y: -TOP,
      w,
      h,
      transform: undefined,
      place: (px, py) => ({ x: px, y: py }),
    };
  }

  // Goal at the top: pitch x runs up the screen, pitch y runs left to right.
  const w = PITCH.width + 2 * MARGIN;
  const h = length + TOP + BOTTOM;
  return {
    mode,
    orientation,
    xMin,
    viewBox: `${-MARGIN} ${-TOP} ${w} ${h}`,
    x: -MARGIN,
    y: -TOP,
    w,
    h,
    transform: `matrix(0 -1 1 0 0 ${PITCH.length})`,
    place: (px, py) => ({ x: py, y: PITCH.length - px }),
  };
}

/**
 * On a wide screen, where to start a vertical close-up so the map exactly fills
 * a box of this size. It never starts later than `dataFrom` (so every shot stays
 * in view) or earlier than the halfway line.
 */
export function fitFrom(box: { w: number; h: number }, dataFrom: number): number {
  const w = box.w - 2 * NEATLINE_PX;
  const h = box.h - 2 * NEATLINE_PX;
  if (w <= 0 || h <= 0) return dataFrom;
  const depth = ((PITCH.width + 2 * MARGIN) * h) / w - TOP - BOTTOM;
  return Math.min(dataFrom, Math.max(PITCH.length / 2, Math.round(PITCH.length - depth)));
}
