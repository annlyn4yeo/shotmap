/**
 * The 2022 final as /v1 answers it: the committed seed the web build inlines into index.html
 * for first paint (never fetched from a live API, MIGRATION.md R14), and the fixture the web
 * tests serve. It sits beside docs/golden/final-3869685.json, which is the same match in the
 * static files' shape; this one carries what they lack, the global player ids.
 *
 * Regenerate after an ingest that changed the data: `pnpm --filter @shotmap/ingest fixture`.
 * fixture.test.ts fails while the committed file differs from what the database gives.
 */
import { join } from 'node:path';
import { HERO_MATCH_ID } from '@shotmap/schema';
import { exportMatch, exportMatchShots, releaseOf } from '@shotmap/queries';
import { openDb } from './sqlite-db';
import { DB_PATH } from './testdb';

export const FIXTURE_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'docs',
  'golden',
  `final-${HERO_MATCH_ID}.api.json`,
);

/** The text of the fixture: one line of JSON, so a diff shows a changed match, not whitespace. */
export async function buildFixture(dbPath: string = DB_PATH): Promise<string> {
  const db = openDb(dbPath);
  try {
    const detail = await exportMatch(db, HERO_MATCH_ID);
    const shots = await exportMatchShots(db, HERO_MATCH_ID);
    if (!detail || !shots)
      throw new Error(`match ${HERO_MATCH_ID} is not in the database`);
    return `${JSON.stringify({ release: await releaseOf(db), detail, shots })}\n`;
  } finally {
    db.raw.close();
  }
}
