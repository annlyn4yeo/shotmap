import { describe, expect, it } from 'vitest';
import {
  CompareSchema,
  CompetitionsSchema,
  DensitySchema,
  MatchDetailSchema,
  MatchListSchema,
  MatchShotsSchema,
  PlayerSchema,
  PlayerShotsSchema,
  ROUTES,
  SearchSchema,
  envelope,
} from '@shotmap/schema/zod';
import { ATTRIBUTION, LIMITS, shotIdOf } from '@shotmap/schema';
import {
  exportCompare,
  exportCompetitions,
  exportDensity,
  exportMatch,
  exportMatchList,
  exportMatchShots,
  exportPlayer,
  exportPlayerShots,
  exportSearch,
  openDatabase,
  releaseOf,
} from './export';
import { DB_PATH, haveDb } from './testdb';

// Every answer the API will give, computed from the real database and checked against
// the zod schema of its route. These are the queries D1 will run.
describe.skipIf(!haveDb)('the /v1 answers', () => {
  const db = openDatabase(DB_PATH);
  const matchIds = (
    db.prepare('SELECT id FROM matches ORDER BY id').all() as { id: number }[]
  ).map((r) => r.id);
  const playerIds = (
    db.prepare('SELECT id FROM players ORDER BY id').all() as { id: number }[]
  ).map((r) => r.id);
  const MESSI = 5503;

  it('wraps in a release and the attribution', () => {
    const release = releaseOf(db);
    for (const route of ROUTES) {
      expect(
        route.response.safeParse({ release, attribution: ATTRIBUTION }).success,
        route.id,
      ).toBe(false);
    }
    const wrap = envelope(CompetitionsSchema);
    expect(
      wrap.safeParse({ release, attribution: ATTRIBUTION, data: exportCompetitions(db) })
        .success,
    ).toBe(true);
  });

  it('lists competitions, seasons and stages', () => {
    const data = CompetitionsSchema.parse(exportCompetitions(db));
    expect(data.competitions.map((c) => c.name)).toEqual([
      'FIFA World Cup',
      'UEFA Euro',
      'La Liga',
    ]);
    expect(data.competitions.flatMap((c) => c.seasons.map((s) => s.matches))).toEqual([
      64, 51, 34,
    ]);
    expect(data.stages.map((s) => s.name)[6]).toBe('Final');
  });

  it('describes every match, and gives its shots as valid columns', () => {
    expect(matchIds).toHaveLength(149);
    for (const id of matchIds) {
      const detail = MatchDetailSchema.parse(exportMatch(db, id));
      const shots = MatchShotsSchema.parse(exportMatchShots(db, id));
      expect(
        shots.cols.shot.every((s, i) => s === shotIdOf(id, i)),
        `match ${id}`,
      ).toBe(true);
      expect(detail.players.length).toBeGreaterThan(0);
    }
    expect(exportMatch(db, 1)).toBeUndefined();
  });

  it('pages through every match in date order, once each', () => {
    const seen: number[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = MatchListSchema.parse(
        exportMatchList(db, { limit: 50, ...(cursor ? { cursor } : {}) }),
      );
      seen.push(...page.items.map((m) => m.id));
      cursor = page.next ?? undefined;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(149);
    expect(new Set(seen).size).toBe(149);
    const dates = seen.map(
      (id) =>
        (db.prepare('SELECT date FROM matches WHERE id = ?').get(id) as { date: string })
          .date,
    );
    expect([...dates].sort()).toEqual(dates);
  });

  it('filters the match list by season and by team', () => {
    const world = exportMatchList(db, { competition: 43, season: 106, limit: 200 });
    expect(world.items).toHaveLength(64);
    expect(world.next).toBeNull();
    const argentina = exportMatchList(db, { team: 779, limit: 200 });
    expect(argentina.items.length).toBeGreaterThan(5);
    expect(argentina.items.every((m) => m.home.id === 779 || m.away.id === 779)).toBe(
      true,
    );
    expect(
      exportMatchList(db, { from: '2022-12-18', to: '2022-12-18' }).items.map(
        (m) => m.id,
      ),
    ).toEqual([3869685]);
  });

  it('describes a player once, summed across teams', () => {
    for (const id of playerIds) PlayerSchema.parse(exportPlayer(db, id));
    const messi = PlayerSchema.parse(exportPlayer(db, MESSI));
    expect(messi.teams.map((t) => t.name).sort()).toEqual(['Argentina', 'Barcelona']);
    expect(messi.teams.reduce((n, t) => n + t.shots, 0)).toBe(messi.totals.shots);
    expect(messi.totals.matches).toBeGreaterThan(30);
    expect(Object.keys(messi)).not.toContain('team');
    expect(exportPlayer(db, 1)).toBeUndefined();
  });

  it("gives a player's shots across matches, sorted by match", () => {
    const shots = PlayerShotsSchema.parse(exportPlayerShots(db, MESSI));
    expect(shots.n).toBeGreaterThan(100);
    expect(new Set(shots.cols.match).size).toBeGreaterThan(30);
    expect(shots.cols.player.every((p) => p === MESSI)).toBe(true);
    const open = exportPlayerShots(db, MESSI, { period: 'open' });
    expect(open.cols.period.every((p) => p <= 4)).toBe(true);
    const goals = exportPlayerShots(db, MESSI, { outcome: ['goal'] });
    expect(goals.n).toBe(
      PlayerSchema.parse(exportPlayer(db, MESSI)).totals.goals +
        goals.cols.period.filter((p) => p === 5).length,
    );
    const cup = exportPlayerShots(db, MESSI, { competition: 43, season: 106 });
    expect(cup.n).toBeLessThan(shots.n);
    for (const id of playerIds) PlayerShotsSchema.parse(exportPlayerShots(db, id));
  });

  it("counts a player's shots into bins that add up", () => {
    const shots = exportPlayerShots(db, MESSI, { period: 'open' });
    for (const step of LIMITS.densitySteps) {
      const d = DensitySchema.parse(exportDensity(db, MESSI, step, { period: 'open' }));
      expect(
        d.n.reduce((a, b) => a + b, 0),
        `step ${step}`,
      ).toBe(shots.n);
      expect(d.gx.every((g) => g >= 0 && g * step <= 121)).toBe(true);
    }
    const d = exportDensity(db, MESSI, 2, { period: 'open' });
    const goals = d.goals.reduce((a, b) => a + b, 0);
    expect(goals).toBe(PlayerSchema.parse(exportPlayer(db, MESSI)).totals.goals);
    expect(d.xg.reduce((a, b) => a + b, 0)).toBeCloseTo(
      PlayerSchema.parse(exportPlayer(db, MESSI)).totals.xg,
      2,
    );
    expect(() => exportDensity(db, MESSI, 3)).toThrow(RangeError);
    expect(exportDensity(db, 1).n).toEqual([]);
  });

  it('compares two players', () => {
    const c = CompareSchema.parse(exportCompare(db, MESSI, 3961));
    expect(c.a.id).toBe(MESSI);
    expect(exportCompare(db, MESSI, 1)).toBeUndefined();
  });

  it('searches names by the start of a word, folding accents like the client', () => {
    const ids = (q: string) =>
      SearchSchema.parse(exportSearch(db, q)).players.map((p) => p.id);
    expect(ids('mes')).toContain(MESSI);
    expect(ids('lionel mes')).toEqual(expect.arrayContaining([MESSI]));
    expect(ids('lionel mes').length).toBeLessThan(ids('mes').length + 1);
    expect(ids('angel di maria')).toHaveLength(1); // Ángel Di María
    expect(ids('philip foden')).toEqual([4354]); // the other spelling of Phil Foden
    expect(ids('PHIL FOD')).toEqual([4354]);
    expect(ids('essi')).toEqual([]); // inside a word: not a match, by design (docs/adr/0006)
    const arg = SearchSchema.parse(exportSearch(db, 'argentina'));
    expect(arg.teams.map((t) => t.name)).toContain('Argentina');
    expect(arg.matches.length).toBeGreaterThan(5);
    const final = SearchSchema.parse(exportSearch(db, 'argentina france final'));
    expect(final.matches.map((m) => m.id)).toEqual([3869685]);
    expect(exportSearch(db, '  ').players).toEqual([]);
    expect(exportSearch(db, 'a', 5).players.length).toBeLessThanOrEqual(5);
  });
});
