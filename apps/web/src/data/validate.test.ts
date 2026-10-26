import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { IndexFile, MatchFile } from '@shotmap/schema';
import { ShotColumnsSchema } from '@shotmap/schema/zod';
import { COLUMN_KEYS, DataError, assertIndex, assertMatch } from './validate';

const read = (path: string): unknown =>
  JSON.parse(readFileSync(`public/data/${path}`, 'utf8'));
const index = read('index.json') as IndexFile;
const final = read(`matches/${index.hero}.json`) as MatchFile;
const matchFiles = readdirSync('public/data/matches');

/** A deep copy of the final that a test can break. */
const broken = (change: (m: MatchFile) => void): MatchFile => {
  const copy = structuredClone(final);
  change(copy);
  return copy;
};

describe('the hand-written validator', () => {
  it('accepts the index and all match files, as the zod schemas do', () => {
    expect(() => assertIndex(index)).not.toThrow();
    for (const file of matchFiles) {
      expect(() => assertMatch(read(`matches/${file}`), index.enums), file).not.toThrow();
    }
  });

  it('knows exactly the columns the schema has', () => {
    expect([...COLUMN_KEYS].sort()).toEqual(Object.keys(ShotColumnsSchema.shape).sort());
  });

  it('rejects columns of different lengths', () => {
    const m = broken((c) => c.shots.xg.pop());
    expect(() => assertMatch(m, index.enums)).toThrow(/column xg has \d+ rows/);
  });

  it('rejects a missing column', () => {
    const m = broken((c) => Reflect.deleteProperty(c.shots, 'tech'));
    expect(() => assertMatch(m, index.enums)).toThrow(/column tech is missing/);
  });

  it('rejects an enum id it does not know', () => {
    const m = broken((c) => (c.shots.out[0] = 9999));
    expect(() => assertMatch(m, index.enums)).toThrow(/unknown out id 9999/);
    const body = broken((c) => (c.shots.body[3] = -1));
    expect(() => assertMatch(body, index.enums)).toThrow(/unknown body id -1/);
  });

  it('rejects a player index out of range, or on the other team', () => {
    const range = broken((c) => (c.shots.player[0] = c.players.length));
    expect(() => assertMatch(range, index.enums)).toThrow(
      /player index \d+ is out of range/,
    );
    const other = broken((c) => (c.shots.team[0] = c.shots.team[0] === 0 ? 1 : 0));
    expect(() => assertMatch(other, index.enums)).toThrow(/other team/);
  });

  it('rejects a team id that is not 0 or 1 (decodeShots would call it the home team)', () => {
    const m = broken((c) => ((c.shots.team as number[])[0] = 779));
    expect(() => assertMatch(m, index.enums)).toThrow(/team 779 is not 0 or 1/);
  });

  it('rejects shots in the wrong period, and an empty shootout', () => {
    const shot = broken((c) => (c.shots.per[0] = 5));
    expect(() => assertMatch(shot, index.enums)).toThrow(/period 5/);
    const kick = broken((c) => {
      if (c.shootout) c.shootout.per[0] = 2;
    });
    expect(() => assertMatch(kick, index.enums)).toThrow(/period 2/);
  });

  it('rejects a wrong version and a bad index', () => {
    const v = broken((c) => ((c as { v: number }).v = 2));
    expect(() => assertMatch(v, index.enums)).toThrow(DataError);
    const noHero = { ...index, hero: 1 };
    expect(() => assertIndex(noHero)).toThrow(/hero match is not listed/);
    const group = structuredClone(index);
    (group.enums.outcome[0] as { group: string }).group = 'wide';
    expect(() => assertIndex(group)).toThrow(/unknown group wide/);
  });

  it('throws a DataError, not a TypeError, for input that is not even an object', () => {
    expect(() => assertMatch(null, index.enums)).toThrow(DataError);
    expect(() => assertMatch('x', index.enums)).toThrow(DataError);
    expect(() => assertIndex([])).toThrow(DataError);
  });
});
