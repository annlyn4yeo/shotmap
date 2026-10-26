import type { MatchDetail, MatchList, Meta, ShotsData } from '@shotmap/schema';
import { fail, isInt, isNum, isObject } from './validate';

/**
 * The same kind of check as validate.ts, for what /v1 sends: shapes and equal column
 * lengths, and it throws on the first problem. What the values mean (known enum ids, a
 * side that is 0 or 1, a player that is in the match) is checked where they are decoded,
 * by `decodeShotsStrict`. The full schemas are `@shotmap/schema/zod`, for tests and the API.
 */
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isList = (v: unknown): v is unknown[] => Array.isArray(v);

/** The columns of a single match's shots, in the order `decodeShotsStrict` reads them. */
export const SHOT_COLUMNS = [
  'shot',
  'seq',
  'side',
  'team',
  'player',
  'period',
  'min',
  'sec',
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

export function assertMeta(data: unknown): Meta {
  if (!isObject(data)) return fail('meta', 'not an object');
  const { competitions, stages } = data;
  if (!isList(competitions) || !isList(stages))
    return fail('meta', 'no competitions or stages');
  for (const stage of stages)
    if (!isObject(stage) || !isInt(stage.id) || !isText(stage.name))
      return fail('meta.stages', 'bad stage');
  for (const c of competitions) {
    if (!isObject(c) || !isInt(c.id) || !isText(c.name) || !isList(c.seasons))
      return fail('meta.competitions', 'bad competition');
    for (const s of c.seasons)
      if (!isObject(s) || !isInt(s.id) || !isText(s.name) || !isInt(s.matches))
        return fail('meta.competitions', `bad season in competition ${c.id}`);
  }
  return data as unknown as Meta;
}

const assertResult = (t: unknown, where: string): void => {
  if (
    !isObject(t) ||
    !isInt(t.id) ||
    !isText(t.name) ||
    !isInt(t.score) ||
    !(t.pens === null || isInt(t.pens))
  )
    fail(where, 'bad team result');
};

export function assertMatchList(data: unknown): MatchList {
  if (!isObject(data) || !isList(data.items)) return fail('matches', 'no items');
  if (data.next !== null && !isText(data.next)) return fail('matches', 'bad cursor');
  for (const m of data.items) {
    if (
      !isObject(m) ||
      !isInt(m.id) ||
      !isText(m.date) ||
      !isInt(m.competition) ||
      !isInt(m.season) ||
      !isInt(m.stage)
    )
      return fail('matches', 'bad match');
    assertResult(m.home, `match ${m.id}.home`);
    assertResult(m.away, `match ${m.id}.away`);
  }
  return data as unknown as MatchList;
}

export function assertMatchDetail(data: unknown): MatchDetail {
  if (!isObject(data) || !isInt(data.id) || !isText(data.date))
    return fail('match', 'bad match');
  const where = `match ${data.id}`;
  if (!(data.kickoff === null || isText(data.kickoff))) fail(where, 'bad kickoff');
  for (const key of ['competition', 'season', 'stage'] as const) {
    const part = data[key];
    if (!isObject(part) || !isInt(part.id) || !isText(part.name))
      fail(where, `bad ${key}`);
  }
  if (!isList(data.teams) || data.teams.length !== 2) return fail(where, 'not two teams');
  data.teams.forEach((t, i) => assertResult(t, `${where}.teams[${i}]`));
  if (!isList(data.players)) return fail(where, 'no players');
  for (const p of data.players)
    if (
      !isObject(p) ||
      !isInt(p.id) ||
      !isText(p.name) ||
      (p.side !== 0 && p.side !== 1) ||
      !isInt(p.team) ||
      !(p.shirt === null || isInt(p.shirt))
    )
      return fail(where, 'bad player');
  return data as unknown as MatchDetail;
}

export function assertShots(data: unknown): ShotsData {
  if (!isObject(data) || !isInt(data.n) || data.n < 0 || !isObject(data.cols))
    return fail('shots', 'not {n, cols}');
  const { n, cols } = data;
  for (const key of SHOT_COLUMNS) {
    const column = cols[key];
    if (!isList(column)) return fail('shots', `column ${key} is missing`);
    if (column.length !== n)
      fail('shots', `column ${key} has ${column.length} rows, n is ${n}`);
    if (key !== 'ez' && !column.every(isNum))
      fail('shots', `column ${key} is not numbers`);
    if (key === 'ez' && !column.every((v) => v === null || isNum(v)))
      fail('shots', 'column ez is neither numbers nor null');
  }
  return data as unknown as ShotsData;
}
