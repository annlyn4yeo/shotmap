import {
  LIMITS,
  type IndexFile,
  type MatchFile,
  type MatchSummary,
} from '@shotmap/schema';
import type { ApiClient } from '../api/client';
import { LEGACY_ENUMS, toIndexFile, toMatchFile } from './adapter';
import { assertIndex, assertMatch } from './validate';
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

/** The legacy index, assembled from `/v1/meta` and every page of `/v1/matches`. */
export async function indexFromApi(client: ApiClient): Promise<IndexFile> {
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
  const index = toIndexFile(meta, matches);
  assertIndex(index);
  return index;
}

/** The legacy match, assembled from its detail and its shots, which load together. */
export async function matchFromApi(client: ApiClient, id: number): Promise<MatchFile> {
  const [detail, shots] = await Promise.all([
    client.get(`/v1/matches/${id}`, { validate: assertMatchDetail }),
    client.get(`/v1/matches/${id}/shots`, { validate: assertShots }),
  ]);
  const match = toMatchFile(detail, shots);
  assertMatch(match, LEGACY_ENUMS);
  return match;
}
