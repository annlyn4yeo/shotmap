import { OUTCOMES, SCHEMA_VERSION } from '@shotmap/schema';
import type { Enums, IndexFile, MatchFile } from '@shotmap/schema';

/**
 * A structural check of what the loader receives, written by hand so the browser never
 * ships zod (the full schemas are in @shotmap/schema/zod, for tests and ingest). It
 * throws on the first problem, loudly, instead of letting decodeShots fall back to a
 * default: a team id other than 1 would become the home team, an unknown outcome an
 * "off target" cross. It checks what drift breaks: shapes, equal column lengths, known
 * enum ids, player indices in range. Value ranges are the tests' job.
 */
export class DataError extends Error {
  override readonly name = 'DataError';
}

/** The shot columns. validate.test.ts checks this list against the zod schema. */
export const COLUMN_KEYS = [
  'min',
  'sec',
  'per',
  'team',
  'player',
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

export function fail(where: string, what: string): never {
  throw new DataError(`${where}: ${what}`);
}
export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export const isInt = (v: unknown): v is number => Number.isInteger(v);
export const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** The ids of an enum list, which must be unique. */
function idsOf(list: unknown, where: string): Set<number> {
  if (!Array.isArray(list)) return fail(where, 'not a list');
  const ids = new Set<number>();
  for (const entry of list as unknown[]) {
    if (!isObject(entry) || !isInt(entry.id) || typeof entry.name !== 'string')
      return fail(where, 'bad entry');
    if (ids.has(entry.id)) fail(where, `duplicate id ${entry.id}`);
    ids.add(entry.id);
  }
  return ids;
}

export function assertIndex(index: unknown): asserts index is IndexFile {
  if (!isObject(index)) return fail('index', 'not an object');
  if (index.v !== SCHEMA_VERSION) fail('index', `version ${String(index.v)}`);
  if (!isInt(index.hero)) fail('index', 'no hero match');
  if (!isObject(index.enums)) return fail('index', 'no enums');
  for (const kind of ['outcome', 'bodyPart', 'shotType', 'technique'])
    idsOf(index.enums[kind], `index.enums.${kind}`);
  for (const e of index.enums.outcome as { group?: unknown }[])
    if (!(OUTCOMES as readonly unknown[]).includes(e.group))
      fail('index.enums.outcome', `unknown group ${String(e.group)}`);
  if (!Array.isArray(index.stages) || !Array.isArray(index.competitions))
    return fail('index', 'no stages or competitions');
  const stages = index.stages.length;
  let heroSeen = false;
  for (const c of index.competitions as { seasons?: { matches?: unknown[] }[] }[]) {
    for (const season of c.seasons ?? []) {
      for (const row of season.matches ?? []) {
        if (!Array.isArray(row) || row.length !== 9)
          return fail('index', 'bad match row');
        const [id, , , , , , stage] = row as unknown[];
        if (!isInt(id) || !isInt(stage) || stage < 0 || stage >= stages)
          fail('index', `bad match row ${String(id)}`);
        if (id === index.hero) heroSeen = true;
      }
    }
  }
  if (!heroSeen) fail('index', 'the hero match is not listed');
}

type Known = Record<'out' | 'body' | 'type' | 'tech', Set<number>>;

function assertColumns(
  cols: unknown,
  where: string,
  periods: readonly [number, number],
  players: readonly [string, number, number | null][],
  known: Known,
): void {
  if (!isObject(cols)) return fail(where, 'not an object');
  const n = Array.isArray(cols.x) ? cols.x.length : -1;
  for (const key of COLUMN_KEYS) {
    const column = cols[key];
    if (!Array.isArray(column)) return fail(where, `column ${key} is missing`);
    if (column.length !== n)
      fail(where, `column ${key} has ${column.length} rows, x has ${n}`);
  }
  const col = (key: (typeof COLUMN_KEYS)[number], i: number): unknown =>
    (cols[key] as unknown[])[i];
  for (let i = 0; i < n; i++) {
    const at = `${where}[${i}]`;
    const per = col('per', i);
    if (!isInt(per) || per < periods[0] || per > periods[1])
      fail(at, `period ${String(per)}`);
    const side = col('team', i);
    if (side !== 0 && side !== 1) fail(at, `team ${String(side)} is not 0 or 1`);
    const who = col('player', i);
    const player = isInt(who) ? players[who] : undefined;
    if (!player) fail(at, `player index ${String(who)} is out of range`);
    else if (player[1] !== side) fail(at, 'the player is on the other team');
    for (const key of ['out', 'body', 'type', 'tech'] as const) {
      const id = col(key, i);
      if (!isInt(id) || !known[key].has(id)) fail(at, `unknown ${key} id ${String(id)}`);
    }
    for (const key of ['x', 'y', 'ex', 'ey', 'xg'] as const)
      if (!isNum(col(key, i))) fail(at, `${key} is not a number`);
    const ez = col('ez', i);
    if (ez !== null && !isNum(ez)) fail(at, 'ez is neither a number nor null');
  }
}

/** Throws a DataError unless `match` has the shape of a MatchFile that `enums` can decode. */
export function assertMatch(match: unknown, enums: Enums): asserts match is MatchFile {
  if (!isObject(match)) return fail('match', 'not an object');
  if (match.v !== SCHEMA_VERSION) fail('match', `version ${String(match.v)}`);
  const meta = match.meta;
  if (
    !isObject(meta) ||
    !isInt(meta.id) ||
    !Array.isArray(meta.teams) ||
    meta.teams.length !== 2
  )
    return fail('match', 'bad meta');
  for (const t of meta.teams as unknown[])
    if (!isObject(t) || typeof t.name !== 'string' || !isInt(t.score))
      return fail('match', 'bad team');
  if (!Array.isArray(match.players)) return fail('match', 'no players');
  for (const p of match.players as unknown[])
    if (
      !Array.isArray(p) ||
      p.length !== 3 ||
      typeof p[0] !== 'string' ||
      (p[1] !== 0 && p[1] !== 1) ||
      (p[2] !== null && !isInt(p[2]))
    )
      return fail('match', 'bad player row');
  const players = match.players as [string, number, number | null][];
  const known: Known = {
    out: idsOf(enums.outcome, 'enums.outcome'),
    body: idsOf(enums.bodyPart, 'enums.bodyPart'),
    type: idsOf(enums.shotType, 'enums.shotType'),
    tech: idsOf(enums.technique, 'enums.technique'),
  };
  assertColumns(match.shots, 'shots', [1, 4], players, known);
  if (match.shootout !== null) {
    assertColumns(match.shootout, 'shootout', [5, 5], players, known);
    if ((match.shootout as { x: unknown[] }).x.length === 0)
      fail('shootout', 'an empty shootout must be null');
  }
}
