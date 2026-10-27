import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { RELEASE_PATTERN } from '@shotmap/schema';
import type { IndexFile } from '@shotmap/schema';
import { exportMatch, exportMatchShots, exportMeta, releaseOf } from '@shotmap/queries';
import { ceiling } from './catalogue.config';
import { checkDatabase } from './checks';
import { openDb } from './sqlite-db';
import { DB_PATH, LEGACY, haveDb } from './testdb';

// The whole catalogue's database (`pnpm --filter @shotmap/ingest catalogue`). It takes half an hour
// to build from a cold cache and CI builds only the three competitions, so these run where it
// exists and are skipped where it does not. They are the checks of the ingest again, plus the one
// that matters most: the original 149 matches are exactly what they were.
const CATALOGUE_DB = join(
  import.meta.dirname,
  '..',
  'out',
  'catalogue',
  'shotmap.sqlite',
);
const have = existsSync(CATALOGUE_DB) && haveDb;

describe.skipIf(!have)('the whole catalogue', () => {
  const db = have ? openDb(CATALOGUE_DB) : undefined;
  const legacy = have ? openDb(DB_PATH) : undefined;
  const index = JSON.parse(readFileSync(join(LEGACY, 'index.json'), 'utf8')) as IndexFile;
  const ids = index.competitions.flatMap((c) =>
    c.seasons.flatMap((s) => s.matches.map((row) => row[0])),
  );

  it('is within the design ceiling', async () => {
    if (!db) return;
    const meta = await exportMeta(db);
    expect(meta.counts.matches).toBeGreaterThan(149);
    expect(meta.counts.matches).toBeLessThanOrEqual(ceiling.matches);
    expect(meta.counts.shots).toBeLessThanOrEqual(ceiling.shots);
  });

  it('is a release named by a date and a content hash', async () => {
    if (!db) return;
    const release = await releaseOf(db);
    expect(release).toMatch(RELEASE_PATTERN);
    const meta = await exportMeta(db);
    expect(`${meta.released.date}.${meta.released.hash}`).toBe(release);
  });

  it('passes every check the ingest runs', () => {
    const raw = new DatabaseSync(CATALOGUE_DB, { readOnly: true });
    try {
      const failed = checkDatabase(raw).filter((c) => c.problems.length);
      expect(failed.map((c) => [c.name, c.problems.slice(0, 5)])).toEqual([]);
    } finally {
      raw.close();
    }
  }, 120_000);

  it('answers the original 149 matches exactly as the three-competition build does', async () => {
    if (!db || !legacy) return;
    expect(ids).toHaveLength(149);
    for (const id of ids) {
      expect(await exportMatch(db, id), `match ${id}`).toEqual(
        await exportMatch(legacy, id),
      );
      expect(await exportMatchShots(db, id), `shots of ${id}`).toEqual(
        await exportMatchShots(legacy, id),
      );
    }
  }, 120_000);

  it('keeps the stage numbers the static files use', async () => {
    if (!db) return;
    const meta = await exportMeta(db);
    expect(meta.stages.slice(0, index.stages.length).map((s) => s.name)).toEqual(
      index.stages,
    );
  });
});
