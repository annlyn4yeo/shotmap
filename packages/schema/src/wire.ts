/**
 * zod schemas for the generated static files (public/data), exactly as they are today.
 * Runtime code lives behind `@shotmap/schema/zod`; the browser imports only the types
 * (see index.ts), so zod never reaches the web bundle.
 */
import { z } from 'zod';
import { OUTCOMES, PITCH, SCHEMA_VERSION } from './constants';

const int = z.number().int();
const text = z.string().min(1);

/** One value of an enum. `id` is the StatsBomb id, which is what the shot columns store. */
const EnumEntrySchema = z.strictObject({ id: int, name: text, label: text });

const OutcomeEntrySchema = z.strictObject({
  id: int,
  name: text,
  label: text,
  /** Which of the five UI marks this outcome is drawn as. Our mapping, not StatsBomb's. */
  group: z.enum(OUTCOMES),
});

export const EnumsSchema = z.strictObject({
  outcome: z.array(OutcomeEntrySchema),
  bodyPart: z.array(EnumEntrySchema),
  shotType: z.array(EnumEntrySchema),
  technique: z.array(EnumEntrySchema),
});

const team = z.union([z.literal(0), z.literal(1)]);

/**
 * Shots as struct-of-arrays: column `k` of shot `i` is `col[k][i]`. Columns share one
 * length. Rows are in match order. Coordinates are StatsBomb yards, rounded to 1 decimal.
 */
export const ShotColumnsSchema = z
  .strictObject({
    /** Match minute, counting through extra time. */
    min: z.array(int),
    sec: z.array(int),
    /** 1 and 2 are normal time, 3 and 4 extra time, 5 the shootout. */
    per: z.array(int.min(1).max(5)),
    /** 0 is the home team, 1 the away team. */
    team: z.array(team),
    /** Index into MatchFile.players. */
    player: z.array(int.min(0)),
    x: z.array(z.number()),
    y: z.array(z.number()),
    /** Where it ended up. For blocked shots this is the block. */
    ex: z.array(z.number()),
    ey: z.array(z.number()),
    /** Height in yards where the ball crossed the goal line, when recorded. */
    ez: z.array(z.number().nullable()),
    xg: z.array(z.number()),
    /** Enum ids, see Enums in index.json. */
    out: z.array(int),
    body: z.array(int),
    type: z.array(int),
    tech: z.array(int),
  })
  .refine((c) => new Set(Object.values(c).map((column) => column.length)).size === 1, {
    message: 'columns must all have the same length',
  });

const TeamMetaSchema = z.strictObject({
  id: int,
  name: text,
  /** Final score before any shootout. */
  score: int.min(0),
  /** Shootout goals, or null if there was no shootout. */
  pens: int.min(0).nullable(),
});

const MatchMetaSchema = z.strictObject({
  id: int,
  /** YYYY-MM-DD */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** HH:MM local to the venue, or null. */
  kickoff: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  competition: z.strictObject({ id: int, name: text }),
  season: z.strictObject({ id: int, name: text }),
  stage: text,
  /** Home first, then away. Team index 0 and 1 in the shot columns. */
  teams: z.tuple([TeamMetaSchema, TeamMetaSchema]),
});

/** [display name, team index, shirt number or null]. Only players who took a shot. */
const PlayerRowSchema = z.tuple([text, team, int.nullable()]);

export const MatchFileSchema = z
  .strictObject({
    v: z.literal(SCHEMA_VERSION),
    meta: MatchMetaSchema,
    players: z.array(PlayerRowSchema),
    /** Normal time and extra time. */
    shots: ShotColumnsSchema,
    /** Penalty shootout kicks, kept apart so the default view never includes them. */
    shootout: ShotColumnsSchema.nullable(),
  })
  .refine((m) => m.shots.per.every((p) => p <= 4), {
    message: 'shots must be in periods 1 to 4',
  })
  .refine((m) => m.shootout === null || m.shootout.per.length > 0, {
    message: 'an empty shootout must be null',
  })
  .refine((m) => m.shootout === null || m.shootout.per.every((p) => p === 5), {
    message: 'shootout kicks must be in period 5',
  });

/**
 * [match id, date, home, away, home score, away score, stage index, home pens, away pens].
 * Stage index points into IndexFile.stages. Pens are null unless there was a shootout.
 */
const MatchRowSchema = z
  .tuple([
    int,
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    text,
    text,
    int.min(0),
    int.min(0),
    int.min(0),
    int.min(0).nullable(),
    int.min(0).nullable(),
  ])
  .refine((row) => (row[7] === null) === (row[8] === null), {
    message: 'a shootout score needs both teams',
  });

const IndexSeasonSchema = z.strictObject({
  id: int,
  name: text,
  /** Chronological. */
  matches: z.array(MatchRowSchema),
});

const IndexCompetitionSchema = z.strictObject({
  id: int,
  name: text,
  seasons: z.array(IndexSeasonSchema),
});

export const IndexFileSchema = z.strictObject({
  v: z.literal(SCHEMA_VERSION),
  /** Match id of the hero match (the 2022 World Cup final). */
  hero: int,
  pitch: z.strictObject({
    length: z.literal(PITCH.length),
    width: z.literal(PITCH.width),
    goalY: z.tuple([z.literal(PITCH.goalY[0]), z.literal(PITCH.goalY[1])]),
  }),
  enums: EnumsSchema,
  stages: z.array(text),
  competitions: z.array(IndexCompetitionSchema),
});

export type EnumEntry = z.infer<typeof EnumEntrySchema>;
export type OutcomeEntry = z.infer<typeof OutcomeEntrySchema>;
export type Enums = z.infer<typeof EnumsSchema>;
export type ShotColumns = z.infer<typeof ShotColumnsSchema>;
export type TeamMeta = z.infer<typeof TeamMetaSchema>;
export type MatchMeta = z.infer<typeof MatchMetaSchema>;
export type PlayerRow = z.infer<typeof PlayerRowSchema>;
export type MatchFile = z.infer<typeof MatchFileSchema>;
export type MatchRow = z.infer<typeof MatchRowSchema>;
export type IndexSeason = z.infer<typeof IndexSeasonSchema>;
export type IndexCompetition = z.infer<typeof IndexCompetitionSchema>;
export type IndexFile = z.infer<typeof IndexFileSchema>;
