import { decodeShotsStrict, type MatchDetail, type Player } from '@shotmap/schema';
import { api } from './client';
import type { Shot } from './shots';
import { assertMatchDetail } from './validate-api';
import { assertPlayer, assertPlayerShots } from './validate-player';

const options = (signal?: AbortSignal) => (signal ? { signal } : {});

/** A player and the table of seasons they shot in. A player that does not exist is an ApiError 404. */
export const loadPlayer = (id: number, signal?: AbortSignal): Promise<Player> =>
  api().get(`/v1/players/${id}`, { validate: assertPlayer, ...options(signal) });

export interface PlayerShots {
  shots: Shot[];
  /** There were more shots than `limit`: these are only the first ones. */
  truncated: boolean;
}

/**
 * A player's open-play shots across matches, for the whole career or one competition season,
 * at most `limit`. Shootout kicks are left out, as on the match page by default. The shots are
 * decoded strictly: an id the profile does not know is an error, not a wrong mark.
 */
export async function loadPlayerShots(
  profile: Player,
  where: { competition: number | null; season: number | null },
  limit: number,
  signal?: AbortSignal,
): Promise<PlayerShots> {
  const query = new URLSearchParams();
  if (where.competition !== null && where.season !== null) {
    query.set('competition', String(where.competition));
    query.set('season', String(where.season));
  }
  query.set('period', 'open');
  query.set('limit', String(limit));
  const data = await api().get(`/v1/players/${profile.id}/shots?${query.toString()}`, {
    validate: assertPlayerShots,
    ...options(signal),
  });
  return {
    shots: decodeShotsStrict(data, {
      teams: new Map(profile.teams.map((t) => [t.id, t.name])),
      // The match payload names each shot's side from the match's own player list; across
      // matches there is none, so the side is not checked.
      players: new Map([[profile.id, { name: profile.name, shirt: null }]]),
    }),
    truncated: data.truncated,
  };
}

/** A match, to say which one a shot belongs to. Cached with the rest of what was asked of /v1. */
export const loadMatchDetail = (id: number, signal?: AbortSignal): Promise<MatchDetail> =>
  api().get(`/v1/matches/${id}`, { validate: assertMatchDetail, ...options(signal) });
