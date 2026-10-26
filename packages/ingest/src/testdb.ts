import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The database `pnpm data` writes. Tests that need it skip when it is missing, except in CI. */
export const DB_PATH = join(resolve(import.meta.dirname, '..'), 'out', 'shotmap.sqlite');

/** The committed static files: the oracle the database is compared with. */
export const LEGACY = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'apps',
  'web',
  'public',
  'data',
);

export const haveDb = existsSync(DB_PATH);

if (!haveDb) {
  if (process.env.CI)
    throw new Error(`${DB_PATH} is missing: CI must run \`pnpm data\` first.`);
  console.warn(
    `\n  ${DB_PATH} is missing, so the database tests are skipped. Run \`pnpm data\`.\n`,
  );
}
