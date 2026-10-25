import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PITCH,
  SCHEMA_VERSION,
  type IndexFile,
  type MatchFile,
  type ShotColumns,
} from './types';

// These tests read the committed output of `pnpm data`.
const DIR = 'public/data';
const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(join(DIR, path), 'utf8'));
const readIndex = () => readJson('index.json') as IndexFile;
const readMatch = (id: number) => readJson(`matches/${id}.json`) as MatchFile;

if (!existsSync(join(DIR, 'index.json')))
  throw new Error('No generated data. Run `pnpm data` first.');

const index = readIndex();
const rows = index.competitions.flatMap((c) => c.seasons.flatMap((s) => s.matches));
const outcomeIds = new Set(index.enums.outcome.map((e) => e.id));
const bodyIds = new Set(index.enums.bodyPart.map((e) => e.id));
const typeIds = new Set(index.enums.shotType.map((e) => e.id));
const techIds = new Set(index.enums.technique.map((e) => e.id));
const goalId = index.enums.outcome.find((e) => e.name === 'Goal')?.id;

const COLUMNS = [
  'min',
  'sec',
  'per',
  'team',
  'player',
  'x',
  'y',
  'ex',
  'ey',
  'ez',
  'xg',
  'out',
  'body',
  'type',
  'tech',
] as const;

/** Event coordinates run a hair past the pitch (x reaches 120.1 in the real data). */
const SLACK = 0.5;
const decimals = (v: number, dp: number) =>
  Math.abs(v * 10 ** dp - Math.round(v * 10 ** dp)) < 1e-6;

function goalsBy(cols: ShotColumns, team: number): number {
  return cols.out.filter((o, i) => o === goalId && cols.team[i] === team).length;
}

describe('index.json', () => {
  it('has the expected shape', () => {
    expect(index.v).toBe(SCHEMA_VERSION);
    expect(index.pitch).toEqual({
      length: PITCH.length,
      width: PITCH.width,
      goalY: [...PITCH.goalY],
    });
    expect(index.competitions.length).toBeGreaterThanOrEqual(3);
    expect(index.stages.length).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThan(100);
  });

  it('describes every outcome with one of the five UI marks', () => {
    const groups = new Set(['goal', 'saved', 'off', 'blocked', 'post']);
    expect(index.enums.outcome.map((e) => e.name)).toEqual(
      expect.arrayContaining(['Goal', 'Saved', 'Off T', 'Blocked', 'Post']),
    );
    for (const e of index.enums.outcome) expect(groups.has(e.group), e.name).toBe(true);
    for (const list of [
      index.enums.outcome,
      index.enums.bodyPart,
      index.enums.shotType,
      index.enums.technique,
    ]) {
      expect(new Set(list.map((e) => e.id)).size).toBe(list.length);
    }
  });

  it('lists well-formed rows in date order, with unique ids', () => {
    const problems: string[] = [];
    for (const c of index.competitions) {
      for (const s of c.seasons) {
        let previous = '';
        for (const row of s.matches) {
          const [id, date, home, away, hs, as, stage, hp, ap] = row;
          if ((row as readonly unknown[]).length !== 9)
            problems.push(`${id}: wrong field count`);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push(`${id}: bad date ${date}`);
          if (date < previous)
            problems.push(`${id}: out of order in ${c.name} ${s.name}`);
          previous = date;
          if (!home || !away) problems.push(`${id}: missing team name`);
          if (!Number.isInteger(hs) || !Number.isInteger(as))
            problems.push(`${id}: bad score`);
          if (index.stages[stage] === undefined)
            problems.push(`${id}: bad stage index ${stage}`);
          if ((hp === null) !== (ap === null))
            problems.push(`${id}: half a shootout score`);
        }
      }
    }
    expect(problems).toEqual([]);
    expect(new Set(rows.map((r) => r[0])).size).toBe(rows.length);
  });

  it('points at a hero match that exists', () => {
    expect(rows.some((r) => r[0] === index.hero)).toBe(true);
  });

  it('has one file per listed match and no strays', () => {
    const files = readdirSync(join(DIR, 'matches')).sort();
    expect(files).toEqual(rows.map((r) => `${r[0]}.json`).sort());
  });
});

describe('match files', () => {
  it('all match the schema', () => {
    const problems: string[] = [];

    for (const row of rows) {
      const m = readMatch(row[0]);
      const at = (msg: string) => problems.push(`${row[0]}: ${msg}`);

      if (m.v !== SCHEMA_VERSION) at('wrong version');
      if (m.meta.id !== row[0]) at('meta id differs from file name');
      if (m.meta.teams.length !== 2) at('needs two teams');
      if (m.meta.teams[0].score !== row[4] || m.meta.teams[1].score !== row[5])
        at('score differs from index');
      if (!m.meta.competition.name || !m.meta.season.name || !m.meta.stage)
        at('missing competition, season or stage');

      for (const p of m.players) {
        if (typeof p[0] !== 'string' || !p[0] || (p[1] !== 0 && p[1] !== 1))
          at(`bad player ${JSON.stringify(p)}`);
        if (p[2] !== null && !Number.isInteger(p[2])) at(`bad shirt ${String(p[2])}`);
      }

      const sets: [string, ShotColumns | null][] = [
        ['shots', m.shots],
        ['shootout', m.shootout],
      ];
      for (const [name, cols] of sets) {
        if (!cols) continue;
        const n = cols.x.length;
        if (name === 'shootout' && n === 0) at('empty shootout should be null');
        for (const key of COLUMNS) {
          if (cols[key].length !== n)
            at(`${name}.${key} has ${cols[key].length} items, expected ${n}`);
        }
        for (let i = 0; i < n; i++) {
          const here = `${name}[${i}]`;
          const per = cols.per[i] ?? 0;
          if (name === 'shots' ? per < 1 || per > 4 : per !== 5)
            at(`${here} in period ${per}`);
          if (cols.team[i] !== 0 && cols.team[i] !== 1) at(`${here} team`);
          if ((cols.player[i] ?? -1) < 0 || (cols.player[i] ?? 0) >= m.players.length)
            at(`${here} player index`);
          else if (m.players[cols.player[i] ?? 0]?.[1] !== cols.team[i])
            at(`${here} player is on the other team`);
          if (!outcomeIds.has(cols.out[i] ?? -1)) at(`${here} outcome id ${cols.out[i]}`);
          if (!bodyIds.has(cols.body[i] ?? -1)) at(`${here} body part id`);
          if (!typeIds.has(cols.type[i] ?? -1)) at(`${here} shot type id`);
          if (!techIds.has(cols.tech[i] ?? -1)) at(`${here} technique id`);

          const x = cols.x[i] ?? NaN;
          const y = cols.y[i] ?? NaN;
          const ex = cols.ex[i] ?? NaN;
          const ey = cols.ey[i] ?? NaN;
          const ez = cols.ez[i];
          const xg = cols.xg[i] ?? NaN;
          if (!(
            x >= 0 &&
            x <= PITCH.length + SLACK &&
            y >= 0 &&
            y <= PITCH.width + SLACK
          ))
            at(`${here} start off the pitch: ${x}, ${y}`);
          if (!(
            ex >= 0 &&
            ex <= PITCH.length + SLACK &&
            ey >= 0 &&
            ey <= PITCH.width + SLACK
          ))
            at(`${here} end off the pitch: ${ex}, ${ey}`);
          if (ez !== null && ez !== undefined && !(ez >= 0 && ez < 10))
            at(`${here} height ${ez}`);
          for (const v of [x, y, ex, ey, ez ?? 0])
            if (!decimals(v, 1)) at(`${here} coordinate ${v} has more than 1 decimal`);
          if (!(xg >= 0 && xg <= 1) || !decimals(xg, 3)) at(`${here} xg ${xg}`);
          if (!Number.isInteger(cols.min[i]) || !Number.isInteger(cols.sec[i]))
            at(`${here} time`);
        }
        // Chronological within the file.
        for (let i = 1; i < n; i++) {
          const a =
            (cols.per[i - 1] ?? 0) * 1e6 +
            (cols.min[i - 1] ?? 0) * 100 +
            (cols.sec[i - 1] ?? 0);
          const b =
            (cols.per[i] ?? 0) * 1e6 + (cols.min[i] ?? 0) * 100 + (cols.sec[i] ?? 0);
          if (b < a) at(`${name} not in time order at ${i}`);
        }
      }

      const hasKicks = m.shootout !== null;
      if (hasKicks !== (m.meta.teams[0].pens !== null)) at('pens and shootout disagree');
      if (m.shootout) {
        for (const t of [0, 1] as const) {
          if (goalsBy(m.shootout, t) !== m.meta.teams[t].pens)
            at(`team ${t} pens do not match the shootout kicks`);
        }
      }
      // Own goals are not shots, so shot goals can fall short of the score but never exceed it.
      for (const t of [0, 1] as const) {
        if (goalsBy(m.shots, t) > m.meta.teams[t].score)
          at(`team ${t} has more goals than its score`);
      }
    }

    expect(problems).toEqual([]);
  });
});

describe('the final (hero match)', () => {
  const final = readMatch(index.hero);
  const [argentina, france] = final.meta.teams;

  it('is Argentina v France, 3-3 before the shootout', () => {
    expect(final.meta.competition.name).toBe('FIFA World Cup');
    expect(final.meta.season.name).toBe('2022');
    expect(final.meta.stage).toBe('Final');
    expect([argentina.name, france.name]).toEqual(['Argentina', 'France']);
    expect([argentina.score, france.score]).toEqual([3, 3]);
  });

  it('has goals in open shots that match the score before penalties', () => {
    expect(goalsBy(final.shots, 0)).toBe(argentina.score);
    expect(goalsBy(final.shots, 1)).toBe(france.score);
  });

  it('keeps shootout kicks out of the default shots', () => {
    expect(final.shots.per.every((p) => p >= 1 && p <= 4)).toBe(true);
    expect(final.shootout).not.toBeNull();
    expect(final.shootout?.per.every((p) => p === 5)).toBe(true);
    expect([argentina.pens, france.pens]).toEqual([4, 2]);
  });

  it('names Messi and Mbappé as scorers with real shirt numbers', () => {
    const scorers = new Set(
      final.shots.out.flatMap((o, i) =>
        o === goalId ? [final.players[final.shots.player[i] ?? 0]?.[0]] : [],
      ),
    );
    expect(scorers).toEqual(new Set(['Lionel Messi', 'Ángel Di María', 'Kylian Mbappé']));
    expect(final.players.find((p) => p[0] === 'Lionel Messi')?.[2]).toBe(10);
  });
});

describe('coordinate system', () => {
  // The facts recorded in CLAUDE.md, checked against every goal and post hit we ship.
  const goalShots: { x: number; ex: number; ey: number; ez: number | null }[] = [];
  for (const row of rows) {
    const m = readMatch(row[0]);
    m.shots.out.forEach((o, i) => {
      if (o === goalId) {
        goalShots.push({
          x: m.shots.x[i] ?? 0,
          ex: m.shots.ex[i] ?? 0,
          ey: m.shots.ey[i] ?? 0,
          ez: m.shots.ez[i] ?? null,
        });
      }
    });
  }

  it('has every team attacking toward x = 120', () => {
    expect(goalShots.length).toBeGreaterThan(300);
    expect(goalShots.every((g) => g.x > PITCH.length / 2)).toBe(true);
    expect(goalShots.every((g) => g.ex >= 119.5)).toBe(true);
  });

  it('puts goals between the posts, below the bar', () => {
    const [left, right] = PITCH.goalY;
    expect(goalShots.every((g) => g.ey >= left - 0.5 && g.ey <= right + 0.5)).toBe(true);
    expect(goalShots.every((g) => g.ez === null || g.ez <= 2.67)).toBe(true);
  });
});
