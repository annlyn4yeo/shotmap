import {
  decodeShotsStrict,
  type DecodedShot,
  type IndexFile,
  type MatchDetail,
  type ShotsData,
} from '@shotmap/schema';

/**
 * The match list the picker and the search read: the competitions with their seasons and
 * matches, and the stage names. (The static `index.json` has more, which is ignored.)
 */
export type Catalog = Pick<IndexFile, 'stages' | 'competitions'>;

/** A match as the views use it: who played, and every shot, checked and decoded. */
export interface LoadedMatch {
  detail: MatchDetail;
  shots: readonly DecodedShot[];
}

/**
 * Decode a match's shots with the strict decoder, which throws on a team, player, outcome,
 * body part, shot type or technique it does not know, instead of drawing a wrong mark.
 */
export function decodeMatch(detail: MatchDetail, shots: ShotsData): LoadedMatch {
  return {
    detail,
    shots: decodeShotsStrict(shots, {
      teams: new Map(detail.teams.map((t) => [t.id, t.name])),
      players: new Map(
        detail.players.map((p) => [p.id, { name: p.name, shirt: p.shirt, side: p.side }]),
      ),
    }),
  };
}
