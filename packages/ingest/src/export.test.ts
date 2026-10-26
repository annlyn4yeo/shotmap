import { describe, expect, it } from 'vitest';
import {
  CompareSchema,
  CompetitionsSchema,
  DensitySchema,
  MatchDetailSchema,
  MatchListSchema,
  MatchShotsSchema,
  MetaSchema,
  PlayerSchema,
  PlayerShotsSchema,
  ROUTES,
  SearchSchema,
  envelope,
} from '@shotmap/schema/zod';
import { ATTRIBUTION, LIMITS, shotIdOf } from '@shotmap/schema';
import {
  BadCursor,
  exportCompare,
  exportCompetitions,
  exportDensity,
  exportMatch,
  exportMatchList,
  exportMatchShots,
  exportMeta,
  exportPlayer,
  exportPlayerShots,
  exportSearch,
  releaseOf,
} from '@shotmap/queries';
import { openDb } from './sqlite-db';
import { DB_PATH, haveDb } from './testdb';

// Every answer the API gives, computed from the real database and checked against the zod
// schema of its route. These are the queries D1 runs in the Worker.
describe.skipIf(!haveDb)('the /v1 answers', () => {
  const db = openDb(DB_PATH);
  const ids = (sql: string) =>
    (db.raw.prepare(sql).all() as { id: number }[]).map((r) => r.id);
  const matchIds = ids('SELECT id FROM matches ORDER BY id');
  const playerIds = ids('SELECT id FROM players ORDER BY id');
  const MESSI = 5503;

  it('wraps in a release and the attribution', async () => {
    const release = await releaseOf(db);
    for (const route of ROUTES) {
      expect(
        route.response.safeParse({ release, attribution: ATTRIBUTION }).success,
        route.id,
      ).toBe(false);
    }
    const wrap = envelope(CompetitionsSchema);
    expect(
      wrap.safeParse({
        release,
        attribution: ATTRIBUTION,
        data: await exportCompetitions(db),
      }).success,
    ).toBe(true);
  });

  it('describes the release: source, size, competitions, stages', async () => {
    const meta = MetaSchema.parse(await exportMeta(db));
    expect(meta.source.ref).toBe('4b73468fc5b0f1950f9f66fada70ad3a4f9327cb');
    expect(meta.counts).toEqual({ matches: 149, shots: 3721, players: 843, teams: 64 });
    expect(meta.competitions.map((c) => c.name)).toEqual([
      'FIFA World Cup',
      'UEFA Euro',
      'La Liga',
    ]);
    expect(meta.competitions.flatMap((c) => c.seasons.map((s) => s.matches))).toEqual([
      64, 51, 34,
    ]);
    expect(meta.stages.map((s) => s.name)[6]).toBe('Final');
  });

  it('keeps its stored counts honest', () => {
    const count = (t: string) =>
      (db.raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    const rows = db.raw
      .prepare("SELECT key, value FROM meta WHERE key LIKE 'count_%'")
      .all() as { key: string; value: string }[];
    const stored = Object.fromEntries(rows.map((r) => [r.key, Number(r.value)]));
    expect(stored).toEqual({
      count_matches: count('matches'),
      count_shots: count('shots'),
      count_players: count('players'),
      count_teams: count('teams'),
    });
    const bad = db.raw
      .prepare(
        'SELECT s.competition_id, s.id FROM seasons s WHERE s.match_count != (SELECT COUNT(*) FROM matches m WHERE m.competition_id = s.competition_id AND m.season_id = s.id)',
      )
      .all();
    expect(bad).toEqual([]);
  });

  it('describes every match, and gives its shots as valid columns', async () => {
    expect(matchIds).toHaveLength(149);
    for (const id of matchIds) {
      const detail = MatchDetailSchema.parse(await exportMatch(db, id));
      const shots = MatchShotsSchema.parse(await exportMatchShots(db, id));
      expect(
        shots.cols.shot.every((s, i) => s === shotIdOf(id, i)),
        `match ${id}`,
      ).toBe(true);
      expect(detail.players.length).toBeGreaterThan(0);
    }
    expect(await exportMatch(db, 1)).toBeUndefined();
    expect(await exportMatchShots(db, 1)).toBeUndefined();
  });

  it('pages through every match in date order, once each', async () => {
    const seen: number[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = MatchListSchema.parse(
        await exportMatchList(db, { limit: 50, ...(cursor ? { cursor } : {}) }),
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
        (
          db.raw.prepare('SELECT date FROM matches WHERE id = ?').get(id) as {
            date: string;
          }
        ).date,
    );
    expect([...dates].sort()).toEqual(dates);
  });

  it('never returns more than the page cap, whatever limit is asked', async () => {
    const page = await exportMatchList(db, { limit: 100_000 });
    expect(page.items.length).toBeLessThanOrEqual(LIMITS.matchesPageMax);
    expect(page.items).toHaveLength(149);
    expect((await exportMatchList(db, { limit: 0 })).items).toHaveLength(1);
  });

  it('rejects a cursor that is not ours', async () => {
    await expect(
      exportMatchList(db, { cursor: 'x; DROP TABLE matches' }),
    ).rejects.toThrow(BadCursor);
    await expect(exportMatchList(db, { cursor: '2022-13-45_9999_x' })).rejects.toThrow(
      BadCursor,
    );
  });

  it('filters the match list by season and by team', async () => {
    const world = await exportMatchList(db, { competition: 43, season: 106, limit: 200 });
    expect(world.items).toHaveLength(64);
    expect(world.next).toBeNull();
    const argentina = await exportMatchList(db, { team: 779, limit: 200 });
    expect(argentina.items.length).toBeGreaterThan(5);
    expect(argentina.items.every((m) => m.home.id === 779 || m.away.id === 779)).toBe(
      true,
    );
    const day = await exportMatchList(db, { from: '2022-12-18', to: '2022-12-18' });
    expect(day.items.map((m) => m.id)).toEqual([3869685]);
  });

  it('plans the match list on the date index', () => {
    const plan = db.raw
      .prepare(
        "EXPLAIN QUERY PLAN SELECT m.id FROM matches m WHERE m.date >= ? AND (m.date, COALESCE(m.kickoff, ''), m.id) > (?, ?, ?) ORDER BY m.date, COALESCE(m.kickoff, ''), m.id LIMIT 51",
      )
      .all('2022-11-20', '2022-11-20', '', 0) as { detail: string }[];
    expect(plan.map((p) => p.detail).join(' | ')).toContain('matches_date');
  });

  it('describes a player once, summed across teams', async () => {
    for (const id of playerIds) PlayerSchema.parse(await exportPlayer(db, id));
    const messi = PlayerSchema.parse(await exportPlayer(db, MESSI));
    expect(messi.teams.map((t) => t.name).sort()).toEqual(['Argentina', 'Barcelona']);
    expect(messi.teams.reduce((n, t) => n + t.shots, 0)).toBe(messi.totals.shots);
    expect(messi.totals.matches).toBeGreaterThan(30);
    expect(Object.keys(messi)).not.toContain('team');
    expect(await exportPlayer(db, 1)).toBeUndefined();
  });

  it("gives a player's shots across matches, sorted by match", async () => {
    const shots = PlayerShotsSchema.parse(await exportPlayerShots(db, MESSI));
    expect(shots.n).toBeGreaterThan(100);
    expect(new Set(shots.cols.match).size).toBeGreaterThan(30);
    expect(shots.cols.player.every((p) => p === MESSI)).toBe(true);
    const open = await exportPlayerShots(db, MESSI, { period: 'open' });
    expect(open.cols.period.every((p) => p <= 4)).toBe(true);
    const goals = await exportPlayerShots(db, MESSI, { outcome: ['goal'] });
    const totals = PlayerSchema.parse(await exportPlayer(db, MESSI)).totals;
    expect(goals.n).toBe(totals.goals + goals.cols.period.filter((p) => p === 5).length);
    const cup = await exportPlayerShots(db, MESSI, { competition: 43, season: 106 });
    expect(cup.n).toBeLessThan(shots.n);
    for (const id of playerIds) PlayerShotsSchema.parse(await exportPlayerShots(db, id));
  });

  it("counts a player's shots into bins that add up", async () => {
    const shots = await exportPlayerShots(db, MESSI, { period: 'open' });
    const totals = PlayerSchema.parse(await exportPlayer(db, MESSI)).totals;
    for (const step of LIMITS.densitySteps) {
      const d = DensitySchema.parse(
        await exportDensity(db, MESSI, step, { period: 'open' }),
      );
      expect(
        d.n.reduce((a, b) => a + b, 0),
        `step ${step}`,
      ).toBe(shots.n);
      expect(d.gx.every((g) => g >= 0 && g * step <= 121)).toBe(true);
    }
    const d = await exportDensity(db, MESSI, 2, { period: 'open' });
    expect(d.goals.reduce((a, b) => a + b, 0)).toBe(totals.goals);
    expect(d.xg.reduce((a, b) => a + b, 0)).toBeCloseTo(totals.xg, 2);
    await expect(exportDensity(db, MESSI, 3)).rejects.toThrow(RangeError);
    expect((await exportDensity(db, 1)).n).toEqual([]);
  });

  it('compares two players', async () => {
    const c = CompareSchema.parse(await exportCompare(db, MESSI, 3961));
    expect(c.a.id).toBe(MESSI);
    expect(await exportCompare(db, MESSI, 1)).toBeUndefined();
  });

  it('searches names by the start of a word, folding accents like the client', async () => {
    const found = async (q: string) =>
      SearchSchema.parse(await exportSearch(db, q)).players.map((p) => p.id);
    expect(await found('mes')).toContain(MESSI);
    expect(await found('lionel mes')).toEqual(expect.arrayContaining([MESSI]));
    expect(await found('angel di maria')).toHaveLength(1); // Ángel Di María
    expect(await found('philip foden')).toEqual([4354]); // the other spelling of Phil Foden
    expect(await found('PHIL FOD')).toEqual([4354]);
    expect(await found('essi')).toEqual([]); // inside a word: not a match, by design (docs/adr/0006)
    const arg = SearchSchema.parse(await exportSearch(db, 'argentina'));
    expect(arg.teams.map((t) => t.name)).toContain('Argentina');
    expect(arg.matches.length).toBeGreaterThan(5);
    const final = SearchSchema.parse(await exportSearch(db, 'argentina france final'));
    expect(final.matches.map((m) => m.id)).toEqual([3869685]);
    expect((await exportSearch(db, '  ')).players).toEqual([]);
    expect((await exportSearch(db, 'a', 5)).players.length).toBeLessThanOrEqual(5);
  });
});
