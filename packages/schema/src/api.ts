/**
 * zod schemas for every /v1 response, and the route table that docs/openapi.json and
 * docs/API.md are generated from. Server, ingest and test code only: the browser gets
 * the types (see index.ts) and the strict decoder, never this file.
 *
 * Every response is `{ release, attribution, data }`. The HTTP side (ETag, Cache-Control,
 * X-Data-Release) is described in the route table and in docs/API.md.
 */
import { z } from 'zod';
import { LIMITS, RELEASE_PATTERN } from './contract';
import { OUTCOMES } from './constants';

const int = z.number().int();
const id = int.min(0);
const text = z.string().min(1);
const side = z.union([z.literal(0), z.literal(1)]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const day = date.describe('YYYY-MM-DD');

export const AttributionSchema = z.strictObject({
  source: z.literal('StatsBomb'),
  text: text,
  url: z.url(),
  terms: z.url(),
});

/** Wraps a payload in the fields every response carries. */
export const envelope = <T extends z.ZodType>(data: T) =>
  z.strictObject({
    release: z
      .string()
      .regex(RELEASE_PATTERN)
      .describe('The data release this answer comes from'),
    attribution: AttributionSchema,
    data,
  });

export const ErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum([
      'bad_request',
      'not_found',
      'method_not_allowed',
      'release_gone',
      'too_many_rows',
      'internal',
    ]),
    message: text,
  }),
});

// Shots, as columns

const decimalsOk = (v: number, dp: number) =>
  Math.abs(v * 10 ** dp - Math.round(v * 10 ** dp)) < 1e-6;

/** The shot columns shared by every shots payload. */
const shotColumns = {
  /** Global shot id: match * 1000 + seq. */
  shot: z.array(id),
  /** Position within the match: open play in order, then the shootout kicks. */
  seq: z.array(id),
  /** 0 home, 1 away. */
  side: z.array(side),
  /** StatsBomb team id. */
  team: z.array(id),
  /** StatsBomb player id. */
  player: z.array(id),
  /** 1 and 2 normal time, 3 and 4 extra time, 5 the shootout. */
  period: z.array(int.min(1).max(5)),
  min: z.array(int.min(0)),
  sec: z.array(int.min(0).max(59)),
  /** Yards, 1 decimal, every team attacking toward x = 120. */
  x: z.array(z.number()),
  y: z.array(z.number()),
  ex: z.array(z.number()),
  ey: z.array(z.number()),
  ez: z.array(z.number().nullable()),
  /** Expected goals, 3 decimals. */
  xg: z.array(z.number()),
  /** StatsBomb outcome, body part, shot type and technique ids (see ENUMS). */
  out: z.array(id),
  body: z.array(id),
  type: z.array(id),
  tech: z.array(id),
};

type Cols = Record<string, readonly unknown[]> & {
  seq: readonly number[];
  period: readonly number[];
  match?: readonly number[];
  x: readonly number[];
  y: readonly number[];
  ex: readonly number[];
  ey: readonly number[];
  ez: readonly (number | null)[];
  xg: readonly number[];
};

/** What a schema of plain arrays cannot say. Returns the first problem, or undefined. */
function shotsProblem(
  d: { n: number; cols: Cols },
  singleMatch: boolean,
): string | undefined {
  const { n, cols } = d;
  for (const [key, column] of Object.entries(cols))
    if (column.length !== n) return `column ${key} has ${column.length} rows, n is ${n}`;
  for (let i = 0; i < n; i++) {
    const seq = cols.seq[i] ?? 0;
    if (singleMatch && seq !== i)
      return `seq must be 0..n-1 in order, row ${i} has ${seq}`;
    if (i > 0) {
      const sameMatch = (cols.match?.[i] ?? 0) === (cols.match?.[i - 1] ?? 0);
      if (!sameMatch && (cols.match?.[i] ?? 0) < (cols.match?.[i - 1] ?? 0))
        return `match must be sorted, row ${i}`;
      if (sameMatch) {
        if (seq <= (cols.seq[i - 1] ?? 0))
          return `seq must increase within a match, row ${i}`;
        if ((cols.period[i] ?? 0) < (cols.period[i - 1] ?? 0))
          return `the shootout must come after open play, row ${i}`;
      }
    }
    for (const key of ['x', 'y', 'ex', 'ey'] as const)
      if (!decimalsOk(cols[key][i] ?? 0, 1))
        return `${key} has more than 1 decimal, row ${i}`;
    const ez = cols.ez[i];
    if (ez !== null && ez !== undefined && !decimalsOk(ez, 1))
      return `ez has more than 1 decimal, row ${i}`;
    if (!decimalsOk(cols.xg[i] ?? 0, 3)) return `xg has more than 3 decimals, row ${i}`;
  }
  return undefined;
}

const refineShots = <S extends z.ZodType<{ n: number; cols: Cols }>>(
  schema: S,
  singleMatch: boolean,
) =>
  schema.superRefine((d, ctx) => {
    const problem = shotsProblem(d, singleMatch);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

/** One match's shots. Shootout kicks are rows with period 5, after open play. */
export const MatchShotsSchema = refineShots(
  z.strictObject({ n: int.min(0), cols: z.strictObject(shotColumns) }),
  true,
);

/** Shots from many matches (a player's career): the same columns plus `match`, sorted by it. */
export const PlayerShotsSchema = refineShots(
  z.strictObject({
    n: int.min(0),
    cols: z.strictObject({ ...shotColumns, match: z.array(id) }),
  }),
  false,
);

/** Shots counted into square bins of `step` yards. Sparse: only bins with a shot appear. */
export const DensitySchema = z
  .strictObject({
    step: z.number().int().min(1),
    /** Bin index along x and y: floor(coordinate / step). */
    gx: z.array(int.min(0)),
    gy: z.array(int.min(0)),
    n: z.array(int.min(1)),
    /** Sum of expected goals in the bin, 3 decimals. */
    xg: z.array(z.number()),
    goals: z.array(int.min(0)),
  })
  .refine(
    (d) => [d.gy, d.n, d.xg, d.goals].every((column) => column.length === d.gx.length),
    { message: 'columns must all have the same length' },
  );

// Resources

const TeamResult = z.strictObject({
  id,
  name: text,
  score: int.min(0),
  /** Shootout goals, or null when there was no shootout. */
  pens: int.min(0).nullable(),
});

const MatchPlayerSchema = z.strictObject({
  id,
  name: text,
  side,
  team: id,
  shirt: int.nullable(),
});

export const MatchDetailSchema = z.strictObject({
  id,
  date: day,
  kickoff: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  competition: z.strictObject({ id, name: text }),
  season: z.strictObject({ id, name: text }),
  stage: z.strictObject({ id, name: text }),
  /** Home first, then away. */
  teams: z.tuple([TeamResult, TeamResult]),
  /** Players who took a shot, in the order of their first shot. */
  players: z.array(MatchPlayerSchema),
});

const MatchSummarySchema = z.strictObject({
  id,
  date: day,
  competition: id,
  season: id,
  stage: id,
  home: TeamResult,
  away: TeamResult,
});

export const MatchListSchema = z.strictObject({
  items: z.array(MatchSummarySchema),
  /** Pass as `cursor` for the next page; null on the last. */
  next: z.string().nullable(),
});

export const CompetitionsSchema = z.strictObject({
  competitions: z.array(
    z.strictObject({
      id,
      name: text,
      seasons: z.array(z.strictObject({ id, name: text, matches: int.min(0) })),
    }),
  ),
  stages: z.array(z.strictObject({ id, name: text })),
});

/** The data release's description: where it came from, how big it is, and what it covers. */
export const MetaSchema = z.strictObject({
  source: z.strictObject({
    name: z.literal('StatsBomb open data'),
    /** The commit of statsbomb/open-data the data was built from. */
    ref: z.string().regex(/^[0-9a-f]{40}$/),
  }),
  schemaVersion: int.min(1),
  counts: z.strictObject({
    matches: int.min(0),
    shots: int.min(0),
    players: int.min(0),
    teams: int.min(0),
  }),
  competitions: CompetitionsSchema.shape.competitions,
  stages: CompetitionsSchema.shape.stages,
});

export const SearchSchema = z.strictObject({
  q: z.string(),
  players: z.array(z.strictObject({ id, name: text })),
  teams: z.array(z.strictObject({ id, name: text })),
  matches: z.array(z.strictObject({ id, date: day, home: text, away: text })),
});

const PlayerStats = z.strictObject({
  matches: int.min(0),
  shots: int.min(0),
  goals: int.min(0),
  onTarget: int.min(0),
  xg: z.number(),
});

/** A player, summed over every team they took shots for. There is no single "team". */
export const PlayerSchema = z.strictObject({
  id,
  name: text,
  fullName: text,
  teams: z.array(z.strictObject({ id, name: text, shots: int.min(1) })),
  totals: PlayerStats,
});

export const CompareSchema = z.strictObject({ a: PlayerSchema, b: PlayerSchema });

// Routes

/** Query and path values arrive as strings: these describe the wire form. The Worker parses them by hand (no zod at runtime). */
const qint = z.string().regex(/^\d{1,9}$/);
const qdate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('YYYY-MM-DD');
const pinned = z
  .string()
  .regex(RELEASE_PATTERN)
  .optional()
  .describe(
    'The data release you expect. Matching the current release makes the answer cacheable for a year; any other release answers 410 `release_gone`.',
  );
const withPin = <S extends z.ZodRawShape>(shape: S) => z.object({ ...shape, v: pinned });

const outcomeList = z
  .string()
  .describe(`Comma-separated outcome groups to keep: ${OUTCOMES.join(', ')}`);
const filters = {
  competition: qint.optional().describe('Competition id'),
  season: qint.optional().describe('Season id (with competition)'),
  period: z
    .enum(['open', 'shootout'])
    .optional()
    .describe('Open play only or the shootout only'),
  outcome: outcomeList.optional(),
};
const idParam = z.object({ id: qint });

export interface Route {
  id: string;
  path: string;
  summary: string;
  /** `live` routes are served by apps/api; `planned` ones are in the contract but answer 404 for now. */
  status: 'live' | 'planned';
  params?: z.ZodObject;
  query?: z.ZodObject;
  response: z.ZodType;
  /** Shown in docs/API.md. */
  notes?: string;
}

export const ROUTES: readonly Route[] = [
  {
    id: 'getMeta',
    path: '/v1/meta',
    summary:
      'The data release, its source and size, the competitions with their seasons, and the stage names',
    status: 'live',
    query: withPin({}),
    response: envelope(MetaSchema),
    notes:
      'Start here: `release` in the body is the value to pass as `v` on every other request.',
  },
  {
    id: 'listMatches',
    path: '/v1/matches',
    summary: 'Browse matches, oldest first',
    status: 'live',
    query: withPin({
      competition: qint.optional(),
      season: qint.optional().describe('Season id (use with competition)'),
      stage: qint.optional(),
      team: qint.optional().describe('Team id: matches it played in'),
      from: qdate.optional(),
      to: qdate.optional(),
      limit: qint
        .optional()
        .describe(`1 to ${LIMITS.matchesPageMax}, default ${LIMITS.matchesPageDefault}`),
      cursor: z.string().optional(),
    }),
    response: envelope(MatchListSchema),
    notes: `Never more than ${LIMITS.matchesPageMax} matches, whatever \`limit\` says.`,
  },
  {
    id: 'getMatch',
    path: '/v1/matches/{id}',
    summary: 'One match: result, teams and the players who shot',
    status: 'live',
    params: idParam,
    query: withPin({}),
    response: envelope(MatchDetailSchema),
  },
  {
    id: 'getMatchShots',
    path: '/v1/matches/{id}/shots',
    summary: "One match's shots as columns",
    status: 'live',
    params: idParam,
    query: withPin({}),
    response: envelope(MatchShotsSchema),
    notes:
      'Shootout kicks are rows with period 5 after open play, so `seq` is stable: it equals the position the static files give a shot.',
  },
  {
    id: 'search',
    path: '/v1/search',
    summary: 'Players, teams and matches whose name starts with the words typed',
    status: 'planned',
    query: withPin({
      q: z.string().min(1).max(64),
      limit: qint.optional().describe(`1 to ${LIMITS.searchPerKind}`),
    }),
    response: envelope(SearchSchema),
    notes:
      'Accents and case are folded the same way ingest folds them. Every word is matched as the start of a word, not inside one.',
  },
  {
    id: 'getPlayer',
    path: '/v1/players/{id}',
    summary: 'A player, summed across every team they shot for',
    status: 'planned',
    params: idParam,
    query: withPin({}),
    response: envelope(PlayerSchema),
  },
  {
    id: 'getPlayerShots',
    path: '/v1/players/{id}/shots',
    summary: "A player's shots across matches, as columns",
    status: 'planned',
    params: idParam,
    query: withPin(filters),
    response: envelope(PlayerShotsSchema),
    notes: `Sorted by match, then seq. Answers 400 \`too_many_rows\` above ${LIMITS.playerShotsMax} rows: ask for density instead.`,
  },
  {
    id: 'getPlayerDensity',
    path: '/v1/players/{id}/density',
    summary: "A player's shots counted into square bins",
    status: 'planned',
    params: idParam,
    query: withPin({
      step: qint
        .optional()
        .describe(`One of ${LIMITS.densitySteps.join(', ')} (default 2)`),
      ...filters,
    }),
    response: envelope(DensitySchema),
  },
  {
    id: 'compare',
    path: '/v1/compare',
    summary: 'Two players side by side',
    status: 'planned',
    query: withPin({ a: qint, b: qint }),
    response: envelope(CompareSchema),
  },
];

export type MatchShots = z.infer<typeof MatchShotsSchema>;
export type PlayerShots = z.infer<typeof PlayerShotsSchema>;
export type ShotsData = MatchShots | PlayerShots;
export type Density = z.infer<typeof DensitySchema>;
export type MatchDetail = z.infer<typeof MatchDetailSchema>;
export type MatchSummary = z.infer<typeof MatchSummarySchema>;
export type MatchList = z.infer<typeof MatchListSchema>;
export type Competitions = z.infer<typeof CompetitionsSchema>;
export type Meta = z.infer<typeof MetaSchema>;
export type SearchResult = z.infer<typeof SearchSchema>;
export type Player = z.infer<typeof PlayerSchema>;
export type Compare = z.infer<typeof CompareSchema>;
export type Attribution = z.infer<typeof AttributionSchema>;
export type ApiError = z.infer<typeof ErrorSchema>;
