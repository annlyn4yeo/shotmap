import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MatchDetail, MatchShots, MatchSummary } from '@shotmap/schema';
import { goldenDir } from '../../scripts/golden';

/**
 * A stand-in for /v1 for tests that must not reach a network: answers `/v1/meta`,
 * `/v1/matches`, `/v1/matches/:id` and `/v1/matches/:id/shots` in the real envelope. Every
 * match it knows is the committed 2022 final under another id.
 */
export const RELEASE = '2026-10-27.0123456789ab';

const fixture = JSON.parse(
  readFileSync(join(goldenDir(), 'final-3869685.api.json'), 'utf8'),
) as { detail: MatchDetail; shots: MatchShots };

const ATTRIBUTION = {
  source: 'StatsBomb',
  text: 'Data by StatsBomb',
  url: 'https://statsbomb.com',
  terms: 'https://github.com/statsbomb/open-data',
};

export const jsonResponse = (
  data: unknown,
  status = 200,
  contentType = 'application/json',
) =>
  new Response(
    JSON.stringify(
      status < 400
        ? { release: RELEASE, attribution: ATTRIBUTION, data }
        : { error: { code: 'unavailable', message: 'down' } },
    ),
    { status, headers: { 'content-type': contentType } },
  );

export const detailOf = (id: number): MatchDetail => ({ ...fixture.detail, id });
export const shotsOf = (id: number): MatchShots => ({
  n: fixture.shots.n,
  cols: {
    ...fixture.shots.cols,
    shot: fixture.shots.cols.seq.map((seq) => id * 1000 + seq),
  },
});

export function summaryOf(id: number, day: number): MatchSummary {
  const [home, away] = detailOf(id).teams;
  return {
    id,
    date: `2022-01-${String(day).padStart(2, '0')}`,
    competition: 1,
    season: 1,
    stage: 1,
    home,
    away,
  };
}

/** A fetch for `matchIds`, listed oldest first. Ids not listed are 404. */
export function fakeApi(matchIds: readonly number[]) {
  return (input: string | URL): Promise<Response> => {
    const url = new URL(String(input), 'http://api.test');
    const path = url.pathname;
    if (path === '/v1/meta')
      return Promise.resolve(
        jsonResponse({
          source: { name: 'StatsBomb open data', ref: 'a'.repeat(40) },
          released: { date: '2026-10-27', hash: '0123456789ab' },
          schemaVersion: 1,
          counts: { matches: matchIds.length, shots: 0, players: 0, teams: 0 },
          competitions: [
            {
              id: 1,
              name: 'Cup',
              seasons: [{ id: 1, name: '2022', matches: matchIds.length }],
            },
          ],
          stages: [{ id: 1, name: 'Final' }],
        }),
      );
    if (path === '/v1/matches')
      return Promise.resolve(
        jsonResponse({
          items: matchIds.map((id, at) => summaryOf(id, at + 1)),
          next: null,
        }),
      );
    const match = /^\/v1\/matches\/(\d+)(\/shots)?$/.exec(path);
    const id = Number(match?.[1]);
    if (match && matchIds.includes(id))
      return Promise.resolve(jsonResponse(match[2] ? shotsOf(id) : detailOf(id)));
    return Promise.resolve(jsonResponse(null, 404));
  };
}
