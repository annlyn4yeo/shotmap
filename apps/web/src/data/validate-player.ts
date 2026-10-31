import type { Density, Player, PlayerShots } from '@shotmap/schema';
import { fail, isInt, isNum, isObject } from './validate';
import { assertShots } from './validate-api';

/**
 * The same kind of check as validate-api.ts, for a player: the profile with its season table, and
 * their shots across matches. It throws on the first problem; what the ids mean is checked where
 * the shots are decoded.
 */
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isList = (v: unknown): v is unknown[] => Array.isArray(v);

const stats = (o: Record<string, unknown>, where: string): void => {
  for (const key of ['matches', 'shots', 'goals', 'onTarget'])
    if (!isInt(o[key]) || o[key] < 0) fail(where, `${key} is not a count`);
  if (!isNum(o.xg)) fail(where, 'xg is not a number');
};

export function assertPlayer(data: unknown): Player {
  if (!isObject(data) || !isInt(data.id) || !isText(data.name) || !isText(data.fullName))
    return fail('player', 'bad profile');
  const where = `player ${data.id}`;
  if (!isList(data.teams)) return fail(where, 'no teams');
  for (const t of data.teams)
    if (!isObject(t) || !isInt(t.id) || !isText(t.name) || !isInt(t.shots))
      return fail(where, 'bad team');
  if (!isObject(data.totals)) return fail(where, 'no totals');
  stats(data.totals, `${where} totals`);
  if (!isList(data.seasons)) return fail(where, 'no seasons');
  for (const s of data.seasons) {
    if (!isObject(s) || !isObject(s.competition) || !isObject(s.season))
      return fail(where, 'bad season');
    if (
      !isInt(s.competition.id) ||
      !isText(s.competition.name) ||
      !isInt(s.season.id) ||
      !isText(s.season.name)
    )
      return fail(where, 'bad season name');
    stats(s, `${where} season ${s.season.id}`);
  }
  return data as unknown as Player;
}

/** Sparse bins: five columns of one length, each cell of the grid at most once. */
export function assertDensity(data: unknown): Density {
  if (!isObject(data) || !isInt(data.step) || data.step < 1)
    return fail('density', 'step is missing');
  const cols = ['gx', 'gy', 'n', 'goals'] as const;
  const gx = data.gx;
  if (!isList(gx)) return fail('density', 'column gx is missing');
  for (const key of cols) {
    const column = data[key];
    if (!isList(column) || column.length !== gx.length)
      return fail('density', `column ${key} is missing or not as long as gx`);
    if (!column.every((v) => isInt(v) && v >= (key === 'n' ? 1 : 0)))
      return fail('density', `column ${key} is not counts`);
  }
  if (!isList(data.xg) || data.xg.length !== gx.length || !data.xg.every(isNum))
    return fail('density', 'column xg is missing or not numbers');
  const gy = data.gy as number[];
  const seen = new Set<number>();
  for (const [i, x] of (gx as number[]).entries()) {
    const key = x * 1024 + (gy[i] ?? 0);
    if (seen.has(key)) return fail('density', 'a square is counted twice');
    seen.add(key);
  }
  return data as unknown as Density;
}

export function assertPlayerShots(data: unknown): PlayerShots {
  const base = assertShots(data);
  if (!isObject(data)) return fail('shots', 'not an object');
  if (typeof data.truncated !== 'boolean') return fail('shots', 'truncated is missing');
  const match = (data.cols as Record<string, unknown>).match;
  if (!isList(match) || match.length !== base.n || !match.every(isInt))
    return fail('shots', 'column match is missing or not whole numbers');
  return data as unknown as PlayerShots;
}
