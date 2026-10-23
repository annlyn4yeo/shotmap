import type { Outcome } from '../src/lib/geometry';

/** Raw StatsBomb open data. Pin `ref` to a commit SHA to freeze the source. */
export const source = {
  base: 'https://raw.githubusercontent.com/statsbomb/open-data',
  ref: 'master',
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

/**
 * Every StatsBomb outcome we have seen, with its label and the UI mark it is drawn as.
 * An outcome missing from this table stops the build, so a new one is a conscious choice.
 */
export const outcomes: Record<string, { label: string; group: Outcome }> = {
  Goal: { label: 'Goal', group: 'goal' },
  Saved: { label: 'Saved', group: 'saved' },
  'Saved Off Target': { label: 'Saved, would have missed', group: 'saved' },
  'Saved to Post': { label: 'Saved onto the post', group: 'saved' },
  'Off T': { label: 'Off target', group: 'off' },
  Wayward: { label: 'Wayward', group: 'off' },
  Blocked: { label: 'Blocked', group: 'blocked' },
  Post: { label: 'Hit the post', group: 'post' },
};
