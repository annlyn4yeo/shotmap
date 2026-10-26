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
