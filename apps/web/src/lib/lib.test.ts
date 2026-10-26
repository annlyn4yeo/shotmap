import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fitFrom, frameFor } from '../components/frame';
import { decodeShots } from '../data/shots';
import { OUTCOMES, type IndexFile, type MatchFile } from '@shotmap/schema';
import { placeShootout, playerCounts, teamStats } from './derive';
import { markRadius } from './geometry';
import { markPath } from './marks';

const index = JSON.parse(readFileSync('public/data/index.json', 'utf8')) as IndexFile;
const match = JSON.parse(
  readFileSync(`public/data/matches/${index.hero}.json`, 'utf8'),
) as MatchFile;

describe('mark radius', () => {
  it('grows with the square root of xG, so area follows xG', () => {
    const a = markRadius(0.2, 10);
    const b = markRadius(0.8, 10);
    expect(b / a).toBeCloseTo(2, 5);
  });

  it('never drops below the minimum on-screen size', () => {
    expect(markRadius(0, 4) * 4).toBeCloseTo(7, 5);
    expect(markRadius(0.01, 2) * 2).toBeCloseTo(7, 5);
  });
});

describe('mark paths', () => {
  it('is one path string per outcome, centred on the shot', () => {
    for (const outcome of OUTCOMES) {
      const d = markPath(outcome, 100, 40, 3);
      expect(d.startsWith('M')).toBe(true);
      expect(d).not.toContain('NaN');
    }
  });

  it('draws a goal as four nested circles (ring, gap, disc, hole)', () => {
    expect(markPath('goal', 0, 0, 3).match(/Z/g)).toHaveLength(4);
  });
});

describe('frames', () => {
  it('maps pitch to screen directly when horizontal', () => {
    const f = frameFor('full', 'horizontal');
    expect(f.transform).toBeUndefined();
    expect(f.place(30, 20)).toEqual({ x: 30, y: 20 });
  });

  it('rotates once for a vertical pitch, with the goal (x = 120) at the top', () => {
    const f = frameFor('half', 'vertical');
    expect(f.transform).toBe('matrix(0 -1 1 0 0 120)');
    expect(f.place(120, 40)).toEqual({ x: 40, y: 0 });
    expect(f.place(60, 0)).toEqual({ x: 0, y: 60 });
  });

  it('crops a pitch to start where asked, so a close-up has no empty yards', () => {
    const f = frameFor('half', 'vertical', 80);
    expect(f.xMin).toBe(80);
    // 40 yards deep: the goal line is at the top, the cut edge 40 yards down.
    expect(f.place(80, 40).y).toBe(40);
    expect(f.h).toBeLessThan(frameFor('half', 'vertical').h);
  });

  it('starts the half pitch at the halfway line', () => {
    expect(frameFor('half', 'horizontal').xMin).toBe(60);
    expect(frameFor('full', 'horizontal').xMin).toBe(0);
  });
});

describe('fitting the crop to the room', () => {
  it('shows more pitch when the box is tall, but never starts earlier than the halfway line', () => {
    expect(fitFrom({ w: 712, h: 486 }, 80)).toBe(65);
    expect(fitFrom({ w: 400, h: 900 }, 80)).toBe(60);
  });

  it('keeps the data crop when the box is short, so every shot stays in view', () => {
    expect(fitFrom({ w: 712, h: 300 }, 80)).toBe(80);
  });

  it('falls back to the data crop before the box is measured', () => {
    expect(fitFrom({ w: 0, h: 0 }, 80)).toBe(80);
  });
});

describe('decoding the final', () => {
  const shots = decodeShots(match, index.enums);
  const open = shots.filter((s) => !s.shootout);

  it('turns columns into one object per shot, in match order, then the shootout kicks', () => {
    expect(open).toHaveLength(match.shots.x.length);
    expect(shots).toHaveLength(match.shots.x.length + (match.shootout?.x.length ?? 0));
    expect(shots.map((s) => s.id)).toEqual(shots.map((_, i) => i));
    expect(shots.slice(open.length).every((s) => s.shootout && s.period === 5)).toBe(
      true,
    );
  });

  it('keeps the six open-play goals as the goal mark and names the scorers', () => {
    const goals = open.filter((s) => s.outcome === 'goal');
    expect(goals).toHaveLength(6);
    expect(goals.map((s) => s.player)).toContain('Lionel Messi');
    expect(goals.find((s) => s.player === 'Lionel Messi')?.shotType).toBe('Penalty');
  });

  it('gives every shot the index of its player, so the filter and the URL can name them', () => {
    for (const s of shots) expect(match.players[s.playerIdx]?.[0]).toBe(s.player);
  });
});

describe('derived data', () => {
  const shots = decodeShots(match, index.enums);
  const open = shots.filter((s) => !s.shootout);

  it('counts one team: shots, on target, goals and xG', () => {
    const mine = open.filter((s) => s.team === 0);
    const arg = teamStats(mine);
    expect(arg.shots).toBe(20);
    expect(arg.goals).toBe(3);
    expect(arg.onTarget).toBe(10);
    expect(arg.xg).toBeCloseTo(2.76, 1);
    expect(arg.delta).toBeCloseTo(arg.goals - arg.xg, 10);
    expect(arg.biggest?.xg).toBe(Math.max(...mine.map((s) => s.xg)));
  });

  it('lists only players who shot, most shots first, with their counts', () => {
    const counts = playerCounts(open);
    expect(counts.reduce((n, p) => n + p.count, 0)).toBe(open.length);
    expect(counts.every((p) => p.count > 0)).toBe(true);
    expect(counts[0]?.count).toBeGreaterThanOrEqual(
      counts[counts.length - 1]?.count ?? 0,
    );
  });

  it('fans each team shootout kicks across the spot so they do not stack', () => {
    const kicks = shots.filter((s) => s.shootout && s.team === 0);
    const placed = placeShootout(shots);
    const ys = kicks.map((s) => placed.get(s.id)?.y ?? NaN);
    expect(new Set(ys).size).toBe(kicks.length);
    expect(ys.reduce((a, b) => a + b, 0) / ys.length).toBeCloseTo(40, 5);
    expect(kicks.every((s) => placed.get(s.id)?.x === s.x)).toBe(true);
  });
});
