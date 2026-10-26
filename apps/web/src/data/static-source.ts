import {
  ENUMS,
  SHOT_ID_FACTOR,
  type Enums,
  type MatchDetail,
  type MatchFile,
  type ShotColumns,
} from '@shotmap/schema';
import type { LoadedMatch } from './match';
import type { Shot } from './shots';

/**
 * TEMPORARY, until the static files are deleted: reads a static `MatchFile` into the shape
 * the views now use. The files carry no player ids, so a player's id here is a stand-in,
 * `STATIC_PLAYER_BASE` plus their place in the match's player list, which is enough to
 * filter by player within a match. They carry no stage id either.
 */
export const STATIC_PLAYER_BASE = 900_000_000;

/** The constants as the static index's `enums`, whose arrays are mutable. */
export const LEGACY_ENUMS: Enums = {
  outcome: ENUMS.outcome.map((e) => ({ ...e })),
  bodyPart: ENUMS.bodyPart.map((e) => ({ ...e })),
  shotType: ENUMS.shotType.map((e) => ({ ...e })),
  technique: ENUMS.technique.map((e) => ({ ...e })),
};

type LegacyShot = Omit<Shot, 'playerId' | 'shotId' | 'teamId' | 'matchId'> & {
  playerIdx: number;
};

/** The static build's decoder, defaults and all: the files were validated when they were written. */
export function decodeLegacy(match: MatchFile, enums: Enums): LegacyShot[] {
  const outcome = new Map(enums.outcome.map((e) => [e.id, e]));
  const name = (list: { id: number; name: string }[]) =>
    new Map(list.map((e) => [e.id, e.name]));
  const bodyPart = name(enums.bodyPart);
  const shotType = name(enums.shotType);
  const technique = name(enums.technique);

  const decode = (c: ShotColumns, from: number, shootout: boolean): LegacyShot[] =>
    c.x.map((x, i) => {
      const playerIdx = c.player[i] ?? -1;
      const player = match.players[playerIdx];
      const out = outcome.get(c.out[i] ?? -1);
      return {
        id: from + i,
        team: c.team[i] === 1 ? 1 : 0,
        playerIdx,
        player: player?.[0] ?? 'Unknown player',
        shirt: player?.[2] ?? null,
        min: c.min[i] ?? 0,
        sec: c.sec[i] ?? 0,
        period: c.per[i] ?? 1,
        shootout,
        x,
        y: c.y[i] ?? 0,
        ex: c.ex[i] ?? 0,
        ey: c.ey[i] ?? 0,
        ez: c.ez[i] ?? null,
        xg: c.xg[i] ?? 0,
        outcome: out?.group ?? 'off',
        outcomeLabel: out?.label ?? 'Unknown',
        bodyPart: bodyPart.get(c.body[i] ?? -1) ?? 'Other',
        shotType: shotType.get(c.type[i] ?? -1) ?? 'Open Play',
        technique: technique.get(c.tech[i] ?? -1) ?? 'Normal',
      };
    });

  const open = decode(match.shots, 0, false);
  return match.shootout ? [...open, ...decode(match.shootout, open.length, true)] : open;
}

export function fromStaticMatch(match: MatchFile): LoadedMatch {
  const { meta } = match;
  const detail: MatchDetail = {
    id: meta.id,
    date: meta.date,
    kickoff: meta.kickoff,
    competition: meta.competition,
    season: meta.season,
    stage: { id: 0, name: meta.stage },
    teams: [meta.teams[0], meta.teams[1]],
    players: match.players.map(([name, side, shirt], at) => ({
      id: STATIC_PLAYER_BASE + at,
      name,
      side,
      team: meta.teams[side].id,
      shirt,
    })),
  };
  const shots: Shot[] = decodeLegacy(match, LEGACY_ENUMS).map(
    ({ playerIdx, ...shot }) => ({
      ...shot,
      shotId: meta.id * SHOT_ID_FACTOR + shot.id,
      teamId: meta.teams[shot.team].id,
      playerId: STATIC_PLAYER_BASE + playerIdx,
      matchId: null,
    }),
  );
  return { detail, shots };
}
