import type { Outcome } from '@shotmap/schema';
import type { MapShot } from '../components/ShotLayer';
import { markRadius } from './geometry';

/** A small seeded generator (mulberry32): the same marks every time, so a measurement can be repeated. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** About what a career looks like: most shots from inside 20 yards, near the middle, few from far out. */
const MEAN_DISTANCE = 11;

/**
 * Synthetic shots for the stress page (`/dev/stress`): `count` marks laid out like a heavy
 * career, in all five outcomes, sized by an xG that falls with distance and angle. Positions are
 * in pitch coordinates (attacking x = 120); `unitPx` sizes the marks as the real layer does. Not
 * data: it is here so a layer can be pushed past anything a player has.
 */
export function synthMarks(count: number, unitPx: number, seed = 20261027): MapShot[] {
  const next = seeded(seed);
  return Array.from({ length: count }, (_, id) => {
    const distance = Math.min(42, 3 + -Math.log(1 - next()) * MEAN_DISTANCE);
    const angle = (next() - 0.5) * 2.2;
    const x = Math.round((120 - distance * Math.cos(angle)) * 10) / 10;
    const y =
      Math.round(Math.min(78, Math.max(2, 40 + distance * Math.sin(angle))) * 10) / 10;
    const xg =
      Math.round(
        Math.max(0.01, 0.55 * Math.exp(-distance / 9) * Math.cos(angle)) * 1000,
      ) / 1000;
    const roll = next();
    const outcome: Outcome =
      roll < xg
        ? 'goal'
        : roll < xg + (1 - xg) * 0.36
          ? 'saved'
          : roll < xg + (1 - xg) * 0.64
            ? 'off'
            : roll < xg + (1 - xg) * 0.96
              ? 'blocked'
              : 'post';
    return {
      id,
      outcome,
      xg,
      label: `Synthetic shot ${id + 1}, ${outcome}, ${xg.toFixed(2)} expected goals`,
      x,
      y,
      ex: 120,
      ey: Math.round((36 + next() * 8) * 10) / 10,
      r: markRadius(xg, unitPx),
      delay: 0,
    };
  });
}
