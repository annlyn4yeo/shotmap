import { describe, expect, it } from 'vitest';
import { ENUMS, type ShotColumns } from '@shotmap/schema';
import { isLowResolution, repairGoalEnds } from './repairs';
import type { MatchRecord } from './rich';

const GOAL = ENUMS.outcome.find((o) => o.name === 'Goal')?.id ?? 0;
const SAVED = ENUMS.outcome.find((o) => o.name === 'Saved')?.id ?? 0;

interface Shot {
  x: number;
  y: number;
  ex: number;
  ey: number;
  ez: number | null;
  out: number;
}

/** A match with these shots, which is all the repair looks at. */
function match(shots: Shot[]): MatchRecord {
  const col = <K extends keyof Shot>(k: K) => shots.map((s) => s[k]);
  const columns = {
    x: col('x'),
    y: col('y'),
    ex: col('ex'),
    ey: col('ey'),
    ez: col('ez'),
    out: col('out'),
  } as unknown as ShotColumns;
  return {
    file: { meta: { id: 1 }, shots: columns, shootout: null },
  } as unknown as MatchRecord;
}

const goal = (ex: number, over: Partial<Shot> = {}): Shot => ({
  x: 110,
  y: 40,
  ex,
  ey: 40,
  ez: 1,
  out: GOAL,
  ...over,
});
/** Enough whole-yard shots to be a low-resolution match, plus the given ones. */
const wholeYard = (...extra: Shot[]): Shot[] => [
  ...Array.from({ length: 5 }, (_, i): Shot => ({
    x: 100 + i,
    y: 30 + i,
    ex: 120,
    ey: 38.4,
    ez: 0.5,
    out: SAVED,
  })),
  ...extra,
];

describe('a goal that stops short of the line in a low-resolution match', () => {
  it('is set to the line, and the original is returned', () => {
    const record = match(wholeYard(goal(119), goal(118), goal(117), goal(120)));
    expect(isLowResolution(record)).toBe(true);
    const repairs = repairGoalEnds([record]);
    expect(repairs).toEqual([
      { match: 1, seq: 5, was: 119 },
      { match: 1, seq: 6, was: 118 },
      { match: 1, seq: 7, was: 117 },
    ]);
    expect(record.file.shots.ex.slice(5)).toEqual([120, 120, 120, 120]);
  });

  it('is left alone when it is further out than the quirk goes, so the check still fails it', () => {
    const record = match(wholeYard(goal(116), goal(100)));
    expect(repairGoalEnds([record])).toEqual([]);
    expect(record.file.shots.ex.slice(5)).toEqual([116, 100]);
  });

  it('is left alone when it is not otherwise a goal: wide of the posts, or over the bar', () => {
    const record = match(
      wholeYard(goal(119, { ey: 30 }), goal(119, { ez: 3 }), goal(119, { ey: 50 })),
    );
    expect(repairGoalEnds([record])).toEqual([]);
  });

  it('is left alone in a match that records tenths of a yard: there it is not a precision quirk', () => {
    const record = match([
      ...wholeYard(goal(119)),
      { x: 100.4, y: 30, ex: 120, ey: 40, ez: 1, out: SAVED },
    ]);
    expect(isLowResolution(record)).toBe(false);
    expect(repairGoalEnds([record])).toEqual([]);
  });

  it('is left alone in a match with too few shots to say it records whole yards', () => {
    const record = match([goal(119), goal(118)]);
    expect(isLowResolution(record)).toBe(false);
    expect(repairGoalEnds([record])).toEqual([]);
  });

  it('is the only thing repaired: a shot that is not a goal keeps its end point', () => {
    const record = match(
      wholeYard({ x: 110, y: 40, ex: 119, ey: 40, ez: 1, out: SAVED }),
    );
    expect(repairGoalEnds([record])).toEqual([]);
    expect(record.file.shots.ex[5]).toBe(119);
  });
});
