import { LIMITS, type MatchSummary } from '@shotmap/schema';
import type { ApiClient } from '../api/client';
import { toCatalog } from './catalog';
import { decodeMatch, type Catalog, type LoadedMatch } from './match';
import {
  assertMatchDetail,
  assertMatchList,
  assertMeta,
  assertShots,
} from './validate-api';

/** More pages than the design ceiling of 10,000 matches needs; a loop that long is a bug. */
const MAX_PAGES = Math.ceil(10_000 / LIMITS.matchesPageMax) + 1;

const page = (cursor: string | null) =>
  `/v1/matches?limit=${LIMITS.matchesPageMax}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;

/** The match list, assembled from `/v1/meta` and every page of `/v1/matches`. */
export async function catalogFromApi(client: ApiClient): Promise<Catalog> {
  const [meta, first] = await Promise.all([
    client.get('/v1/meta', { validate: assertMeta }),
    client.get(page(null), { validate: assertMatchList }),
  ]);
  const matches: MatchSummary[] = [...first.items];
  let next = first.next;
  for (let pages = 1; next; pages++) {
    if (pages >= MAX_PAGES) throw new Error('/v1/matches did not end');
    const more = await client.get(page(next), { validate: assertMatchList });
    matches.push(...more.items);
    next = more.next;
  }
  return toCatalog(meta, matches);
}

/** A match: its detail and its shots load together, and the shots are decoded strictly. */
export async function matchFromApi(client: ApiClient, id: number): Promise<LoadedMatch> {
  const [detail, shots] = await Promise.all([
    client.get(`/v1/matches/${id}`, { validate: assertMatchDetail }),
    client.get(`/v1/matches/${id}/shots`, { validate: assertShots }),
  ]);
  return decodeMatch(detail, shots);
}
