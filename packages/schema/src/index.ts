/**
 * What the browser may import: constants, types and the strict decoder. Nothing here
 * imports zod at runtime (the type re-exports below are erased), so the web bundle never
 * contains it. The schemas themselves are at `@shotmap/schema/zod`, for tests, ingest and
 * the API.
 */
export { DATA_DIR, OUTCOMES, OUTCOME_TABLE, PITCH, SCHEMA_VERSION } from './constants';
export type { Outcome } from './constants';
export {
  API_VERSION,
  ATTRIBUTION,
  CACHE_CONTROL,
  HEADERS,
  LIMITS,
  RELEASE_PATTERN,
  SHOT_ID_FACTOR,
  shotIdOf,
} from './contract';
export { DecodeError, decodeShotsStrict } from './decode';
export type { DecodeContext, DecodedShot } from './decode';
export { ENUMS } from './enums';
export type { EnumKind } from './enums';
export { normalise, wordsOf } from './normalise';
export type {
  ApiError,
  Attribution,
  Compare,
  Competitions,
  Density,
  MatchDetail,
  MatchList,
  MatchShots,
  MatchSummary,
  Player,
  PlayerShots,
  SearchResult,
  ShotsData,
} from './api';
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
