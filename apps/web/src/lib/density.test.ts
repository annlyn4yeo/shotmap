import type { Density } from '@shotmap/schema';
import { describe, expect, it } from 'vitest';
import {
  CLASSES,
  DENSITY_STEP,
  binKey,
  binLabel,
  binWhere,
  binsOf,
  busiest,
  byBusiest,
  cellOf,
  classPaths,
  classRanges,
  densityClass,
  describeDensity,
  drawableBins,
} from './density';

const D: Density = {
  step: 2,
  // Bins: one just behind the halfway line, two beside the penalty spot, one at the goal line.
  gx: [29, 54, 54, 59],
  gy: [18, 19, 20, 20],
  n: [1, 40, 9, 3],
  xg: [0.04, 3.6, 0.83, 0.2],
  goals: [0, 12, 3, 1],
};

describe('the density classes', () => {
  it('give an empty bin none and the busiest the darkest', () => {
    expect(densityClass(0, 40)).toBe(0);
    expect(densityClass(40, 40)).toBe(CLASSES);
    expect(densityClass(1, 40)).toBe(1);
    expect(densityClass(5, 0)).toBe(0);
  });

  it('follow the square root of the count, one tint per sixth of it', () => {
    // sqrt(n / 36) * 6 = sqrt(n): the classes are the integers 1..6 of sqrt(n).
    const at = (n: number) => densityClass(n, 36);
    expect([1, 2, 4, 5, 9, 10, 16, 17, 25, 26, 36].map(at)).toEqual([
      1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
    ]);
  });

  it('never go down as the count goes up, and never leave 1 to 6', () => {
    for (const max of [1, 2, 7, 40, 213, 5000]) {
      let before = 0;
      for (let n = 1; n <= max; n++) {
        const c = densityClass(n, max);
        expect(c).toBeGreaterThanOrEqual(before);
        expect(c).toBeGreaterThanOrEqual(1);
        expect(c).toBeLessThanOrEqual(CLASSES);
        before = c;
      }
    }
  });

  it('are ranges of whole counts that cover 1 to the busiest, once each, in order', () => {
    for (const max of [1, 3, 40, 213]) {
      const ranges = classRanges(max);
      expect(ranges[0]?.from).toBe(1);
      expect(ranges.at(-1)?.to).toBe(max);
      ranges.slice(1).forEach((r, i) => {
        expect(r.from).toBe((ranges[i]?.to ?? 0) + 1);
        expect(r.cls).toBeGreaterThan(ranges[i]?.cls ?? 0);
      });
    }
    // A map whose busiest bin has three shots has only three tints in use, the darkest of them last.
    expect(classRanges(3).at(-1)?.cls).toBe(CLASSES);
  });
});

describe('the bins', () => {
  const bins = binsOf(D);

  it('read the columns into bins with a key of their own', () => {
    expect(bins).toHaveLength(4);
    expect(bins[1]).toEqual({
      key: binKey(54, 19),
      gx: 54,
      gy: 19,
      n: 40,
      xg: 3.6,
      goals: 12,
    });
    expect(new Set(bins.map((b) => b.key)).size).toBe(4);
    expect(busiest(bins)).toBe(40);
  });

  it('are squares of the step, cut at the edge of the pitch', () => {
    expect(cellOf({ gx: 54, gy: 19 }, 2)).toEqual({ x: 108, y: 38, w: 2, h: 2 });
    // The last bin of a step that does not divide 120 hangs over the goal line and is cut.
    expect(cellOf({ gx: 24, gy: 0 }, 5)).toEqual({ x: 120, y: 0, w: 0, h: 5 });
    expect(cellOf({ gx: 11, gy: 7 }, 10)).toEqual({ x: 110, y: 70, w: 10, h: 10 });
  });

  it('leave out what is behind the half being shown', () => {
    expect(drawableBins(bins, 2, 60).map((b) => b.gx)).toEqual([54, 54, 59]);
    expect(drawableBins(bins, 2, 108).map((b) => b.gx)).toEqual([54, 54, 59]);
    expect(drawableBins(bins, 2, 110).map((b) => b.gx)).toEqual([59]);
  });

  it('are drawn as one path per tint, so any number of bins is six elements', () => {
    const paths = classPaths(bins, DENSITY_STEP, 40);
    expect(paths).toHaveLength(CLASSES);
    expect(paths[5]).toBe('M108 38h2v2h-2Z'); // the busiest
    expect(paths[0]).toBe('M58 36h2v2h-2Z'); // the lightest: one shot
    // Every bin is in exactly one path.
    const squares = paths.reduce((n, p) => n + (p.match(/M/g)?.length ?? 0), 0);
    expect(squares).toBe(4);
    expect(classPaths([], 2, 0).every((p) => p === '')).toBe(true);
  });

  it('are listed busiest first, then by place', () => {
    expect(byBusiest(bins).map((b) => b.n)).toEqual([40, 9, 3, 1]);
    const tied = binsOf({ ...D, n: [5, 5, 5, 5] });
    expect(byBusiest(tied).map((b) => b.key)).toEqual(
      tied.map((b) => b.key).sort((a, b) => a - b),
    );
  });
});

describe('a bin in words', () => {
  it('says how far out and to which side, from the shooter', () => {
    // 108 to 110 along x is 10 to 12 yards from the goal line; 38 to 40 across is the left of the middle.
    expect(binWhere({ gx: 54, gy: 19 }, 2)).toBe(
      '10 to 12 yards out, 0 to 2 yards left of centre',
    );
    expect(binWhere({ gx: 54, gy: 20 }, 2)).toBe(
      '10 to 12 yards out, 0 to 2 yards right of centre',
    );
    // Ten-yard bins: x 70 to 80 is 40 to 50 yards out; y 30 to 40 is up to ten yards left.
    expect(binWhere({ gx: 7, gy: 3 }, 10)).toBe(
      '40 to 50 yards out, 0 to 10 yards left of centre',
    );
  });

  it('gives the figures in the label, singular when it is one', () => {
    const bins = binsOf(D);
    expect(binLabel(bins[0] as (typeof bins)[number], 2)).toContain(
      '1 shot, 0 goals, 0.04 expected goals',
    );
    expect(binLabel(bins[1] as (typeof bins)[number], 2)).toContain(
      '40 shots, 12 goals, 3.60 expected goals',
    );
    const scored = binsOf({ ...D, goals: [1, 1, 1, 1] })[0] as (typeof bins)[number];
    expect(binLabel(scored, 2)).toContain('1 goal,');
  });

  it('sums up the whole map and names the busiest square', () => {
    const text = describeDensity(binsOf(D), 2);
    expect(text).toContain('53 shots (16 goals)');
    expect(text).toContain('4 squares');
    expect(text).toContain('holds 40');
    expect(describeDensity([], 2)).toBe('No shots here.');
  });
});
