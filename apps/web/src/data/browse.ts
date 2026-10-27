import type { MatchList, Meta, SearchResult } from '@shotmap/schema';
import { api } from './client';
import { assertMatchList, assertMeta, assertSearch } from './validate-api';

/** The competitions, seasons and stages the browse filters are made of. */
export const loadMeta = (signal?: AbortSignal): Promise<Meta> =>
  api().get('/v1/meta', { validate: assertMeta, ...(signal && { signal }) });

/** One page of matches: `path` is `/v1/matches?...` from `apiPathOf`. */
export const loadMatchPage = (path: string, signal?: AbortSignal): Promise<MatchList> =>
  api().get(path, { validate: assertMatchList, ...(signal && { signal }) });

/** What matches the words typed. The server folds accents and case; the words go as typed. */
export const search = (words: string, signal?: AbortSignal): Promise<SearchResult> =>
  api().get(`/v1/search?q=${encodeURIComponent(words)}&limit=8`, {
    validate: assertSearch,
    ...(signal && { signal }),
  });
