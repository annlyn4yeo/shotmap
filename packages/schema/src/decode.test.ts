import { describe, expect, it } from 'vitest';
import type { MatchShots } from './api';
import { DecodeError, decodeShotsStrict, type DecodeContext } from './decode';

const payload = (): MatchShots => ({
  n: 2,
  cols: {
    shot: [3869685000, 3869685001],
    seq: [0, 1],
    side: [0, 1],
    team: [779, 771],
    player: [5503, 3961],
    period: [1, 2],
    min: [4, 70],
    sec: [40, 5],
    x: [92.4, 99.2],
    y: [30, 47.9],
    ex: [117.3, 108.1],
    ey: [38.3, 40.4],
    ez: [0.8, null],
    xg: [0.025, 0.063],
    out: [100, 97],
    body: [40, 38],
    type: [87, 88],
    tech: [93, 91],
  },
});

const context = (): DecodeContext => ({
  teams: new Map([
    [779, 'Argentina'],
    [771, 'France'],
  ]),
  players: new Map([
    [5503, { name: 'Lionel Messi', shirt: 10, side: 0 }],
    [3961, { name: 'Kylian Mbappé', shirt: 10, side: 1 }],
  ]),
});

/** Decoding the payload after one change must throw a DecodeError that says what is wrong. */
const fails = (change: (p: MatchShots) => void, message: RegExp, ctx = context()) => {
  const p = payload();
  change(p);
  expect(() => decodeShotsStrict(p, ctx)).toThrow(DecodeError);
  expect(() => decodeShotsStrict(p, ctx)).toThrow(message);
};

describe('the strict decoder', () => {
  it('decodes a payload into what the views use, with the names looked up', () => {
    const [first, second] = decodeShotsStrict(payload(), context());
    expect(first).toEqual({
      id: 0,
      team: 0,
      player: 'Lionel Messi',
      shirt: 10,
      min: 4,
      sec: 40,
      period: 1,
      shootout: false,
      x: 92.4,
      y: 30,
      ex: 117.3,
      ey: 38.3,
      ez: 0.8,
      xg: 0.025,
      outcome: 'saved',
      outcomeLabel: 'Saved',
      bodyPart: 'Right Foot',
      shotType: 'Open Play',
      technique: 'Normal',
      shotId: 3869685000,
      teamId: 779,
      playerId: 5503,
      matchId: null,
    });
    expect(second?.outcome).toBe('goal');
    expect(second?.shotType).toBe('Penalty');
    expect(second?.technique).toBe('Half Volley');
    expect(second?.ez).toBeNull();
  });

  it('reads the match of a cross-match payload', () => {
    const p = payload();
    const cross = { n: 2, cols: { ...p.cols, match: [10, 12] } };
    expect(decodeShotsStrict(cross, context()).map((s) => s.matchId)).toEqual([10, 12]);
  });

  it('marks period 5 as the shootout', () => {
    const p = payload();
    p.cols.period = [1, 5];
    expect(decodeShotsStrict(p, context()).map((s) => s.shootout)).toEqual([false, true]);
  });

  it('throws on an unknown team', () => {
    fails((p) => (p.cols.team[1] = 1), /row 1: unknown team id 1/);
  });

  it('throws on an unknown player, instead of calling them "Unknown player"', () => {
    fails((p) => (p.cols.player[0] = 99), /row 0: unknown player id 99/);
  });

  it('throws on an unknown outcome, instead of drawing a cross', () => {
    fails((p) => (p.cols.out[1] = 9999), /row 1: unknown outcome id 9999/);
  });

  it('throws on an unknown body part', () => {
    fails((p) => (p.cols.body[0] = 1), /row 0: unknown body part id 1/);
  });

  it('throws on an unknown shot type', () => {
    fails((p) => (p.cols.type[0] = 1), /row 0: unknown shot type id 1/);
  });

  it('throws on an unknown technique', () => {
    fails((p) => (p.cols.tech[1] = 1), /row 1: unknown technique id 1/);
  });

  it('throws on a side that is not 0 or 1, instead of calling it the home team', () => {
    fails((p) => ((p.cols.side as number[])[1] = 779), /row 1: side 779 is not 0 or 1/);
  });

  it('throws on a player who is on the other side', () => {
    fails((p) => (p.cols.side[0] = 1), /row 0: player 5503 is on the other side/);
  });

  it('throws on a period outside 1 to 5', () => {
    fails((p) => (p.cols.period[0] = 0), /row 0: period 0 is not 1 to 5/);
    fails((p) => (p.cols.period[0] = 6), /row 0: period 6 is not 1 to 5/);
  });

  it('throws on columns of different lengths, and on a missing column', () => {
    fails((p) => p.cols.xg.pop(), /column xg has 1 rows, n is 2/);
    fails((p) => Reflect.deleteProperty(p.cols, 'tech'), /column tech is missing/);
  });

  it('throws on a value that is not a number, and on a bad ez', () => {
    fails((p) => ((p.cols.x as unknown[])[0] = '92.4'), /row 0: x is not a number/);
    fails((p) => ((p.cols.xg as unknown[])[1] = NaN), /row 1: xg is not a number/);
    fails(
      (p) => ((p.cols.ez as unknown[])[0] = 'high'),
      /row 0: ez is neither a number nor null/,
    );
  });

  it('checks the side only when the context knows it (a cross-match payload does not)', () => {
    const ctx = context();
    ctx.players = new Map([[5503, { name: 'Lionel Messi', shirt: 10 }]]);
    const p = payload();
    p.cols.player = [5503, 5503];
    expect(decodeShotsStrict(p, ctx)).toHaveLength(2);
  });
});
