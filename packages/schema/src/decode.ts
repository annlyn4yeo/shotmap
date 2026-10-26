import type { Outcome } from './constants';
import { ENUMS } from './enums';
import type { ShotsData } from './api';

/**
 * The strict decoder for shot columns. Unlike the static build's decodeShots, it has
 * no defaults: an unknown team, player, outcome, body part, shot type or technique id,
 * a side that is not 0 or 1, a period outside 1 to 5, or columns of different lengths
 * is an error naming the row, never a quietly wrong mark. No zod in here: the browser
 * may import it.
 */
export class DecodeError extends Error {
  override readonly name = 'DecodeError';
}

/** A shot as the views use it. The first group is exactly the static build's `Shot`. */
export interface DecodedShot {
  /** The shot's position in its match (`seq`): what the static files call its id. */
  id: number;
  team: 0 | 1;
  player: string;
  shirt: number | null;
  min: number;
  sec: number;
  period: number;
  shootout: boolean;
  x: number;
  y: number;
  ex: number;
  ey: number;
  ez: number | null;
  xg: number;
  outcome: Outcome;
  outcomeLabel: string;
  bodyPart: string;
  shotType: string;
  technique: string;
  /** What the static files do not have. */
  shotId: number;
  teamId: number;
  playerId: number;
  /** The match, in a cross-match payload; null in a single match's. */
  matchId: number | null;
}

export interface DecodeContext {
  /** Every team id the payload may name. */
  teams: ReadonlyMap<number, string>;
  /**
   * Every player id the payload may name. In a match payload `side` is set (from the
   * match's player list) and is checked against each shot's side.
   */
  players: ReadonlyMap<number, { name: string; shirt: number | null; side?: 0 | 1 }>;
}

const byId = <E extends { id: number }>(list: readonly E[]): ReadonlyMap<number, E> =>
  new Map(list.map((e) => [e.id, e]));
const OUTCOME = byId(ENUMS.outcome);
const BODY = byId(ENUMS.bodyPart);
const TYPE = byId(ENUMS.shotType);
const TECH = byId(ENUMS.technique);

export function decodeShotsStrict(data: ShotsData, ctx: DecodeContext): DecodedShot[] {
  const { n } = data;
  const cols = data.cols as Record<string, readonly unknown[] | undefined>;
  const column = (key: string): readonly unknown[] => {
    const c = cols[key];
    if (!c) throw new DecodeError(`column ${key} is missing`);
    if (c.length !== n)
      throw new DecodeError(`column ${key} has ${c.length} rows, n is ${n}`);
    return c;
  };
  const get = (key: string, i: number): unknown => column(key)[i];
  const num = (key: string, i: number): number => {
    const v = get(key, i);
    if (typeof v !== 'number' || !Number.isFinite(v))
      throw new DecodeError(`row ${i}: ${key} is not a number`);
    return v;
  };
  const known = <E>(
    map: ReadonlyMap<number, E>,
    key: string,
    what: string,
    i: number,
  ): E => {
    const found = map.get(num(key, i));
    if (!found) throw new DecodeError(`row ${i}: unknown ${what} id ${num(key, i)}`);
    return found;
  };
  for (const key of [
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
  ])
    column(key);
  if (cols.match) column('match');

  const shots: DecodedShot[] = [];
  for (let i = 0; i < n; i++) {
    const side = num('side', i);
    if (side !== 0 && side !== 1)
      throw new DecodeError(`row ${i}: side ${side} is not 0 or 1`);
    const period = num('period', i);
    if (!Number.isInteger(period) || period < 1 || period > 5)
      throw new DecodeError(`row ${i}: period ${period} is not 1 to 5`);
    known(ctx.teams, 'team', 'team', i);
    const player = known(ctx.players, 'player', 'player', i);
    if (player.side !== undefined && player.side !== side)
      throw new DecodeError(`row ${i}: player ${num('player', i)} is on the other side`);
    const outcome = known(OUTCOME, 'out', 'outcome', i);
    const ez = get('ez', i);
    if (ez !== null && (typeof ez !== 'number' || !Number.isFinite(ez)))
      throw new DecodeError(`row ${i}: ez is neither a number nor null`);
    shots.push({
      id: num('seq', i),
      team: side,
      player: player.name,
      shirt: player.shirt,
      min: num('min', i),
      sec: num('sec', i),
      period,
      shootout: period === 5,
      x: num('x', i),
      y: num('y', i),
      ex: num('ex', i),
      ey: num('ey', i),
      ez,
      xg: num('xg', i),
      outcome: outcome.group,
      outcomeLabel: outcome.label,
      bodyPart: known(BODY, 'body', 'body part', i).name,
      shotType: known(TYPE, 'type', 'shot type', i).name,
      technique: known(TECH, 'tech', 'technique', i).name,
      shotId: num('shot', i),
      teamId: num('team', i),
      playerId: num('player', i),
      matchId: cols.match ? num('match', i) : null,
    });
  }
  return shots;
}
