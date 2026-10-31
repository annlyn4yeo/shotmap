import { describe, expect, it } from 'vitest';
import { HIT_PX } from './hit';
import { HitGrid, type Spot } from './hitgrid';

/** The rule as ShotLayer states it: scan every mark, the nearest within reach, a later one winning a tie. */
function scan(spots: readonly Spot[], x: number, y: number, reach = HIT_PX) {
  let best: Spot | undefined;
  for (const s of spots) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d <= reach) {
      reach = d;
      best = s;
    }
  }
  return best;
}

/** A small deterministic generator, so a failure can be replayed. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('the uniform-grid hit test', () => {
  it('finds nothing in an empty map, and nothing out of reach', () => {
    expect(new HitGrid([]).nearest(10, 10)).toBeUndefined();
    const grid = new HitGrid([{ id: 1, x: 100, y: 100 }]);
    expect(grid.nearest(100 + HIT_PX + 0.01, 100)).toBeUndefined();
    expect(grid.nearest(-500, -500)).toBeUndefined();
    expect(grid.nearest(1e6, 1e6)).toBeUndefined();
  });

  it('counts a mark exactly 24 px away, as the SVG layer does, and not 24.01', () => {
    const grid = new HitGrid([{ id: 7, x: 50, y: 50 }]);
    expect(grid.nearest(50 + HIT_PX, 50)?.id).toBe(7);
    expect(grid.nearest(50, 50 - HIT_PX)?.id).toBe(7);
    expect(grid.nearest(50 + HIT_PX + 0.01, 50)).toBeUndefined();
  });

  it('gives the nearest of several, and the later one when two are equally near', () => {
    const grid = new HitGrid([
      { id: 1, x: 40, y: 40 },
      { id: 2, x: 60, y: 40 },
      { id: 3, x: 50, y: 70 },
    ]);
    expect(grid.nearest(44, 40)?.id).toBe(1);
    expect(grid.nearest(57, 41)?.id).toBe(2);
    expect(grid.nearest(50, 40)?.id).toBe(2); // equally near 1 and 2: the one drawn on top
  });

  it('agrees with scanning every mark, on thousands of random marks and pointers', () => {
    const next = rng(20261027);
    for (const count of [1, 2, 30, 400, 5000]) {
      const spots: Spot[] = Array.from({ length: count }, (_, id) => ({
        id,
        x: next() * 375,
        y: next() * 420,
      }));
      const grid = new HitGrid(spots);
      for (let i = 0; i < 600; i++) {
        // Pointers on, near and well off the map.
        const x = next() * 440 - 30;
        const y = next() * 480 - 30;
        expect(grid.nearest(x, y)?.id, `${count} marks at ${x}, ${y}`).toBe(
          scan(spots, x, y)?.id,
        );
      }
    }
  });

  it('agrees when marks are stacked on one spot or on a line, which share cells', () => {
    const stacked: Spot[] = Array.from({ length: 50 }, (_, id) => ({
      id,
      x: 100,
      y: 100,
    }));
    expect(new HitGrid(stacked).nearest(100, 100)?.id).toBe(49);
    const line: Spot[] = Array.from({ length: 200 }, (_, id) => ({
      id,
      x: id * 3,
      y: 0,
    }));
    const grid = new HitGrid(line);
    for (let x = -30; x < 640; x += 7)
      expect(grid.nearest(x, 5)?.id, `x ${x}`).toBe(scan(line, x, 5)?.id);
  });

  it('can be limited to some kinds of mark, as the legend hides them, with the grid left as it was', () => {
    const spots: Spot[] = [
      { id: 1, x: 50, y: 50, kind: 0 },
      { id: 2, x: 52, y: 50, kind: 1 },
      { id: 3, x: 80, y: 50, kind: 2 },
    ];
    const grid = new HitGrid(spots);
    const only = (...kinds: number[]) => kinds.reduce((mask, k) => mask | (1 << k), 0);
    expect(grid.nearest(52, 50)?.id).toBe(2);
    expect(grid.nearest(52, 50, 24, only(0, 2))?.id).toBe(1);
    expect(grid.nearest(52, 50, 24, only(2))).toBeUndefined();
    expect(grid.nearest(70, 50, 24, only(2))?.id).toBe(3);
    expect(grid.nearest(52, 50, 24, 0)).toBeUndefined();
    // Marks with no kind are kind 0.
    expect(new HitGrid([{ id: 9, x: 0, y: 0 }]).nearest(1, 1, 24, only(0))?.id).toBe(9);
  });

  it('agrees with scanning the marks of the kinds that count, on random marks', () => {
    const next = rng(7);
    const spots: Spot[] = Array.from({ length: 3000 }, (_, id) => ({
      id,
      x: next() * 375,
      y: next() * 420,
      kind: Math.floor(next() * 5),
    }));
    const grid = new HitGrid(spots);
    for (const mask of [0b11111, 0b10110, 0b00001, 0b01000]) {
      const kept = spots.filter((s) => ((1 << (s.kind ?? 0)) & mask) !== 0);
      for (let i = 0; i < 300; i++) {
        const x = next() * 400;
        const y = next() * 440;
        expect(grid.nearest(x, y, 24, mask)?.id, `mask ${mask}`).toBe(
          scan(kept, x, y)?.id,
        );
      }
    }
  });

  it('can be asked for less reach than a cell, never more', () => {
    const grid = new HitGrid([{ id: 1, x: 0, y: 0 }]);
    expect(grid.nearest(10, 0, 12)?.id).toBe(1);
    expect(grid.nearest(20, 0, 12)).toBeUndefined();
    expect(grid.nearest(HIT_PX + 5, 0, 100)).toBeUndefined();
  });

  it('looks at nine cells, not at every mark', () => {
    const spots: Spot[] = Array.from({ length: 5000 }, (_, id) => ({
      id,
      x: (id % 100) * 4,
      y: Math.floor(id / 100) * 8,
    }));
    let reads = 0;
    const counted = spots.map((s) => ({
      get id() {
        return s.id;
      },
      get x() {
        reads++;
        return s.x;
      },
      get y() {
        return s.y;
      },
    }));
    const grid = new HitGrid(counted);
    reads = 0;
    grid.nearest(200, 200);
    // 24 px cells hold about 6 x 3 marks each here, so nine cells are about 160 marks, not 5,000.
    expect(reads).toBeLessThan(400);
  });
});
