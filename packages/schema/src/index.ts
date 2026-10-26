/**
 * What the browser may import: constants and types. Nothing here imports zod at runtime
 * (the type re-exports below are erased), so the web bundle never contains it. The
 * schemas themselves are at `@shotmap/schema/zod`, for tests, ingest and the API.
 */
export { DATA_DIR, OUTCOMES, OUTCOME_TABLE, PITCH, SCHEMA_VERSION } from './constants';
export type { Outcome } from './constants';
export type {
  EnumEntry,
  Enums,
  IndexCompetition,
  IndexFile,
  IndexSeason,
  MatchFile,
  MatchMeta,
  MatchRow,
  OutcomeEntry,
  PlayerRow,
  ShotColumns,
  TeamMeta,
} from './wire';
