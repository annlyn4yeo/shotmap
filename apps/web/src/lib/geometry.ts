import type { Outcome } from '@shotmap/schema';

export const OUTCOME_LABEL: Record<Outcome, string> = {
  goal: 'Goal',
  saved: 'Saved',
  off: 'Off target',
  blocked: 'Blocked',
  post: 'Post',
};

/** Radius is proportional to sqrt(xG), so a mark's area is proportional to xG. */
const AREA_K = 3.6;
/** Smallest mark radius on screen, in CSS pixels, so a 0.01 xG shot stays visible. */
const MIN_RADIUS_PX = 7;

/**
 * Mark radius in pitch units. `unitPx` is how many CSS pixels one pitch unit is
 * on screen, which keeps the minimum a fixed size at every pitch scale.
 */
export function markRadius(xg: number, unitPx: number): number {
  const clamped = Math.min(1, Math.max(0, xg));
  return Math.max(AREA_K * Math.sqrt(clamped), MIN_RADIUS_PX / unitPx);
}

/**
 * From this many marks a map is drawn quiet (DESIGN.md section 4): a scale made for a match's thirty
 * shots stops fitting at about a hundred and forty, where its marks would cover the whole penalty
 * box. It follows the selection, never the legend, so a filter does not restyle the map.
 */
export const QUIET_FROM = 100;
export const isQuiet = (marks: number): boolean => marks >= QUIET_FROM;

const QUIET_AREA_K = 1.7;
/** Up to this many marks the quiet scale is `QUIET_AREA_K`; past it, it shrinks with their number. */
const QUIET_FULL = 250;
const QUIET_MIN_PX = 2.6;
const QUIET_GOAL_MIN_PX = 4;

/**
 * A mark's radius on a quiet map of `marks` marks. Area still follows xG within a map. The scale
 * falls with the square root of the number of marks past `QUIET_FULL`, so the map's total ink stays
 * about the same and a career of thousands does not close up the way a fixed scale would. The floors
 * are low because tapping never relied on them (the layers find the nearest mark within 24 px).
 */
export function quietRadius(
  xg: number,
  outcome: Outcome,
  unitPx: number,
  marks: number,
): number {
  const clamped = Math.min(1, Math.max(0, xg));
  const k = QUIET_AREA_K * Math.min(1, Math.sqrt(QUIET_FULL / Math.max(1, marks)));
  const floor = outcome === 'goal' ? QUIET_GOAL_MIN_PX : QUIET_MIN_PX;
  return Math.max(k * Math.sqrt(clamped), floor / unitPx);
}

/** Draw order: big marks first, small on top, goals last of all. */
export function drawOrder<T extends { xg: number; outcome: Outcome }>(
  shots: readonly T[],
): T[] {
  return [...shots].sort((a, b) => {
    if ((a.outcome === 'goal') !== (b.outcome === 'goal'))
      return a.outcome === 'goal' ? 1 : -1;
    return b.xg - a.xg;
  });
}
