/**
 * Raw StatsBomb open data, pinned to a commit so a fresh download is the same data.
 * `master` resolved to this SHA on 2026-10-26 (committed 2026-09-07, "chore: add
 * required labels check (#79)"). All 302 files in the cache were checked byte for byte
 * (git blob hashes) against this commit's tree.
 */
export const source = {
  base: 'https://raw.githubusercontent.com/statsbomb/open-data',
  ref: '4b73468fc5b0f1950f9f66fada70ad3a4f9327cb',
};

/**
 * Which competition and season pairs to include. IDs are resolved from
 * competitions.json by these names, so nothing here is a hard-coded number.
 * Names must match StatsBomb's exactly (see data/competitions.json).
 */
export const include: { competition: string; season: string }[] = [
  { competition: 'FIFA World Cup', season: '2022' },
  { competition: 'UEFA Euro', season: '2024' },
  { competition: 'La Liga', season: '2018/2019' },
];

/** The hero match: found by competition, season and stage. */
export const hero = { competition: 'FIFA World Cup', season: '2022', stage: 'Final' };

/** Ordering of stage names in the index; anything unlisted sorts after, alphabetically. */
export const stageOrder = [
  'Regular Season',
  'Group Stage',
  'Round of 16',
  'Quarter-finals',
  'Semi-finals',
  '3rd Place Final',
  'Final',
];

/** Fail the build if any generated file is over these (gzip, kilobytes). */
export const budgets = { indexKB: 30, matchKB: 12 };

/** Parallel downloads. Keep it polite. */
export const concurrency = 4;

export const retries = 5;

// The outcome-to-mark table lives in @shotmap/schema (OUTCOME_TABLE): the app and the
// API need it too. An outcome missing from it still stops the build.
