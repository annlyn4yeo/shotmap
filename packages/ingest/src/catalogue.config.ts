/**
 * The whole open catalogue: what the ingest of every competition and season may and may not do.
 * The source commit is pinned in data.config.ts; this file is only for what the wider ingest
 * adds: the design ceiling, and the matches and goals that are known to break a rule.
 */

/**
 * The design ceiling (MIGRATION.md, decision Q1): the schema, indexes and endpoint limits are
 * sized for this, and the ingest stops, before writing anything, when the real catalogue is
 * bigger. Raising it is a decision for the owner, not an edit.
 */
export const ceiling = { matches: 10_000, shots: 500_000 };

export interface Quirk {
  /** Why the match is out, with the evidence: what the source says and what the rule needs. */
  reason: string;
}

/**
 * Matches that are left out of the database, each with its reason. A match is in this list only
 * after the failing check was read and understood; the check itself is never relaxed. The ingest
 * prints this list on every run and stores it in the release manifest, so an exclusion is visible
 * and cannot grow silently: a match that fails and is not listed fails the run.
 */
export const excluded: Record<number, Quirk> = {
  3911630: {
    reason:
      'Liga F 2023/24: goal 3911630018 (Raiderlin Nazareth Carrasco Vargas, 67th minute) is shot from x = 43, 77 yards out, in the own half. The check says every team attacks toward x = 120, so a goal from there is either a very long one or a flipped coordinate. Its end point (120, 41.7, 0.2) and its xG (0.016) fit a long shot, but no match report could be found to say it happened. Left out until someone confirms it; then add its shot id to verifiedGoals and remove the match from this list.',
  },
  3911635: {
    reason:
      'Liga F 2023/24: goal 3911635000 (Eider Arana, 0th minute) is shot from x = 36, 84 yards out, in the first seconds. Same as match 3911630: the end point (120, 37.1, 1.6) and the xG (0.003) fit a goal from the kick-off, but no report could be found. Left out until confirmed.',
  },
};

/**
 * Goals shot from the own half (x <= 60) that are real. The coordinate check treats such a goal as
 * a possible flipped coordinate; one listed here, with its evidence, is not held to that one
 * condition. Every other condition (ends on the line, between the posts, under the bar) still
 * applies to it, and a goal is added only with a source that says it happened.
 */
export const verifiedGoals: Record<number, string> = {
  3817886022:
    "Indian Super League 2021/22, Kerala Blasters v NorthEast United, 4 February 2022: Alvaro Vazquez scores in the 82nd minute from behind the halfway line, the keeper off his line (ESPN match report https://www.espn.co.uk/football/report/_/gameId/625578, and the player's Wikipedia article).",
};
