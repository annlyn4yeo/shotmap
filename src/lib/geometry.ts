export type Outcome = 'goal' | 'saved' | 'off' | 'blocked' | 'post';

export const OUTCOMES: readonly Outcome[] = ['goal', 'saved', 'off', 'blocked', 'post'];

export const OUTCOME_LABEL: Record<Outcome, string> = {
  goal: 'Goal',
  saved: 'Saved',
  off: 'Off target',
  blocked: 'Blocked',
  post: 'Post',
};

/** What each outcome looks like, so the legend can say it in words too. */
export const OUTCOME_SHAPE: Record<Outcome, string> = {
  goal: 'Solid disc, ring, centre dot',
  saved: 'Hatched ring',
  off: 'Cross',
  blocked: 'Solid square',
  post: 'Open triangle',
};

/** Attacking half, goal at the top. Units are StatsBomb yards. */
export const HALF = { width: 80, depth: 60 } as const;

/**
 * StatsBomb pitch: 120 x 80, attacking left to right, origin top-left.
 * Rotate it so the attack runs up the screen and the goal sits on the top edge.
 */
export function project(x: number, y: number): { x: number; y: number } {
  return { x: y, y: 120 - x };
}

/** Mark radius in pitch units. Area grows with xG, with a floor so 0.01 stays visible. */
export function markRadius(xg: number): number {
  const clamped = Math.min(1, Math.max(0, xg));
  return 1.1 + 4.4 * Math.sqrt(clamped);
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
