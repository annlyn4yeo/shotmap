import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HERO_MATCH_ID,
  SCHEMA_VERSION,
  type IndexFile,
  type MatchFile,
} from '@shotmap/schema';
import { goldenDir } from '../../scripts/golden';
import { LEGACY_ENUMS } from './static-source';

/**
 * A stand-in for the static files, for tests that must not touch the disk's `public/data`:
 * an index that lists `matchIds`, and a match file for each, all of them the committed
 * 2022 final under another id. Anything else is a 404.
 */
const final = JSON.parse(
  readFileSync(join(goldenDir(), `final-${HERO_MATCH_ID}.json`), 'utf8'),
) as MatchFile;

export const staticMatchOf = (id: number): MatchFile => ({
  ...final,
  meta: { ...final.meta, id },
});

export const staticIndexOf = (matchIds: readonly number[]): IndexFile => ({
  v: SCHEMA_VERSION,
  hero: HERO_MATCH_ID,
  pitch: { length: 120, width: 80, goalY: [36, 44] },
  enums: LEGACY_ENUMS,
  stages: ['Final'],
  competitions: [
    {
      id: 1,
      name: 'Cup',
      seasons: [
        {
          id: 1,
          name: '2022',
          matches: matchIds.map((id, at) => [
            id,
            `2022-01-${String(at + 1).padStart(2, '0')}`,
            final.meta.teams[0].name,
            final.meta.teams[1].name,
            final.meta.teams[0].score,
            final.meta.teams[1].score,
            0,
            final.meta.teams[0].pens,
            final.meta.teams[1].pens,
          ]),
        },
      ],
    },
  ],
});

const answer = (status: number, body: unknown) => ({
  ok: status === 200,
  status,
  json: () => Promise.resolve(body),
});

export function fakeStatic(matchIds: readonly number[]) {
  return (url: string) => {
    if (url.endsWith('/data/index.json'))
      return Promise.resolve(answer(200, staticIndexOf(matchIds)));
    const id = Number(/\/data\/matches\/(\d+)\.json$/.exec(url)?.[1]);
    return Promise.resolve(
      matchIds.includes(id) ? answer(200, staticMatchOf(id)) : answer(404, {}),
    );
  };
}
