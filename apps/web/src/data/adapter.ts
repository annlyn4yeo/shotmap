import { ENUMS, HERO_MATCH_ID, PITCH, SCHEMA_VERSION } from '@shotmap/schema';
import type {
  Enums,
  IndexFile,
  MatchDetail,
  MatchFile,
  MatchRow,
  MatchSummary,
  Meta,
  ShotColumns,
  ShotsData,
} from '@shotmap/schema';
import { fail } from './validate';

/**
 * TEMPORARY (MIGRATION.md step 8 to 10): turns what /v1 answers into the shapes the views
 * were written for, the static files' `IndexFile` and `MatchFile`, so nothing downstream
 * changes while the source does. Step 10 removes it for the match page.
 */

/** The constants as the static index's `enums`, whose arrays are mutable. */
export const LEGACY_ENUMS: Enums = {
  outcome: ENUMS.outcome.map((e) => ({ ...e })),
  bodyPart: ENUMS.bodyPart.map((e) => ({ ...e })),
  shotType: ENUMS.shotType.map((e) => ({ ...e })),
  technique: ENUMS.technique.map((e) => ({ ...e })),
};

/** The index: constants, `/v1/meta` and every page of `/v1/matches`. */
export function toIndexFile(meta: Meta, matches: readonly MatchSummary[]): IndexFile {
  const stageAt = new Map(meta.stages.map((stage, at) => [stage.id, at]));
  const rows = new Map<string, MatchRow[]>();
  for (const m of matches) {
    const stage = stageAt.get(m.stage);
    if (stage === undefined)
      return fail('index', `match ${m.id} has unknown stage ${m.stage}`);
    const key = `${m.competition}:${m.season}`;
    const list = rows.get(key) ?? [];
    list.push([
      m.id,
      m.date,
      m.home.name,
      m.away.name,
      m.home.score,
      m.away.score,
      stage,
      m.home.pens,
      m.away.pens,
    ]);
    rows.set(key, list);
  }
  return {
    v: SCHEMA_VERSION,
    hero: HERO_MATCH_ID,
    pitch: {
      length: PITCH.length,
      width: PITCH.width,
      goalY: [PITCH.goalY[0], PITCH.goalY[1]],
    },
    enums: LEGACY_ENUMS,
    stages: meta.stages.map((stage) => stage.name),
    competitions: meta.competitions.map((c) => ({
      id: c.id,
      name: c.name,
      seasons: c.seasons.map((s) => ({
        id: s.id,
        name: s.name,
        matches: rows.get(`${c.id}:${s.id}`) ?? [],
      })),
    })),
  };
}

const emptyColumns = (): ShotColumns => ({
  min: [],
  sec: [],
  per: [],
  team: [],
  player: [],
  x: [],
  y: [],
  ex: [],
  ey: [],
  ez: [],
  xg: [],
  out: [],
  body: [],
  type: [],
  tech: [],
});

/** One match: its detail and its shots, with open play and the shootout kept apart as the static files do. */
export function toMatchFile(detail: MatchDetail, shots: ShotsData): MatchFile {
  const playerAt = new Map(detail.players.map((p, at) => [p.id, at]));
  const open = emptyColumns();
  const kicks = emptyColumns();
  const c = shots.cols;
  for (let i = 0; i < shots.n; i++) {
    const who = playerAt.get(c.player[i] ?? -1);
    if (who === undefined)
      return fail(
        `match ${detail.id}`,
        `row ${i}: player ${c.player[i]} is not in the match`,
      );
    const to = (c.period[i] ?? 1) === 5 ? kicks : open;
    to.min.push(c.min[i] ?? 0);
    to.sec.push(c.sec[i] ?? 0);
    to.per.push(c.period[i] ?? 1);
    to.team.push(c.side[i] === 1 ? 1 : 0);
    to.player.push(who);
    to.x.push(c.x[i] ?? 0);
    to.y.push(c.y[i] ?? 0);
    to.ex.push(c.ex[i] ?? 0);
    to.ey.push(c.ey[i] ?? 0);
    to.ez.push(c.ez[i] ?? null);
    to.xg.push(c.xg[i] ?? 0);
    to.out.push(c.out[i] ?? 0);
    to.body.push(c.body[i] ?? 0);
    to.type.push(c.type[i] ?? 0);
    to.tech.push(c.tech[i] ?? 0);
  }
  return {
    v: SCHEMA_VERSION,
    meta: {
      id: detail.id,
      date: detail.date,
      kickoff: detail.kickoff,
      competition: detail.competition,
      season: detail.season,
      stage: detail.stage.name,
      teams: [detail.teams[0], detail.teams[1]],
    },
    players: detail.players.map((p) => [p.name, p.side, p.shirt]),
    shots: open,
    shootout: kicks.x.length ? kicks : null,
  };
}
