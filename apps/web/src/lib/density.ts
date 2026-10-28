import { PITCH, type Density } from '@shotmap/schema';

/** The bin size the player page asks for: two yards, about 11 px on a phone. */
export const DENSITY_STEP = 2;

/** Tints in the ramp (`--density-1` to `--density-6`, DESIGN.md section 9). */
export const CLASSES = 6;

/**
 * Which of the six tints a bin takes: the square root of its count against the busiest bin's,
 * rounded up, so the lightest tint is "some" and the darkest is "the most". Two maps compared with
 * each other take the same `max`. 0 for an empty bin, which is not drawn at all.
 */
export function densityClass(n: number, max: number): number {
  if (n <= 0 || max <= 0) return 0;
  return Math.min(CLASSES, Math.max(1, Math.ceil(CLASSES * Math.sqrt(n / max))));
}

/** The counts each tint stands for against this `max`, for the legend. Tints no count falls in are left out. */
export function classRanges(max: number): { cls: number; from: number; to: number }[] {
  const ranges = new Map<number, { cls: number; from: number; to: number }>();
  for (let n = 1; n <= max; n++) {
    const cls = densityClass(n, max);
    const known = ranges.get(cls);
    if (known) known.to = n;
    else ranges.set(cls, { cls, from: n, to: n });
  }
  return [...ranges.values()];
}

/** One square of the pitch with shots in it. */
export interface Bin {
  /** Unique among the bins of one map: its place in the grid. */
  key: number;
  gx: number;
  gy: number;
  n: number;
  xg: number;
  goals: number;
}

export const binKey = (gx: number, gy: number): number => gx * 1024 + gy;

export const binsOf = (d: Density): Bin[] =>
  d.gx.map((gx, i) => ({
    key: binKey(gx, d.gy[i] ?? 0),
    gx,
    gy: d.gy[i] ?? 0,
    n: d.n[i] ?? 0,
    xg: d.xg[i] ?? 0,
    goals: d.goals[i] ?? 0,
  }));

/** Where a bin lies on the pitch, in yards, cut to the pitch (a bin may straddle its far edge). */
export function cellOf(bin: Pick<Bin, 'gx' | 'gy'>, step: number) {
  const x = bin.gx * step;
  const y = bin.gy * step;
  return {
    x,
    y,
    w: Math.min(step, PITCH.length - x),
    h: Math.min(step, PITCH.width - y),
  };
}

/** The bins that can be drawn: those with any of their square in the half being shown. */
export const drawableBins = (bins: readonly Bin[], step: number, xMin: number): Bin[] =>
  bins.filter((b) => {
    const c = cellOf(b, step);
    return c.w > 0 && c.h > 0 && c.x + c.w > xMin;
  });

/**
 * One path per tint, all of that tint's squares in it, in pitch coordinates (the group they are
 * drawn in turns the pitch). Index 0 is `--density-1`. Six elements draw any number of bins.
 */
export function classPaths(bins: readonly Bin[], step: number, max: number): string[] {
  const parts: string[][] = Array.from({ length: CLASSES }, () => []);
  for (const b of bins) {
    const cls = densityClass(b.n, max);
    if (cls === 0) continue;
    const c = cellOf(b, step);
    parts[cls - 1]?.push(`M${c.x} ${c.y}h${c.w}v${c.h}h${-c.w}Z`);
  }
  return parts.map((p) => p.join(''));
}

/** The busiest bin's count: the scale's top. */
export const busiest = (bins: readonly Bin[]): number =>
  bins.reduce((m, b) => Math.max(m, b.n), 0);

/** Busiest first, then by place: the order of the text proxy, so the interesting ones come first. */
export const byBusiest = (bins: readonly Bin[]): Bin[] =>
  [...bins].sort((a, b) => b.n - a.n || a.key - b.key);

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;
const yards = (from: number, to: number) =>
  from === to ? `${from}` : `${Math.min(from, to)} to ${Math.max(from, to)}`;

/**
 * Where a bin is, in words: how far from the goal line and how far to which side of the middle,
 * from the shooter's point of view (attacking up the pitch, the larger y is their right).
 */
export function binWhere(bin: Pick<Bin, 'gx' | 'gy'>, step: number): string {
  const c = cellOf(bin, step);
  const out = yards(
    Math.round(PITCH.length - (c.x + c.w)),
    Math.round(PITCH.length - c.x),
  );
  const mid = PITCH.width / 2;
  const from = c.y - mid;
  const to = c.y + c.h - mid;
  const side =
    to <= 0
      ? `${yards(-to, -from)} yards left of centre`
      : from >= 0
        ? `${yards(from, to)} yards right of centre`
        : 'across the middle';
  return `${out} yards out, ${side}`;
}

/** What assistive technology says for a bin. */
export const binLabel = (bin: Bin, step: number): string =>
  `${binWhere(bin, step)}: ${plural(bin.n, 'shot')}, ${plural(bin.goals, 'goal')}, ${bin.xg.toFixed(2)} expected goals`;

/** The map in a sentence or two, for the page and for a screen reader. */
export function describeDensity(bins: readonly Bin[], step: number): string {
  if (bins.length === 0) return 'No shots here.';
  const shots = bins.reduce((n, b) => n + b.n, 0);
  const goals = bins.reduce((n, b) => n + b.goals, 0);
  const top = byBusiest(bins)[0];
  return (
    `${plural(shots, 'shot')} (${plural(goals, 'goal')}) counted in squares of ${step} yards, ` +
    `${plural(bins.length, 'square')} with a shot in. ` +
    (top ? `The busiest, ${binWhere(top, step)}, holds ${top.n}.` : '')
  );
}
