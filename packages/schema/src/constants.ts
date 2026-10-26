/** Bump when the shape of any generated file changes. */
export const SCHEMA_VERSION = 1;

/** Where the generated files live, relative to the site base. */
export const DATA_DIR = 'data';

/**
 * Pitch facts confirmed against the real data (see CLAUDE.md).
 * Event coordinates are normalised so every team attacks toward x = 120.
 */
export const PITCH = {
  length: 120,
  width: 80,
  /** y of the two goalposts. The goal mouth spans between them. */
  goalY: [36, 44],
} as const;

/** The match the app opens on and the build inlines for first paint: the 2022 World Cup final. */
export const HERO_MATCH_ID = 3869685;

/** The five marks a shot can be drawn as. StatsBomb's finer outcomes are grouped into these. */
export const OUTCOMES = ['goal', 'saved', 'off', 'blocked', 'post'] as const;
export type Outcome = (typeof OUTCOMES)[number];

/**
 * Every StatsBomb outcome we have seen, with its label and the UI mark it is drawn as,
 * keyed by StatsBomb's outcome name. An outcome missing from this table stops ingest,
 * so a new one is a conscious choice.
 */
export const OUTCOME_TABLE: Readonly<Record<string, { label: string; group: Outcome }>> =
  {
    Goal: { label: 'Goal', group: 'goal' },
    Saved: { label: 'Saved', group: 'saved' },
    'Saved Off Target': { label: 'Saved, would have missed', group: 'saved' },
    'Saved to Post': { label: 'Saved onto the post', group: 'saved' },
    'Off T': { label: 'Off target', group: 'off' },
    Wayward: { label: 'Wayward', group: 'off' },
    Blocked: { label: 'Blocked', group: 'blocked' },
    Post: { label: 'Hit the post', group: 'post' },
  };
