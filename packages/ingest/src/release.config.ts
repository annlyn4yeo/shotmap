/**
 * The date the data was released: the first half of the release name (`2026-10-27.2422edac0126`),
 * the hash of every row being the second.
 *
 * It is set by hand, in git, when a release is cut, and never read from the clock: the same data
 * built on another day gives the same release, so CI and the committed fixtures do not change
 * overnight. Cutting a release is changing this line (or the data), running the ingest, and
 * committing the fixture it prints. `RELEASE_DATE=YYYY-MM-DD` overrides it for one run.
 */
export const releaseDate = '2026-10-27';

export function releaseDateOf(
  env: Record<string, string | undefined> = process.env,
): string {
  const date = env.RELEASE_DATE ?? releaseDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error(`RELEASE_DATE is not a date: ${date}`);
  return date;
}
