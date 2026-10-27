import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The player page's data, through the code the page runs, against a running API (`wrangler dev`
// in CI, see .github/workflows/ci.yml): the most prolific player in the data, Lionel Messi, who
// shot in 41 matches.
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

  it('has a profile whose seasons are the 41 matches, in two competitions', async () => {
    const messi = await players.loadPlayer(MESSI);
    expect(messi.name).toBe('Lionel Messi');
    expect(messi.totals.matches).toBe(41);
    expect(messi.seasons.map((s) => s.matches)).toEqual([34, 7]);
    expect(messi.seasons.reduce((n, s) => n + s.shots, 0)).toBe(messi.totals.shots);
  });

  it('gives every shot of the career, decoded, from 41 matches, none left out', async () => {
    const messi = await players.loadPlayer(MESSI);
    const all = await players.loadPlayerShots(
      messi,
      { competition: null, season: null },
      300,
    );
    expect(all.truncated).toBe(false);
    expect(all.shots).toHaveLength(messi.totals.shots);
    expect(new Set(all.shots.map((s) => s.matchId)).size).toBe(41);
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
