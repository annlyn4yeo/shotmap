import type { Shot } from '../data/shots';
import { PITCH, type Outcome } from '@shotmap/schema';
import type { TeamView } from './route';

export const teamsOf = (view: TeamView): readonly (0 | 1)[] =>
  view === 'both' ? [0, 1] : view === 'home' ? [0] : [1];

export const tally = (shots: readonly Shot[]): Record<Outcome, number> => {
  const counts: Record<Outcome, number> = {
    goal: 0,
    saved: 0,
    off: 0,
    blocked: 0,
    post: 0,
  };
  for (const s of shots) counts[s.outcome]++;
  return counts;
};

export interface TeamStats {
  shots: number;
  onTarget: number;
  goals: number;
  xg: number;
  /** Goals minus expected goals. */
  delta: number;
  /** The shot with the highest xG (the earliest if tied). */
  biggest: Shot | null;
}

/** On target means a goal or a save. */
export function teamStats(shots: readonly Shot[]): TeamStats {
  const c = tally(shots);
  const xg = shots.reduce((sum, s) => sum + s.xg, 0);
  let biggest: Shot | null = null;
  for (const s of shots) if (!biggest || s.xg > biggest.xg) biggest = s;
  return {
    shots: shots.length,
    onTarget: c.goal + c.saved,
    goals: c.goal,
    xg,
    delta: c.goal - xg,
    biggest,
  };
}

export interface PlayerCount {
  /** The StatsBomb player id: what the URL and the filter use. */
  id: number;
  name: string;
  team: 0 | 1;
  count: number;
}

/** Players who took a shot, most shots first. */
export function playerCounts(shots: readonly Shot[]): PlayerCount[] {
  const byPlayer = new Map<number, PlayerCount>();
  for (const s of shots) {
    const known = byPlayer.get(s.playerId);
    if (known) known.count++;
    else
      byPlayer.set(s.playerId, {
        id: s.playerId,
        name: s.player,
        team: s.team,
        count: 1,
      });
  }
  return [...byPlayer.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );
}

/**
 * Every shootout kick is logged at the penalty spot, so drawn as they are they
 * would sit on one point. Fan each team's kicks out in a row across the spot,
 * in the order they were taken. Returns the drawn position for those shots.
 */
export function placeShootout(
  shots: readonly Shot[],
): Map<number, { x: number; y: number }> {
  const placed = new Map<number, { x: number; y: number }>();
  for (const team of [0, 1] as const) {
    const kicks = shots.filter((s) => s.shootout && s.team === team);
    const step = Math.min(7, (PITCH.width - 16) / Math.max(1, kicks.length));
    kicks.forEach((s, k) => {
      placed.set(s.id, {
        x: s.x,
        y: PITCH.width / 2 + (k - (kicks.length - 1) / 2) * step,
      });
    });
  }
  return placed;
}
