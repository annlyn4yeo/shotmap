import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENUMS, decodeShotsStrict } from '@shotmap/schema';
import type { IndexFile, MatchFile } from '@shotmap/schema';
// The legacy decoder is the oracle: the web app's own, with its defaults.
import { decodeShots } from '../../../apps/web/src/data/shots';
import {
  exportCompetitions,
  exportMatch,
  exportMatchList,
  exportMatchShots,
  openDatabase,
} from './export';
import { DB_PATH, LEGACY, haveDb } from './testdb';

const read = (path: string): unknown =>
  JSON.parse(readFileSync(join(LEGACY, path), 'utf8'));

/**
 * The safety net of the migration. For every match, the static file decoded the old way
 * must equal the database's export in the new columnar shape decoded the strict way,
 * once player ids are mapped to the file's local indices. When the web app moves to the
 * API, this is what proves nothing on screen changes.
 */
describe.skipIf(!haveDb)('parity: static files against the database', () => {
  const db = openDatabase(DB_PATH);
  const index = read('index.json') as IndexFile;
  const rows = index.competitions.flatMap((c) => c.seasons.flatMap((s) => s.matches));

  it('covers all 149 matches', () => {
    expect(rows).toHaveLength(149);
  });

  it('uses the same enums as the static legend', () => {
    for (const kind of ['outcome', 'bodyPart', 'shotType', 'technique'] as const)
      expect(ENUMS[kind]).toEqual(index.enums[kind]);
  });

  it.each(rows.map((r) => [r[0], `${r[2]} v ${r[3]}`] as const))(
    'match %i (%s): decoded shots, players and header are equal',
    (id) => {
      const legacy = read(`matches/${id}.json`) as MatchFile;
      const legacyShots = decodeShots(legacy, index.enums);

      const detail = exportMatch(db, id);
      expect(detail, 'the match exists').toBeDefined();
      if (!detail) return;
      const payload = exportMatchShots(db, id);

      const strict = decodeShotsStrict(payload, {
        teams: new Map(detail.teams.map((t) => [t.id, t.name])),
        players: new Map(
          detail.players.map((p) => [
            p.id,
            { name: p.name, shirt: p.shirt, side: p.side },
          ]),
        ),
      });

      // Player ids -> the static file's local indices (the players list is in first-shot order).
      const local = new Map(detail.players.map((p, i) => [p.id, i]));
      const fromDb = strict.map(({ shotId, teamId, playerId, matchId, ...shot }) => {
        expect(matchId).toBeNull();
        expect(shotId).toBe(id * 1000 + shot.id);
        expect(teamId).toBe(legacy.meta.teams[shot.team].id);
        return { ...shot, playerIdx: local.get(playerId) };
      });
      expect(fromDb).toEqual(legacyShots);

      // The players list, and the header.
      expect(detail.players.map((p) => [p.name, p.side, p.shirt])).toEqual(
        legacy.players,
      );
      const { teams, competition, season, stage } = legacy.meta;
      expect(detail).toMatchObject({
        id,
        date: legacy.meta.date,
        kickoff: legacy.meta.kickoff,
        competition,
        season,
        stage: { name: stage },
        teams,
      });
    },
  );

  it('lists every season of the index in the same order, with the same rows', () => {
    const competitions = exportCompetitions(db);
    expect(competitions.competitions.map((c) => [c.id, c.name])).toEqual(
      index.competitions.map((c) => [c.id, c.name]),
    );
    expect(competitions.stages.map((s) => s.name)).toEqual(index.stages);
    for (const c of index.competitions) {
      for (const s of c.seasons) {
        const page = exportMatchList(db, { competition: c.id, season: s.id, limit: 200 });
        const asRows = page.items.map((m) => [
          m.id,
          m.date,
          m.home.name,
          m.away.name,
          m.home.score,
          m.away.score,
          m.stage,
          m.home.pens,
          m.away.pens,
        ]);
        expect(asRows, `${c.name} ${s.name}`).toEqual(s.matches);
      }
    }
  });
});
