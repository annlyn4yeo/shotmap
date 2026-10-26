import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { RELEASE_PATTERN } from '@shotmap/schema';
import { checkDatabase, runChecks } from './checks';
import { DB_PATH, haveDb } from './testdb';

// The checks data.test.ts runs over the static files, run over the database. The same
// queries make `pnpm data` fail, so this file adds what only a test can: the exact
// counts, the facts about the final, and proof that each check can fail.
describe.skipIf(!haveDb)('the database', () => {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const one = (sql: string): Record<string, unknown> => db.prepare(sql).get() ?? {};
  const count = (table: string) => Number(one(`SELECT COUNT(*) AS n FROM ${table}`).n);

  it('has the rows of the static build, and what it dropped', () => {
    expect(count('shots')).toBe(3721);
    expect(count('matches')).toBe(149);
    expect(count('competitions')).toBe(3);
    expect(count('seasons')).toBe(3);
    expect(count('stages')).toBe(7);
    expect(count('teams')).toBe(64);
    expect(count('players')).toBe(843);
    expect(count('match_players')).toBe(2023);
    expect(Number(one('SELECT COUNT(*) AS n FROM shots WHERE period = 5').n)).toBe(65);
    expect(Number(one('SELECT SUM(first_time) AS n FROM shots').n)).toBe(1120);
    expect(Number(one('SELECT COUNT(DISTINCT event_uuid) AS n FROM shots').n)).toBe(3721);
  });

  it('names its release, its source commit and its hero', () => {
    const meta = Object.fromEntries(
      (
        db.prepare('SELECT key, value FROM meta').all() as {
          key: string;
          value: string;
        }[]
      ).map((r) => [r.key, r.value]),
    );
    expect(meta.release).toMatch(RELEASE_PATTERN);
    expect(meta.source_ref).toBe('4b73468fc5b0f1950f9f66fada70ad3a4f9327cb');
    expect(meta.hero_match).toBe('3869685');
  });

  it('passes every check', () => {
    const checks = runChecks(DB_PATH);
    expect(checks.length).toBeGreaterThanOrEqual(20);
    expect(
      checks.filter((c) => c.problems.length).map((c) => `${c.name}: ${c.problems[0]}`),
    ).toEqual([]);
    expect(checks.find((c) => c.name.includes('equal the final score'))?.note).toBe(
      '149/149 matches',
    );
  });

  it('keeps one player for the two ids with two spellings, and finds both', () => {
    const foden = db
      .prepare('SELECT name, full_name, search_text FROM players WHERE id = 4354')
      .get() as {
      name: string;
      search_text: string;
    };
    expect(foden.search_text).toContain('phil foden');
    expect(foden.search_text).toContain('philip foden');
    const spellings = db
      .prepare('SELECT DISTINCT name FROM match_players WHERE player_id = 4354')
      .all();
    expect(spellings).toHaveLength(2);
  });

  it('gives a player who shot for two teams no team of their own', () => {
    const columns = (
      db.prepare('PRAGMA table_info(players)').all() as { name: string }[]
    ).map((c) => c.name);
    expect(columns).toEqual(['id', 'name', 'full_name', 'search_text']);
    const messi = db
      .prepare(
        'SELECT COUNT(DISTINCT team_id) AS teams FROM shots WHERE player_id = 5503',
      )
      .get() as { teams: number };
    expect(messi.teams).toBe(2);
    const multi = db
      .prepare(
        'SELECT COUNT(*) AS n FROM (SELECT player_id FROM shots GROUP BY player_id HAVING COUNT(DISTINCT team_id) > 1)',
      )
      .get() as { n: number };
    expect(multi.n).toBe(30);
  });

  describe('the final (hero match)', () => {
    const final = 3869685;
    it('is Argentina v France, 3-3 before the shootout, 4-2 on penalties', () => {
      const m = db
        .prepare(
          `SELECT th.name AS home, ta.name AS away, m.home_score, m.away_score, m.home_pens, m.away_pens, c.name AS competition, s.name AS season, st.name AS stage
           FROM matches m JOIN teams th ON th.id = m.home_team_id JOIN teams ta ON ta.id = m.away_team_id
           JOIN competitions c ON c.id = m.competition_id JOIN seasons s ON s.competition_id = m.competition_id AND s.id = m.season_id
           JOIN stages st ON st.id = m.stage_id WHERE m.id = ?`,
        )
        .get(final);
      expect(m).toMatchObject({
        home: 'Argentina',
        away: 'France',
        home_score: 3,
        away_score: 3,
        home_pens: 4,
        away_pens: 2,
        competition: 'FIFA World Cup',
        season: '2022',
        stage: 'Final',
      });
    });

    it('has goals in open play that match the score, and keeps the kicks apart', () => {
      const goals = db
        .prepare(
          'SELECT side, COUNT(*) AS n FROM shots WHERE match_id = ? AND period <= 4 AND outcome_group = 0 GROUP BY side ORDER BY side',
        )
        .all(final) as { side: number; n: number }[];
      expect(goals.map((g) => g.n)).toEqual([3, 3]);
      const periods = db
        .prepare(
          'SELECT MIN(period) AS lo, MAX(period) AS hi FROM shots WHERE match_id = ? AND period <= 4',
        )
        .get(final);
      expect(periods).toMatchObject({ lo: 1 });
      expect(
        Number(
          one(`SELECT COUNT(*) AS n FROM shots WHERE match_id = ${final} AND period = 5`)
            .n,
        ),
      ).toBe(8); // 4 + 4 kicks
    });

    it('names Messi, Di María and Mbappé as scorers, with Messi at number 10', () => {
      const scorers = (
        db
          .prepare(
            `SELECT DISTINCT mp.name FROM shots s JOIN match_players mp ON mp.match_id = s.match_id AND mp.player_id = s.player_id
             WHERE s.match_id = ? AND s.period <= 4 AND s.outcome_group = 0`,
          )
          .all(final) as { name: string }[]
      ).map((r) => r.name);
      expect(new Set(scorers)).toEqual(
        new Set(['Lionel Messi', 'Ángel Di María', 'Kylian Mbappé']),
      );
      const messi = db
        .prepare(
          "SELECT shirt FROM match_players WHERE match_id = ? AND name = 'Lionel Messi'",
        )
        .get(final);
      expect(messi).toEqual({ shirt: 10 });
    });
  });

  describe('each check can fail', () => {
    // A copy of the database, one rule broken, and the named check must notice.
    const dir = mkdtempSync(join(tmpdir(), 'shotmap-db-'));
    const breaks = (name: string, mutation: string, check: string) =>
      it(name, () => {
        const copy = join(dir, `${name.replace(/\W+/g, '-')}.sqlite`);
        copyFileSync(DB_PATH, copy);
        const rw = new DatabaseSync(copy);
        rw.exec('PRAGMA foreign_keys = OFF');
        rw.exec(mutation);
        const found = checkDatabase(rw).find((c) => c.name.includes(check));
        rw.close();
        expect(found, `no check named ${check}`).toBeDefined();
        expect(found?.problems.length, `${check} should fail`).toBeGreaterThan(0);
      });

    breaks(
      'a shot off the pitch',
      'UPDATE shots SET x = 130 WHERE id = 3869685000',
      'start and end on the pitch',
    );
    breaks(
      'a shot with a bad height',
      'UPDATE shots SET ez = 12 WHERE ez IS NOT NULL AND id = (SELECT MIN(id) FROM shots WHERE ez IS NOT NULL)',
      'heights are between',
    );
    breaks(
      'xG with four decimals',
      'UPDATE shots SET xg = 0.1234 WHERE id = 3869685000',
      'rounding',
    );
    breaks(
      'an unknown outcome id',
      'UPDATE shots SET outcome = 9999 WHERE id = 3869685000',
      'every shot names a known',
    );
    breaks(
      'a wrong outcome group',
      'UPDATE shots SET outcome_group = 4 WHERE outcome_group = 0 AND id = 3869685003',
      'outcome_group agrees',
    );
    breaks(
      'a shot on the wrong side',
      'UPDATE shots SET side = 1 WHERE id = 3869685000',
      'on that match',
    );
    breaks(
      'a shot by the wrong team',
      'UPDATE shots SET team_id = 1 WHERE id = 3869685000',
      "side's team",
    );
    breaks(
      'a player missing from the match list',
      'DELETE FROM match_players WHERE match_id = 3869685 AND player_id = 5503',
      'on that match',
    );
    breaks(
      'a wrong first_seq',
      'UPDATE match_players SET first_seq = 99 WHERE match_id = 3869685 AND player_id = 5503',
      'first_seq',
    );
    breaks(
      'a wrong shot id',
      'UPDATE shots SET id = 5 WHERE id = 3869685000',
      'a shot id is match',
    );
    breaks(
      'a hole in seq',
      'UPDATE shots SET seq = seq + 1 WHERE match_id = 3869685 AND seq = (SELECT MAX(seq) FROM shots WHERE match_id = 3869685)',
      'open play is in periods',
    );
    breaks(
      'time running backwards',
      'UPDATE shots SET minute = 0, second = 0 WHERE id = 3869685020',
      'chronological',
    );
    breaks(
      'penalties that do not match the kicks',
      'UPDATE matches SET home_pens = 9 WHERE id = 3869685',
      'pens exist',
    );
    breaks(
      'a score that goals do not explain',
      'UPDATE matches SET home_score = home_score + 1 WHERE id = 3869685',
      'equal the final score',
    );
    breaks(
      'more goals than the score',
      'UPDATE matches SET home_score = 0, home_own_goals = 0 WHERE id = 3869685',
      'never exceed',
    );
    breaks(
      'a goal heading away from x = 120',
      'UPDATE shots SET ex = 10 WHERE id = (SELECT MIN(id) FROM shots WHERE outcome_group = 0)',
      'attacks toward x = 120',
    );
    breaks(
      'a term that is not normalised',
      "INSERT INTO search_terms VALUES ('Türkiye', 2, 1)",
      'terms are normalised',
    );
    breaks(
      'a player nobody can search for',
      'DELETE FROM search_terms WHERE kind = 1 AND ref = 5503',
      'has some',
    );
    breaks(
      'a hero that is not listed',
      "UPDATE meta SET value = '1' WHERE key = 'hero_match'",
      'hero match is listed',
    );
  });
});
