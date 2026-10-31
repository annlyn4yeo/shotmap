import type { Outcome } from '@shotmap/schema';
import { describe, expect, it } from 'vitest';
import { frameFor } from './frame';
import { canvasTransform, paintOutcome, readPalette, tint, type Brush } from './paint';
import type { MapShot } from './ShotLayer';

const TOKENS: Record<string, string> = {
  '--goal': ' #bf3a12',
  '--saved': '#1b5e92',
  '--off': '#52687a',
  '--blocked': '#85571b',
  '--post': '#1d6a52',
};
const palette = readPalette({ getPropertyValue: (name) => TOKENS[name] ?? '' });

const mark = (id: number, outcome: Outcome): MapShot => ({
  id,
  outcome,
  xg: 0.1,
  label: '',
  x: 100,
  y: 40,
  ex: 120,
  ey: 40,
  r: 2,
  delay: 0,
});

/** A context that writes down what it is asked to do. */
function recorder() {
  const calls: string[] = [];
  const brush: Brush = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: 'round',
    fill: (_path, rule) => calls.push(`fill ${brush.fillStyle as string} ${rule ?? ''}`),
    stroke: () => calls.push(`stroke ${brush.strokeStyle as string} ${brush.lineWidth}`),
  };
  return { brush, calls };
}

describe('the palette', () => {
  it('is the tokens, with the fills and strokes of shots.css', () => {
    expect(palette.goal).toEqual({
      fill: '#bf3a12',
      stroke: null,
      width: 0,
      evenodd: true,
      solid: false,
    });
    expect(palette.blocked).toMatchObject({ fill: '#85571b', stroke: null });
    expect(palette.off).toMatchObject({ fill: null, stroke: '#52687a', width: 2.25 });
    expect(palette.post).toMatchObject({ stroke: '#1d6a52', width: 2.25 });
    expect(palette.saved).toMatchObject({ stroke: '#1b5e92', width: 1.75 });
    expect(palette.saved.fill).toBe(tint('#1b5e92', 0.1));
    expect(palette.post.fill).toBe(tint('#1d6a52', 0.14));
  });

  it('turns a hex colour and an opacity into a colour a context takes', () => {
    expect(tint('#1b5e92', 0.1)).toBe('rgb(27 94 146 / 0.1)');
  });

  it('is never undefined for a token the page lacks (a missing colour paints black, not nothing)', () => {
    const none = readPalette({ getPropertyValue: () => '' });
    expect(none.goal.fill).toBe('#000000');
  });
});

describe('the transform', () => {
  const frame = frameFor('half', 'vertical', 80);
  const [a, b, c, d, e, f] = canvasTransform(frame, 740, 1200);
  const apply = (x: number, y: number) => ({
    x: a * x + c * y + e,
    y: b * x + d * y + f,
  });

  it('puts every pitch point where the SVG layer would, in device pixels', () => {
    for (const [x, y] of [
      [120, 40],
      [100, 10],
      [80, 80],
      [95.5, 33.3],
    ] as const) {
      const at = frame.place(x, y);
      const got = apply(x, y);
      expect(got.x).toBeCloseTo(((at.x - frame.x) / frame.w) * 740, 6);
      expect(got.y).toBeCloseTo(((at.y - frame.y) / frame.h) * 1200, 6);
    }
  });

  it('has the goal at the top and the attack running up, for a vertical pitch', () => {
    expect(apply(120, 40).y).toBeLessThan(apply(100, 40).y);
    expect(apply(100, 10).x).toBeLessThan(apply(100, 70).x);
  });

  it('does not turn a horizontal pitch', () => {
    const flat = canvasTransform(frameFor('half', 'horizontal', 80), 800, 400);
    expect(flat[1]).toBe(0);
    expect(flat[2]).toBe(0);
  });
});

describe('painting an outcome', () => {
  /** A path that is just its mark's id, and a join that says how many it was given. */
  const same = (m: MapShot) => ({ id: m.id }) as unknown as Path2D;
  const join = (paths: readonly Path2D[]) =>
    ({ joined: paths.length }) as unknown as Path2D;
  const paint = (outcome: Outcome, ids: number[], unit = 1) => {
    const { brush, calls } = recorder();
    paintOutcome(
      brush,
      ids.map((id) => mark(id, outcome)),
      palette[outcome],
      unit,
      same,
      join,
    );
    return { brush, calls };
  };

  it('fills each goal on its own with the even-odd rule, and gives it no stroke', () => {
    expect(paint('goal', [1, 2, 3]).calls).toEqual([
      'fill #bf3a12 evenodd',
      'fill #bf3a12 evenodd',
      'fill #bf3a12 evenodd',
    ]);
  });

  it('fills every blocked shot at once: they are opaque, so painting them together changes nothing', () => {
    expect(paint('blocked', [1, 2, 3, 4]).calls).toEqual(['fill #85571b nonzero']);
  });

  it('strokes every cross in one stroke, at the width of shots.css in CSS pixels', () => {
    const { brush, calls } = paint('off', [1, 2, 3, 4, 5]);
    expect(calls).toEqual(['stroke #52687a 2.25']);
    expect(brush.lineJoin).toBe('miter');
  });

  it('fills each ring on its own, because tints add up where marks overlap, then strokes them once', () => {
    expect(paint('saved', [1, 2, 3]).calls).toEqual([
      `fill ${tint('#1b5e92', 0.1)} nonzero`,
      `fill ${tint('#1b5e92', 0.1)} nonzero`,
      `fill ${tint('#1b5e92', 0.1)} nonzero`,
      'stroke #1b5e92 1.75',
    ]);
    expect(paint('post', [1, 2]).calls).toEqual([
      `fill ${tint('#1d6a52', 0.14)} nonzero`,
      `fill ${tint('#1d6a52', 0.14)} nonzero`,
      'stroke #1d6a52 2.25',
    ]);
  });

  it('is a handful of instructions for thousands of crosses and blocks, however many there are', () => {
    expect(
      paint(
        'off',
        Array.from({ length: 5000 }, (_, i) => i),
      ).calls,
    ).toHaveLength(1);
    expect(
      paint(
        'blocked',
        Array.from({ length: 5000 }, (_, i) => i),
      ).calls,
    ).toHaveLength(1);
  });

  it('scales a stroke by the pitch units in a CSS pixel, so it is as wide on screen on any pitch', () => {
    expect(paint('off', [1], 0.5).calls).toEqual(['stroke #52687a 1.125']);
  });

  it('draws nothing for no marks, not even an empty stroke', () => {
    expect(paint('off', []).calls).toEqual([]);
    expect(paint('goal', []).calls).toEqual([]);
  });
});
