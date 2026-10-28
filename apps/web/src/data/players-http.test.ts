import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The player page's data, through the code the page runs, against a running API (`wrangler dev`
// in CI, see .github/workflows/ci.yml): the most prolific player in the data, Lionel Messi. With the
// three competitions of the static files he shot in 41 matches; in the whole catalogue, 587. The
// figures that hold either way are asserted from the profile, and the ones that are the same in
// both (his 2022 World Cup and his 2018/19 La Liga) are named.
const API_URL = process.env.API_URL;
const MESSI = 5503;

describe.skipIf(!API_URL)(`the player page's data (${API_URL ?? 'no API_URL'})`, () => {
  let players: typeof import('./players');
  // Imported after the reset, with the code under test, so it is the class that code throws.
  let client: typeof import('../api/client');

  beforeAll(async () => {
    vi.stubEnv('VITE_API_URL', API_URL ?? '');
    vi.resetModules();
    players = await import('./players');
    client = await import('../api/client');
  });
  afterAll(() => vi.unstubAllEnvs());

  it('has a profile whose seasons add up to his career', async () => {
    const messi = await players.loadPlayer(MESSI);
    expect(messi.name).toBe('Lionel Messi');
    expect(messi.seasons.length).toBeGreaterThanOrEqual(2);
    for (const field of ['matches', 'shots', 'goals', 'onTarget'] as const)
      expect(
        messi.seasons.reduce((n, s) => n + s[field], 0),
        field,
      ).toBe(messi.totals[field]);
    // Two seasons every build has, and what the static files say of them.
    const of = (c: number, s: number) =>
      messi.seasons.find((x) => x.competition.id === c && x.season.id === s);
    expect(of(43, 106)).toMatchObject({ matches: 7, shots: 32, goals: 7 });
    expect(of(11, 4)).toMatchObject({ matches: 34, shots: 171, goals: 36 });
  });

  it('gives every shot of the career, decoded, none left out when the limit allows', async () => {
    const messi = await players.loadPlayer(MESSI);
    const all = await players.loadPlayerShots(
      messi,
      { competition: null, season: null },
      messi.totals.shots + 1,
    );
    expect(all.truncated).toBe(false);
    expect(all.shots).toHaveLength(messi.totals.shots);
    expect(new Set(all.shots.map((s) => s.matchId)).size).toBe(messi.totals.matches);
    // A shot is unique by its global id, though positions repeat from match to match.
    expect(new Set(all.shots.map((s) => s.shotId)).size).toBe(all.shots.length);
    expect(new Set(all.shots.map((s) => s.id)).size).toBeLessThan(all.shots.length);
    expect(all.shots.every((s) => s.player === 'Lionel Messi' && !s.shootout)).toBe(true);
  });

  it('gives one season of it, which is what the table says it is', async () => {
    const messi = await players.loadPlayer(MESSI);
    for (const season of messi.seasons) {
      const rows = await players.loadPlayerShots(
        messi,
        { competition: season.competition.id, season: season.season.id },
        300,
      );
      expect(rows.shots, season.season.name).toHaveLength(season.shots);
      expect(new Set(rows.shots.map((s) => s.matchId)).size).toBe(season.matches);
    }
  });

  it('says it left shots out when the limit is smaller than the selection', async () => {
    const messi = await players.loadPlayer(MESSI);
    const few = await players.loadPlayerShots(
      messi,
      { competition: null, season: null },
      50,
    );
    expect(few.truncated).toBe(true);
    expect(few.shots).toHaveLength(50);
  });

  it('counts the shots into squares that add up to them, through the code the page runs', async () => {
    const messi = await players.loadPlayer(MESSI);
    const total = (d: { n: number[] }) => d.n.reduce((a, b) => a + b, 0);
    const career = await players.loadPlayerDensity(
      messi,
      { competition: null, season: null },
      null,
    );
    // Open play, as the page asks: the profile's own count of them.
    expect(career.step).toBe(2);
    expect(total(career)).toBe(messi.totals.shots);
    expect(career.goals.reduce((a, b) => a + b, 0)).toBe(messi.totals.goals);
    // A season is a part of it, and a legend that hides outcomes asks for the rest.
    const cup = messi.seasons.find((s) => s.competition.id === 43 && s.season.id === 106);
    const one = await players.loadPlayerDensity(
      messi,
      { competition: 43, season: 106 },
      null,
    );
    expect(total(one)).toBe(cup?.shots);
    const goals = await players.loadPlayerDensity(
      messi,
      { competition: null, season: null },
      ['goal'],
    );
    expect(total(goals)).toBe(messi.totals.goals);
    // Far fewer squares than shots: that is what it is for.
    expect(career.n.length).toBeLessThan(messi.totals.shots / 4);
  });

  it('can name the match a shot is from', async () => {
    const messi = await players.loadPlayer(MESSI);
    const [first] = (
      await players.loadPlayerShots(messi, { competition: 43, season: 106 }, 300)
    ).shots;
    const match = await players.loadMatchDetail(first?.matchId ?? 0);
    expect(match.teams.map((t) => t.name)).toContain('Argentina');
  });

  it('says there is no such player as a 404, not as no shots', async () => {
    await expect(players.loadPlayer(1)).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof client.ApiError &&
        e.status === 404 &&
        e.code === 'not_found' &&
        e.message === 'no such player',
    );
  });
});
