import type { MatchRow, MatchSummary, Meta } from '@shotmap/schema';
import type { Catalog } from './match';
import { fail } from './validate';

/**
 * The match list: `/v1/meta` for the competitions, seasons and stages, and every page of
 * `/v1/matches` for the matches, laid out as the picker reads them (one row per match,
 * seasons in order, matches oldest first).
 */
export function toCatalog(meta: Meta, matches: readonly MatchSummary[]): Catalog {
  const stageAt = new Map(meta.stages.map((stage, at) => [stage.id, at]));
  const rows = new Map<string, MatchRow[]>();
  for (const m of matches) {
    const stage = stageAt.get(m.stage);
    if (stage === undefined)
      return fail('catalog', `match ${m.id} has unknown stage ${m.stage}`);
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
