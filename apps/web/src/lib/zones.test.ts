import type { Outcome } from '@shotmap/schema';
import { describe, expect, it } from 'vitest';
import { isQuiet, markRadius, quietRadius } from './geometry';
import { markPath } from './marks';
import { countsFrom, spotsOf, stacksOf } from './stacks';
import { penaltyNote, scored, zoneClaim, zoneOf, zoneRows, type ZoneRow } from './zones';

const shot = (
  x: number,
  y: number,
  outcome: Outcome = 'off',
  shotType = 'Open Play',
) => ({
  x,
  y,
  outcome,
  shotType,
});

const row = (key: ZoneRow['key'], shots: number, goals: number): ZoneRow => ({
  key,
  label: key,
  shots,
  goals,
});

describe('zones', () => {
  it('puts a shot in the place the pitch draws it', () => {
    expect(zoneOf(shot(116, 40))).toBe('six');
    expect(zoneOf(shot(110, 40))).toBe('box');
    expect(zoneOf(shot(116, 25))).toBe('box');
    expect(zoneOf(shot(100, 40))).toBe('outside');
    expect(zoneOf(shot(110, 10))).toBe('outside');
  });

  it('counts the box lines as in it', () => {
    expect(zoneOf(shot(102, 18))).toBe('box');
    expect(zoneOf(shot(102, 62))).toBe('box');
    expect(zoneOf(shot(114, 30))).toBe('six');
    expect(zoneOf(shot(114, 50))).toBe('six');
  });

  it('knows a penalty by its type, not by where it was taken', () => {
    expect(zoneOf(shot(108, 40, 'goal', 'Penalty'))).toBe('penalty');
    expect(zoneOf(shot(108, 40, 'goal'))).toBe('box');
  });

  it('counts every shot once, and every goal with its shot', () => {
    const rows = zoneRows([
      shot(108, 40, 'goal', 'Penalty'),
      shot(108, 40, 'saved', 'Penalty'),
      shot(116, 40, 'goal'),
      shot(110, 40),
      shot(90, 40, 'goal'),
      shot(90, 40),
    ]);
    expect(rows.map((r) => [r.key, r.shots, r.goals])).toEqual([
      ['penalty', 2, 1],
      ['six', 1, 1],
      ['box', 1, 0],
      ['outside', 2, 1],
    ]);
  });

  it('gives no rate where nobody shot', () => {
    expect(scored({ shots: 0, goals: 0 })).toBeNull();
    expect(scored({ shots: 93, goals: 5 })).toBe(5);
    expect(scored({ shots: 10, goals: 7 })).toBe(70);
  });
});

describe('the sentence over the map', () => {
  it('says "but only" where the goals really are the smaller share', () => {
    expect(
      zoneClaim([
        row('penalty', 10, 7),
        row('six', 20, 6),
        row('box', 139, 20),
        row('outside', 93, 5),
      ]),
    ).toBe('93 of 262 shots came from outside the box, but only 5 of 38 goals did.');
  });

  it('does not say "only" of someone who scores more from outside than they shoot from there', () => {
    expect(zoneClaim([row('box', 90, 2), row('outside', 10, 2)])).toBe(
      '10 of 100 shots came from outside the box, and 2 of 4 goals did.',
    );
  });

  it('says so when none of the goals came from out there', () => {
    expect(zoneClaim([row('box', 90, 4), row('outside', 10, 0)])).toBe(
      '10 of 100 shots came from outside the box, and none of the 4 goals did.',
    );
  });

  it('falls back to the counts when there is nothing to compare', () => {
    expect(zoneClaim([row('box', 1, 0), row('outside', 0, 0)])).toBe('1 shot, 0 goals.');
    expect(zoneClaim([row('box', 3, 1), row('outside', 0, 0)])).toBe('3 shots, 1 goal.');
  });
});

describe('the penalty note', () => {
  it('is goals over penalties', () => {
    const shots = [
      shot(108, 40, 'goal', 'Penalty'),
      shot(108, 40, 'goal', 'Penalty'),
      shot(108, 40, 'saved', 'Penalty'),
      shot(100, 40, 'goal'),
    ];
    expect(penaltyNote(shots)).toBe('2/3 pens');
  });

  it('is nothing for one penalty, which is no pile to explain', () => {
    expect(penaltyNote([shot(108, 40, 'goal', 'Penalty')])).toBeUndefined();
    expect(penaltyNote([])).toBeUndefined();
  });
});

describe('a quiet map', () => {
  it('starts at a hundred marks', () => {
    expect(isQuiet(99)).toBe(false);
    expect(isQuiet(100)).toBe(true);
  });

  it('still sizes a mark by area, on a smaller scale than a match', () => {
    const a = quietRadius(0.2, 'saved', 10, 200);
    const b = quietRadius(0.8, 'saved', 10, 200);
    expect((b / a) ** 2).toBeCloseTo(4, 5);
    expect(b).toBeLessThan(markRadius(0.8, 10));
  });

  it('keeps a goal easier to see than the ground at the smallest size', () => {
    expect(quietRadius(0, 'goal', 10, 200) * 10).toBeCloseTo(4, 5);
    expect(quietRadius(0, 'saved', 10, 200) * 10).toBeCloseTo(2.6, 5);
  });

  it('keeps its scale up to 250 marks, then keeps its total ink about the same', () => {
    expect(quietRadius(0.5, 'goal', 100, 100)).toBe(quietRadius(0.5, 'goal', 100, 250));
    const inkOf = (marks: number) => marks * quietRadius(0.5, 'goal', 100, marks) ** 2;
    expect(inkOf(250)).toBeCloseTo(inkOf(1000), 5);
    expect(inkOf(250)).toBeCloseTo(inkOf(4000), 5);
  });

  it('draws a goal as a disc and a hole that follow its size, with no outer ring', () => {
    const plain = markPath('goal', 0, 0, 1, true);
    expect(plain.match(/M/g)).toHaveLength(2);
    expect(markPath('goal', 0, 0, 1).match(/M/g)).toHaveLength(4);
    expect(markPath('saved', 0, 0, 1, true)).toBe(markPath('saved', 0, 0, 1));
  });

  it('only labels spots of three or more, but always the penalty spot if it has a note', () => {
    const marks = [
      { id: 1, x: 108, y: 40 },
      { id: 2, x: 108, y: 40 },
      { id: 3, x: 100, y: 30 },
      { id: 4, x: 100, y: 30 },
    ];
    const stacks = stacksOf(marks);
    expect(countsFrom(99)).toBe(2);
    expect(countsFrom(100)).toBe(3);
    expect(spotsOf(stacks, 3)).toHaveLength(0);
    expect(spotsOf(stacks, 3, true).map((s) => s[0]?.id)).toEqual([1]);
  });
});
