import { OUTCOMES } from '@shotmap/schema';
import { describe, expect, it } from 'vitest';
import { seeded, synthMarks } from './synth';

describe('the synthetic shots of the stress page', () => {
  it('are the same every time, so a measurement can be repeated', () => {
    expect(synthMarks(200, 3)).toEqual(synthMarks(200, 3));
    expect(synthMarks(200, 3, 1)).not.toEqual(synthMarks(200, 3, 2));
    const a = seeded(7);
    const b = seeded(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('are as many as asked for, each with its own id', () => {
    const marks = synthMarks(5000, 3);
    expect(marks).toHaveLength(5000);
    expect(new Set(marks.map((m) => m.id)).size).toBe(5000);
    expect(synthMarks(0, 3)).toEqual([]);
  });

  it('lie on the attacking half, inside the pitch, shooting at the goal', () => {
    for (const m of synthMarks(5000, 3)) {
      expect(m.x).toBeGreaterThanOrEqual(60);
      expect(m.x).toBeLessThanOrEqual(120);
      expect(m.y).toBeGreaterThanOrEqual(0);
      expect(m.y).toBeLessThanOrEqual(80);
      expect(m.ex).toBe(120);
      expect(m.ey).toBeGreaterThanOrEqual(36);
      expect(m.ey).toBeLessThanOrEqual(44);
      expect(m.xg).toBeGreaterThan(0);
      expect(m.xg).toBeLessThanOrEqual(1);
    }
  });

  it('have every outcome, goals the fewest of the common ones, and most of them close in', () => {
    const marks = synthMarks(5000, 3);
    const count = (o: string) => marks.filter((m) => m.outcome === o).length;
    for (const o of OUTCOMES) expect(count(o), o).toBeGreaterThan(20);
    expect(count('goal')).toBeLessThan(count('saved'));
    expect(marks.filter((m) => m.x > 100).length).toBeGreaterThan(marks.length * 0.6);
  });

  it('are bigger when xG is bigger, and never smaller than the minimum mark', () => {
    const marks = synthMarks(2000, 3);
    const big = marks.filter((m) => m.xg > 0.3);
    const small = marks.filter((m) => m.xg < 0.05);
    expect(Math.min(...big.map((m) => m.r))).toBeGreaterThan(
      Math.max(...small.map((m) => m.r)) - 1e-9,
    );
    expect(Math.min(...marks.map((m) => m.r))).toBeGreaterThanOrEqual(7 / 3 - 1e-9);
  });
});
