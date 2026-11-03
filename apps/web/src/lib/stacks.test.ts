import { describe, expect, it } from 'vitest';
import {
  countsFrom,
  pickOnSpot,
  placeInStack,
  spotsOf,
  stackNote,
  stacksOf,
} from './stacks';

// France in the 2022 final, as the match page draws them: Mbappé's two penalties (79' and 117')
// are both from the spot, 108 by 40, and so is nothing else of theirs.
const marks = [
  { id: 12, x: 108, y: 40 },
  { id: 13, x: 104.8, y: 30.1 },
  { id: 27, x: 108, y: 40 },
  { id: 9, x: 113.4, y: 34.6 },
];

describe('shots from the same spot', () => {
  it('finds the marks that share a spot, in the order they came, and leaves the rest out', () => {
    const stacks = stacksOf(marks);
    expect(stacks.get(12)?.map((m) => m.id)).toEqual([12, 27]);
    expect(stacks.get(27)).toBe(stacks.get(12));
    expect(stacks.has(13)).toBe(false);
    expect(spotsOf(stacks)).toHaveLength(1);
  });

  it('takes the penalty spot as one spot however the data writes it, and a yard away as another', () => {
    // Cristiano Ronaldo's La Liga penalties are at (108, 40) and at (108.1, 40.1): one spot, one count.
    const stacks = stacksOf([
      { id: 1, x: 108, y: 40 },
      { id: 2, x: 108.1, y: 40.1 },
      { id: 3, x: 108, y: 40 },
      { id: 4, x: 109, y: 40 },
      { id: 5, x: 97.3, y: 23.1 },
      { id: 6, x: 97.3, y: 23.1 },
    ]);
    expect(stacks.get(2)?.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(stacks.has(4)).toBe(false);
    expect(stacks.get(6)?.map((m) => m.id)).toEqual([5, 6]);
    expect(spotsOf(stacks)).toHaveLength(2);
  });

  it('keeps a career of penalties on one spot, at both ends, wherever round it they are written', () => {
    // Lionel Messi's career has penalties at several tenths of a yard round the spot; the first of
    // them must not split the rest into two spots of nineteen and eighteen.
    const around = [
      [108, 40],
      [108.2, 40],
      [108.1, 40.1],
      [107.9, 39.9],
      [108, 40.2],
    ].map(([x = 0, y = 0], i) => ({ id: i, x, y }));
    expect(stacksOf(around).get(0)?.length).toBe(5);
    // The hero turns the away side round, so its penalties are at the other end's spot.
    const turned = stacksOf([
      { id: 1, x: 12, y: 40 },
      { id: 2, x: 11.9, y: 39.9 },
      { id: 3, x: 12.4, y: 40 },
    ]);
    expect(turned.get(1)?.map((m) => m.id)).toEqual([1, 2]);
    expect(turned.has(3)).toBe(false);
  });

  it('labels every spot of two on an ordinary map, and only of three on a dense one', () => {
    const stacks = stacksOf([
      { id: 1, x: 108, y: 40 },
      { id: 2, x: 108, y: 40 },
      { id: 3, x: 108, y: 40 },
      { id: 4, x: 97.3, y: 23.1 },
      { id: 5, x: 97.3, y: 23.1 },
    ]);
    expect(spotsOf(stacks, countsFrom(30))).toHaveLength(2);
    expect(spotsOf(stacks, countsFrom(1297))).toHaveLength(1);
    // A pick goes through every stack whatever is labelled.
    expect(pickOnSpot(4, 4, stacks)).toBe(5);
  });

  it('never chains neighbours into one spot: a mark joins a spot only near its first mark', () => {
    // A row of shots a tenth of a yard apart is not one spot of five: each is near the next, but
    // only the first two are near the first.
    const row = stacksOf([0, 1, 2, 3, 4].map((k) => ({ id: k, x: 100 + k / 10, y: 30 })));
    expect(row.get(0)?.map((m) => m.id)).toEqual([0, 1]);
    expect(row.get(2)?.map((m) => m.id)).toEqual([2, 3]);
    expect(row.has(4)).toBe(false);
  });

  it('joins a spot across the cells it is looked up in, and stays fast on a career', () => {
    // Either side of a cell's edge (0.15 yards wide) is still the same spot.
    const edge = stacksOf([
      { id: 1, x: 104.99, y: 30 },
      { id: 2, x: 105.01, y: 30 },
    ]);
    expect(edge.get(1)?.length).toBe(2);
    const career = Array.from({ length: 3000 }, (_, i) => ({
      id: i,
      x: 80 + ((i * 7.31) % 40),
      y: (i * 3.17) % 80,
    }));
    const started = performance.now();
    stacksOf(career);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('opens each shot on a spot in turn, then closes, and a lone mark as it always did', () => {
    const stacks = stacksOf(marks);
    expect(pickOnSpot(12, null, stacks)).toBe(12);
    expect(pickOnSpot(12, 12, stacks)).toBe(27);
    expect(pickOnSpot(12, 27, stacks)).toBeNull();
    // Coming to the spot from another shot starts at its first.
    expect(pickOnSpot(27, 13, stacks)).toBe(12);
    expect(pickOnSpot(13, null, stacks)).toBe(13);
    expect(pickOnSpot(13, 13, stacks)).toBeNull();
    expect(pickOnSpot(undefined, 13, stacks)).toBeNull();
  });

  it('says which of the stack a mark is, for its label and its card', () => {
    const stacks = stacksOf(marks);
    expect(placeInStack(27, stacks)).toEqual({ at: 2, of: 2 });
    expect(placeInStack(13, stacks)).toBeUndefined();
    expect(stackNote(placeInStack(12, stacks))).toBe(', 1 of 2 shots from this spot');
    expect(stackNote(undefined)).toBe('');
  });
});
