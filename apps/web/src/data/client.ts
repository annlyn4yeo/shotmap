import { createApiClient, type ApiClient } from '../api/client';

let client: ApiClient | undefined;

/** The one client every request to /v1 goes through, so they share a cache and a data release. */
export const api = (): ApiClient =>
  (client ??= createApiClient({
    base: (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, ''),
  }));
